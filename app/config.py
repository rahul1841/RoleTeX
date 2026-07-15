"""Application configuration loaded from environment variables.

Every numeric knob is clamped to a documented range (rule C-5) so a bad or
hostile environment value can never disable a safety limit. ``APP_SECRET_KEY``
protects session-independent secrets (Fernet encryption of user API keys); if
it is unset a random ephemeral key is generated so the app still boots, and
the config records that fact so ``/api/health`` can surface the warning —
encrypted keys and sessions will not survive a restart in that state.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def _bounded_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def _cookie_secure_mode(raw: str) -> str:
    value = raw.strip().lower()
    if value in ("true", "1", "yes", "on"):
        return "true"
    if value in ("false", "0", "no", "off"):
        return "false"
    return "auto"


@dataclass(frozen=True)
class AppConfig:
    """Immutable snapshot of the environment configuration.

    ``secret_key`` is never logged or echoed; ``secret_key_ephemeral`` is True
    when the key was generated at boot because ``APP_SECRET_KEY`` was unset.
    """

    mongodb_uri: str
    mongodb_db: str
    secret_key: str
    secret_key_ephemeral: bool
    session_ttl_days: int
    cookie_secure: str  # "auto" | "true" | "false"
    allow_registration: bool
    allow_env_key_fallback: bool
    rate_limit_llm_calls: int
    rate_limit_llm_window_seconds: int
    rate_limit_general_calls: int
    rate_limit_general_window_seconds: int
    login_max_attempts: int
    login_window_seconds: int
    max_resumes_per_user: int
    max_versions_per_resume: int
    max_jds_per_user: int
    max_versions_per_jd: int
    max_runs_per_user: int
    max_pdf_upload_bytes: int
    pdftotext_bin: str
    pdf_extract_timeout_seconds: int

    @property
    def session_ttl_seconds(self) -> int:
        return self.session_ttl_days * 86_400


def load_config() -> AppConfig:
    """Build an :class:`AppConfig` from the current process environment.

    Resolved once at app creation (rule: mode and limits are decided at boot,
    not per request). All bounds below are documented in ``.env.example``.
    """

    secret_key = os.getenv("APP_SECRET_KEY", "").strip()
    secret_key_ephemeral = not secret_key
    if secret_key_ephemeral:
        secret_key = secrets.token_urlsafe(32)

    return AppConfig(
        mongodb_uri=os.getenv("MONGODB_URI", "").strip(),
        mongodb_db=os.getenv("MONGODB_DB", "jd_resume_builder").strip() or "jd_resume_builder",
        secret_key=secret_key,
        secret_key_ephemeral=secret_key_ephemeral,
        session_ttl_days=_bounded_int("SESSION_TTL_DAYS", 30, 1, 90),
        cookie_secure=_cookie_secure_mode(os.getenv("COOKIE_SECURE", "auto")),
        allow_registration=_env_bool("ALLOW_REGISTRATION", True),
        allow_env_key_fallback=_env_bool("ALLOW_ENV_KEY_FALLBACK", False),
        rate_limit_llm_calls=_bounded_int("RATE_LIMIT_LLM_CALLS", 10, 1, 1_000),
        rate_limit_llm_window_seconds=_bounded_int(
            "RATE_LIMIT_LLM_WINDOW_SECONDS", 300, 10, 3_600
        ),
        rate_limit_general_calls=_bounded_int("RATE_LIMIT_GENERAL_CALLS", 120, 10, 10_000),
        rate_limit_general_window_seconds=_bounded_int(
            "RATE_LIMIT_GENERAL_WINDOW_SECONDS", 60, 1, 3_600
        ),
        login_max_attempts=_bounded_int("LOGIN_MAX_ATTEMPTS", 10, 1, 100),
        login_window_seconds=_bounded_int("LOGIN_WINDOW_SECONDS", 900, 10, 3_600),
        max_resumes_per_user=_bounded_int("MAX_RESUMES_PER_USER", 10, 1, 100),
        max_versions_per_resume=_bounded_int("MAX_VERSIONS_PER_RESUME", 20, 1, 100),
        max_jds_per_user=_bounded_int("MAX_JDS_PER_USER", 50, 1, 500),
        max_versions_per_jd=_bounded_int("MAX_VERSIONS_PER_JD", 20, 1, 100),
        max_runs_per_user=_bounded_int("MAX_RUNS_PER_USER", 200, 10, 2_000),
        max_pdf_upload_bytes=_bounded_int(
            "MAX_PDF_UPLOAD_BYTES", 10_000_000, 1_000_000, 20_000_000
        ),
        pdftotext_bin=os.getenv("PDFTOTEXT_BIN", "pdftotext").strip() or "pdftotext",
        pdf_extract_timeout_seconds=_bounded_int("PDF_EXTRACT_TIMEOUT_SECONDS", 30, 10, 120),
    )
