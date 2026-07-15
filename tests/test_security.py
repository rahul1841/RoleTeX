"""Unit tests for app/security.py: hashing, tokens, ciphers, limits, CSRF."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

import pytest

from app.security import (
    LoginThrottle,
    RateLimiter,
    SecretCipherError,
    SESSION_COOKIE_NAME,
    decrypt_secret,
    encrypt_secret,
    hash_password,
    hash_token,
    key_hint,
    new_session_token,
    normalize_email,
    origin_allowed,
    password_policy_error,
    session_needs_renewal,
    should_secure_cookie,
    verify_password,
)


class FakeClock:
    def __init__(self, start: float = 1_000.0) -> None:
        self.value = start

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


class FakeURL:
    def __init__(self, scheme: str) -> None:
        self.scheme = scheme


class FakeRequest:
    """Duck-typed stand-in for starlette.Request (headers + url.scheme)."""

    def __init__(self, headers: Dict[str, str], scheme: str = "http") -> None:
        self.headers = headers
        self.url = FakeURL(scheme)


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


def test_hash_password_roundtrip() -> None:
    stored = hash_password("correct horse battery")
    assert verify_password("correct horse battery", stored)
    assert not verify_password("wrong password", stored)


def test_hash_password_format_and_salt_uniqueness() -> None:
    first = hash_password("hunter2hunter2")
    second = hash_password("hunter2hunter2")
    assert first.startswith("pbkdf2_sha256$600000$")
    assert first != second  # random salt per hash
    assert len(first.split("$")) == 4


def test_verify_password_rejects_tampered_hash() -> None:
    stored = hash_password("a valid password")
    algorithm, iterations, salt, digest = stored.split("$")
    flipped = "A" + digest[1:] if digest[0] != "A" else "B" + digest[1:]
    tampered = "$".join([algorithm, iterations, salt, flipped])
    assert not verify_password("a valid password", tampered)


@pytest.mark.parametrize(
    "malformed",
    [
        "",
        "plaintext",
        "pbkdf2_sha256$notanint$c2FsdA==$aGFzaA==",
        "pbkdf2_sha256$600000$not-base64!$aGFzaA==",
        "md5$1$c2FsdA==$aGFzaA==",
        "pbkdf2_sha256$600000$onlythreeparts",
        "pbkdf2_sha256$0$c2FsdA==$aGFzaA==",
    ],
)
def test_verify_password_tolerates_malformed_stored_values(malformed: str) -> None:
    assert verify_password("whatever password", malformed) is False


@pytest.mark.parametrize(
    ("password", "valid"),
    [
        ("short", False),
        ("1234567", False),
        ("12345678", True),
        ("x" * 128, True),
        ("x" * 129, False),
    ],
)
def test_password_policy_bounds(password: str, valid: bool) -> None:
    error = password_policy_error(password)
    assert (error is None) is valid


# ---------------------------------------------------------------------------
# Emails
# ---------------------------------------------------------------------------


def test_normalize_email_lowercases_and_strips() -> None:
    assert normalize_email("  User@Example.COM ") == "user@example.com"


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "no-at-sign.example.com",
        "two@@example.com",
        "spaces in@example.com",
        "user@example",  # no dot in domain
        "user@.".ljust(260, "a"),  # over length
        "a" * 250 + "@example.com",  # 254+ after normalization
    ],
)
def test_normalize_email_rejects_invalid(bad: str) -> None:
    assert normalize_email(bad) is None


# ---------------------------------------------------------------------------
# Session tokens
# ---------------------------------------------------------------------------


def test_session_tokens_are_unique_and_long() -> None:
    tokens = {new_session_token() for _ in range(64)}
    assert len(tokens) == 64
    assert all(len(token) >= 40 for token in tokens)


def test_hash_token_is_sha256_hex() -> None:
    digest = hash_token("some-token")
    assert digest == hash_token("some-token")
    assert digest != hash_token("some-other-token")
    assert len(digest) == 64
    int(digest, 16)  # raises if not hex


def test_session_cookie_name_constant() -> None:
    assert SESSION_COOKIE_NAME == "rt_session"


def test_session_needs_renewal_rule() -> None:
    now = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)
    ttl = 30 * 86_400
    fresh = now + timedelta(seconds=ttl)
    assert not session_needs_renewal(fresh, ttl, now=now)
    aging = now + timedelta(seconds=int(ttl * 0.74))
    assert session_needs_renewal(aging, ttl, now=now)
    naive = (now + timedelta(seconds=60)).replace(tzinfo=None)
    assert session_needs_renewal(naive, ttl, now=now)


def test_should_secure_cookie_modes() -> None:
    https_request = FakeRequest({"x-forwarded-proto": "https"}, scheme="http")
    http_request = FakeRequest({}, scheme="http")
    assert should_secure_cookie(http_request, "true") is True
    assert should_secure_cookie(https_request, "false") is False
    assert should_secure_cookie(https_request, "auto") is True
    assert should_secure_cookie(http_request, "auto") is False


# ---------------------------------------------------------------------------
# Secret encryption
# ---------------------------------------------------------------------------


def test_encrypt_decrypt_roundtrip() -> None:
    token = encrypt_secret("sk-super-secret-key", "app secret")
    assert token != "sk-super-secret-key"
    assert "sk-super-secret" not in token
    assert decrypt_secret(token, "app secret") == "sk-super-secret-key"


def test_decrypt_with_wrong_key_raises() -> None:
    token = encrypt_secret("sk-super-secret-key", "app secret")
    with pytest.raises(SecretCipherError):
        decrypt_secret(token, "rotated different secret")


@pytest.mark.parametrize("garbage", ["", "not-a-token", "Z" * 100])
def test_decrypt_garbage_raises(garbage: str) -> None:
    with pytest.raises(SecretCipherError):
        decrypt_secret(garbage, "app secret")


def test_encrypt_requires_secret_key() -> None:
    with pytest.raises(SecretCipherError):
        encrypt_secret("payload", "")


def test_key_hint_masks_all_but_last_four() -> None:
    assert key_hint("sk-abcdefgh1234") == "…1234"
    assert key_hint("") == "…"


# ---------------------------------------------------------------------------
# RateLimiter
# ---------------------------------------------------------------------------


def test_rate_limiter_allows_up_to_max_then_blocks() -> None:
    clock = FakeClock()
    limiter = RateLimiter(max_calls=3, window_seconds=60, now_fn=clock)
    assert limiter.check("user-1") is None
    assert limiter.check("user-1") is None
    assert limiter.check("user-1") is None
    retry_after = limiter.check("user-1")
    assert retry_after is not None
    assert 0 < retry_after <= 60


def test_rate_limiter_window_slides() -> None:
    clock = FakeClock()
    limiter = RateLimiter(max_calls=2, window_seconds=60, now_fn=clock)
    assert limiter.check("k") is None
    clock.advance(30)
    assert limiter.check("k") is None
    assert limiter.check("k") is not None
    clock.advance(31)  # first call falls out of the window
    assert limiter.check("k") is None
    assert limiter.check("k") is not None


def test_rate_limiter_retry_after_matches_oldest_call() -> None:
    clock = FakeClock()
    limiter = RateLimiter(max_calls=1, window_seconds=100, now_fn=clock)
    assert limiter.check("k") is None
    clock.advance(40)
    retry_after = limiter.check("k")
    assert retry_after == pytest.approx(60, abs=0.01)


def test_rate_limiter_buckets_are_independent() -> None:
    clock = FakeClock()
    limiter = RateLimiter(max_calls=1, window_seconds=60, now_fn=clock)
    assert limiter.check("user-a") is None
    assert limiter.check("user-b") is None
    assert limiter.check("user-a") is not None
    assert limiter.check("user-b") is not None


# ---------------------------------------------------------------------------
# LoginThrottle
# ---------------------------------------------------------------------------


def test_login_throttle_blocks_after_max_failures() -> None:
    clock = FakeClock()
    throttle = LoginThrottle(max_attempts=3, window_seconds=900, now_fn=clock)
    assert throttle.check("a@example.com", "1.2.3.4") is None
    for _ in range(3):
        throttle.record_failure("a@example.com", "1.2.3.4")
    retry_after = throttle.check("a@example.com", "1.2.3.4")
    assert retry_after is not None
    assert 0 < retry_after <= 900


def test_login_throttle_is_scoped_per_email_and_ip() -> None:
    clock = FakeClock()
    throttle = LoginThrottle(max_attempts=1, window_seconds=900, now_fn=clock)
    throttle.record_failure("a@example.com", "1.2.3.4")
    assert throttle.check("a@example.com", "1.2.3.4") is not None
    assert throttle.check("b@example.com", "1.2.3.4") is None
    assert throttle.check("a@example.com", "5.6.7.8") is None


def test_login_throttle_clears_on_success_and_expires() -> None:
    clock = FakeClock()
    throttle = LoginThrottle(max_attempts=1, window_seconds=100, now_fn=clock)
    throttle.record_failure("a@example.com", "ip")
    assert throttle.check("a@example.com", "ip") is not None
    throttle.clear("a@example.com", "ip")
    assert throttle.check("a@example.com", "ip") is None
    throttle.record_failure("a@example.com", "ip")
    clock.advance(101)
    assert throttle.check("a@example.com", "ip") is None


# ---------------------------------------------------------------------------
# CSRF origin check
# ---------------------------------------------------------------------------


def test_origin_allowed_when_header_missing() -> None:
    assert origin_allowed(FakeRequest({"host": "example.com"})) is True


def test_origin_allowed_matching_host() -> None:
    request = FakeRequest(
        {"origin": "https://example.com", "host": "example.com"}, scheme="https"
    )
    assert origin_allowed(request) is True


def test_origin_rejected_for_foreign_host() -> None:
    request = FakeRequest(
        {"origin": "https://evil.example.net", "host": "example.com"}, scheme="https"
    )
    assert origin_allowed(request) is False


def test_origin_rejected_for_null_and_garbage() -> None:
    assert not origin_allowed(FakeRequest({"origin": "null", "host": "example.com"}))
    assert not origin_allowed(FakeRequest({"origin": "garbage", "host": "example.com"}))


def test_origin_honors_x_forwarded_host() -> None:
    request = FakeRequest(
        {
            "origin": "https://app.example.com",
            "host": "internal-lb:8080",
            "x-forwarded-host": "app.example.com",
            "x-forwarded-proto": "https",
        },
        scheme="http",
    )
    assert origin_allowed(request) is True


def test_origin_normalizes_default_ports() -> None:
    request = FakeRequest(
        {
            "origin": "https://example.com",
            "host": "example.com:443",
            "x-forwarded-proto": "https",
        },
        scheme="http",
    )
    assert origin_allowed(request) is True


def test_origin_rejects_port_mismatch() -> None:
    request = FakeRequest(
        {"origin": "http://example.com:8080", "host": "example.com:9090"},
        scheme="http",
    )
    assert origin_allowed(request) is False
