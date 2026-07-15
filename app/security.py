"""Authentication and secret-handling primitives.

Security rationale:
- Passwords are stored only as salted PBKDF2-HMAC-SHA256 hashes (600k
  iterations); verification is constant-time and tolerant of malformed stored
  values (returns False, never raises).
- Session tokens are 256-bit random values; only their SHA-256 hash is stored,
  so a database leak does not yield usable session cookies.
- User-supplied provider API keys are encrypted at rest with Fernet
  (AES-128-CBC + HMAC) using a key derived from ``APP_SECRET_KEY``; plaintext
  keys never touch disk and are never echoed back to clients (masked hint only).
- Rate limiting and login throttling are in-memory sliding windows guarded by
  a lock, with an injectable clock so tests never sleep.
- ``origin_allowed`` implements the CSRF origin check for state-changing
  cookie-authenticated requests: a present ``Origin`` header must match the
  request host; absent Origin (non-browser clients) is allowed because those
  clients do not carry ambient cookie credentials from a hostile page.

No function in this module ever logs or embeds secrets in error messages.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Callable, Deque, Dict, Optional, Tuple

from cryptography.fernet import Fernet


SESSION_COOKIE_NAME = "rt_session"

PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128

PBKDF2_ALGORITHM = "pbkdf2_sha256"
PBKDF2_ITERATIONS = 600_000
_SALT_BYTES = 16

EMAIL_MAX_LENGTH = 254
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class SecretCipherError(RuntimeError):
    """Raised when a stored secret cannot be encrypted or decrypted."""


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    """Hash a password as ``pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>``."""

    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )
    return "{0}${1}${2}${3}".format(
        PBKDF2_ALGORITHM,
        PBKDF2_ITERATIONS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored: str) -> bool:
    """Constant-time verification; malformed stored values simply fail."""

    try:
        algorithm, iterations_text, salt_b64, hash_b64 = stored.split("$")
        if algorithm != PBKDF2_ALGORITHM:
            return False
        iterations = int(iterations_text)
        if iterations < 1 or iterations > 10_000_000:
            return False
        salt = base64.b64decode(salt_b64.encode("ascii"), validate=True)
        expected = base64.b64decode(hash_b64.encode("ascii"), validate=True)
    except (AttributeError, ValueError, TypeError):
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(candidate, expected)


_DUMMY_HASH_CACHE: dict = {}


def dummy_password_hash() -> str:
    """A valid stub hash for equalizing login timing on unknown emails.

    Verifying a junk password against this hash performs the same PBKDF2 work
    as a real verification, so response time cannot reveal whether an account
    exists. Cached per iteration count (tests lower ``PBKDF2_ITERATIONS``).
    """

    cached = _DUMMY_HASH_CACHE.get(PBKDF2_ITERATIONS)
    if cached is None:
        cached = hash_password(secrets.token_urlsafe(16))
        _DUMMY_HASH_CACHE[PBKDF2_ITERATIONS] = cached
    return cached


def password_policy_error(password: str) -> Optional[str]:
    """Return a human-readable policy violation, or None when acceptable."""

    if not isinstance(password, str) or len(password) < PASSWORD_MIN_LENGTH:
        return "Password must be at least {0} characters".format(PASSWORD_MIN_LENGTH)
    if len(password) > PASSWORD_MAX_LENGTH:
        return "Password must be at most {0} characters".format(PASSWORD_MAX_LENGTH)
    return None


# ---------------------------------------------------------------------------
# Emails
# ---------------------------------------------------------------------------


def normalize_email(email: str) -> Optional[str]:
    """Lowercase-normalize and validate an email; None when invalid."""

    if not isinstance(email, str):
        return None
    candidate = email.strip().lower()
    if not candidate or len(candidate) > EMAIL_MAX_LENGTH:
        return None
    if not _EMAIL_RE.match(candidate):
        return None
    return candidate


# ---------------------------------------------------------------------------
# Session tokens
# ---------------------------------------------------------------------------


def new_session_token() -> str:
    """256-bit URL-safe random session token (sent to the client once)."""

    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA-256 hex digest — the only representation ever stored server-side."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_needs_renewal(
    expires_at: datetime, ttl_seconds: float, now: Optional[datetime] = None
) -> bool:
    """Sliding renewal rule: refresh once less than 75% of the TTL remains."""

    current = now if now is not None else datetime.now(timezone.utc)
    expiry = expires_at if expires_at.tzinfo is not None else expires_at.replace(
        tzinfo=timezone.utc
    )
    remaining = (expiry - current).total_seconds()
    return remaining < (ttl_seconds * 0.75)


def should_secure_cookie(request: "object", cookie_secure_mode: str) -> bool:
    """Resolve the Secure cookie flag for ``COOKIE_SECURE`` = auto/true/false."""

    mode = (cookie_secure_mode or "auto").strip().lower()
    if mode == "true":
        return True
    if mode == "false":
        return False
    return _request_scheme(request) == "https"


# ---------------------------------------------------------------------------
# Secret encryption (user-supplied provider API keys)
# ---------------------------------------------------------------------------


def _fernet_for(secret_key: str) -> Fernet:
    if not isinstance(secret_key, str) or not secret_key:
        raise SecretCipherError("A non-empty secret key is required")
    digest = hashlib.sha256(secret_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plaintext: str, secret_key: str) -> str:
    """Encrypt ``plaintext`` with a Fernet key derived from ``secret_key``."""

    try:
        return _fernet_for(secret_key).encrypt(plaintext.encode("utf-8")).decode("ascii")
    except SecretCipherError:
        raise
    except Exception as exc:  # never leak plaintext or key material
        raise SecretCipherError("Secret could not be encrypted") from exc


def decrypt_secret(token: str, secret_key: str) -> str:
    """Decrypt a stored ciphertext; raises SecretCipherError on any failure.

    Failure typically means ``APP_SECRET_KEY`` changed since the secret was
    stored (or the ciphertext was corrupted).
    """

    try:
        return _fernet_for(secret_key).decrypt(token.encode("ascii")).decode("utf-8")
    except SecretCipherError:
        raise
    except Exception as exc:  # InvalidToken, encoding errors, non-str input
        raise SecretCipherError("Secret could not be decrypted") from exc


def key_hint(key: str) -> str:
    """Masked display form of a secret: an ellipsis plus the last 4 characters."""

    if not isinstance(key, str) or not key:
        return "…"
    return "…" + key[-4:]


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


class RateLimiter:
    """Thread-safe in-memory sliding-window limiter.

    ``check(bucket_key)`` either records one call and returns None, or — when
    the bucket already holds ``max_calls`` within the window — returns the
    seconds to wait before the next call would be admitted. The clock is
    injectable (monotonic by default) so tests never sleep.
    """

    def __init__(
        self,
        max_calls: int,
        window_seconds: float,
        now_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_calls = max(1, int(max_calls))
        self.window_seconds = float(window_seconds)
        self._now_fn = now_fn
        self._lock = threading.Lock()
        self._buckets: Dict[str, Deque[float]] = {}

    def check(self, bucket_key: str) -> Optional[float]:
        now = self._now_fn()
        cutoff = now - self.window_seconds
        with self._lock:
            bucket = self._buckets.get(bucket_key)
            if bucket is None:
                bucket = deque()
                self._buckets[bucket_key] = bucket
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self.max_calls:
                retry_after = bucket[0] + self.window_seconds - now
                return max(0.001, retry_after)
            bucket.append(now)
            self._prune_locked(cutoff)
            return None

    def _prune_locked(self, cutoff: float) -> None:
        """Drop empty/stale buckets so memory stays bounded by active clients."""

        if len(self._buckets) < 1_024:
            return
        stale = [
            key
            for key, bucket in self._buckets.items()
            if not bucket or bucket[-1] <= cutoff
        ]
        for key in stale:
            del self._buckets[key]


class LoginThrottle:
    """Sliding-window failed-login throttle keyed by (email, client IP).

    Usage inside the login route: call ``check`` first (429 with the returned
    retry-after when non-None), ``record_failure`` on a bad credential, and
    ``clear`` after a successful login. Successful logins therefore reset the
    counter; only failures accumulate.
    """

    def __init__(
        self,
        max_attempts: int,
        window_seconds: float,
        now_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_attempts = max(1, int(max_attempts))
        self.window_seconds = float(window_seconds)
        self._now_fn = now_fn
        self._lock = threading.Lock()
        self._failures: Dict[Tuple[str, str], Deque[float]] = {}

    def _key(self, email: str, client_ip: str) -> Tuple[str, str]:
        return ((email or "").strip().lower(), (client_ip or "").strip())

    def check(self, email: str, client_ip: str) -> Optional[float]:
        """Return retry-after seconds when throttled, else None (read-only)."""

        now = self._now_fn()
        cutoff = now - self.window_seconds
        key = self._key(email, client_ip)
        with self._lock:
            bucket = self._failures.get(key)
            if bucket is None:
                return None
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if not bucket:
                del self._failures[key]
                return None
            if len(bucket) >= self.max_attempts:
                return max(0.001, bucket[0] + self.window_seconds - now)
            return None

    def record_failure(self, email: str, client_ip: str) -> None:
        now = self._now_fn()
        cutoff = now - self.window_seconds
        key = self._key(email, client_ip)
        with self._lock:
            bucket = self._failures.get(key)
            if bucket is None:
                bucket = deque()
                self._failures[key] = bucket
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            bucket.append(now)

    def clear(self, email: str, client_ip: str) -> None:
        with self._lock:
            self._failures.pop(self._key(email, client_ip), None)


# ---------------------------------------------------------------------------
# CSRF origin check
# ---------------------------------------------------------------------------


def _request_scheme(request: "object") -> str:
    headers = getattr(request, "headers", {})
    forwarded_proto = (headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if forwarded_proto:
        return forwarded_proto
    url = getattr(request, "url", None)
    return (getattr(url, "scheme", "") or "http").lower()


def _normalize_netloc(netloc: str, scheme: str) -> str:
    """Lowercase and strip the scheme's default port for stable comparison."""

    value = (netloc or "").strip().lower()
    if scheme == "https" and value.endswith(":443"):
        return value[: -len(":443")]
    if scheme == "http" and value.endswith(":80"):
        return value[: -len(":80")]
    return value


def origin_allowed(request: "object") -> bool:
    """CSRF check: a present ``Origin`` header must match the request host.

    Missing Origin → allowed (non-browser clients such as curl do not carry a
    hostile page's cookies). An unparsable or ``null`` Origin, or one whose
    host differs from the request's own host (``X-Forwarded-Host``/``Host``,
    honoring ``X-Forwarded-Proto`` for default-port normalization), is denied.
    """

    headers = getattr(request, "headers", {})
    origin = (headers.get("origin") or "").strip()
    if not origin:
        return True
    if origin.lower() == "null":
        return False

    scheme_separator = origin.find("://")
    if scheme_separator <= 0:
        return False
    origin_scheme = origin[:scheme_separator].lower()
    origin_rest = origin[scheme_separator + 3 :]
    origin_netloc = origin_rest.split("/", 1)[0]
    if not origin_netloc:
        return False

    request_scheme = _request_scheme(request)
    request_host = (
        (headers.get("x-forwarded-host") or "").split(",")[0].strip()
        or (headers.get("host") or "").strip()
    )
    if not request_host:
        return False
    return _normalize_netloc(origin_netloc, origin_scheme) == _normalize_netloc(
        request_host, request_scheme
    )
