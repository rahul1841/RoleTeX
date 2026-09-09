"""Application configuration loaded from environment variables.

Every numeric knob is clamped to a documented range (rule C-5) so a bad or
hostile environment value can never disable a safety limit. ``APP_SECRET_KEY``
protects session-independent secrets (Fernet encryption of user API keys); if
it is unset a random ephemeral key is generated so the app still boots, and
the config records that fact so ``/api/health`` can surface the warning —
encrypted provider keys become unreadable after a restart in that state
(sessions are unaffected: their token hashes do not involve this key).
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


def _public_base_url(raw: str) -> str:
    """Normalize ``PUBLIC_BASE_URL`` to a scheme-qualified origin with no trailing slash.

    Only http/https are accepted: this value is interpolated into password-reset
    links, so a ``javascript:`` or ``data:`` origin must never survive.
    """

    value = (raw or "").strip().rstrip("/")
    if not value:
        return ""
    lowered = value.lower()
    if not (lowered.startswith("http://") or lowered.startswith("https://")):
        return ""
    return value


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
    require_email_verification: bool
    password_reset_ttl_minutes: int
    email_verify_ttl_hours: int
    public_base_url: str
    mail_from: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_starttls: bool
    smtp_timeout_seconds: int
    rate_limit_email_calls: int
    rate_limit_email_window_seconds: int
    rate_limit_llm_calls: int
    rate_limit_llm_window_seconds: int
    rate_limit_llm_ip_calls: int
    rate_limit_general_calls: int
    rate_limit_general_window_seconds: int
    trust_proxy_headers: bool
    trusted_proxy_hops: int
    login_max_attempts: int
    login_window_seconds: int
    max_resumes_per_user: int
    max_versions_per_resume: int
    max_jds_per_user: int
    max_versions_per_jd: int
    max_runs_per_user: int
    max_pdf_upload_bytes: int
    max_import_pdf_pages: int
    pdftotext_bin: str
    pdfinfo_bin: str
    pdftoppm_bin: str
    pdftohtml_bin: str
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
        require_email_verification=_env_bool("REQUIRE_EMAIL_VERIFICATION", False),
        password_reset_ttl_minutes=_bounded_int(
            "PASSWORD_RESET_TTL_MINUTES", 60, 5, 1_440
        ),
        email_verify_ttl_hours=_bounded_int("EMAIL_VERIFY_TTL_HOURS", 48, 1, 168),
        public_base_url=_public_base_url(os.getenv("PUBLIC_BASE_URL", "")),
        mail_from=os.getenv("MAIL_FROM", "").strip() or "roletex@localhost",
        smtp_host=os.getenv("SMTP_HOST", "").strip(),
        smtp_port=_bounded_int("SMTP_PORT", 587, 1, 65_535),
        smtp_username=os.getenv("SMTP_USERNAME", "").strip(),
        smtp_password=os.getenv("SMTP_PASSWORD", ""),
        smtp_starttls=_env_bool("SMTP_STARTTLS", True),
        smtp_timeout_seconds=_bounded_int("SMTP_TIMEOUT_SECONDS", 15, 5, 120),
        rate_limit_email_calls=_bounded_int("RATE_LIMIT_EMAIL_CALLS", 5, 1, 100),
        rate_limit_email_window_seconds=_bounded_int(
            "RATE_LIMIT_EMAIL_WINDOW_SECONDS", 900, 60, 86_400
        ),
        rate_limit_llm_calls=_bounded_int("RATE_LIMIT_LLM_CALLS", 10, 1, 1_000),
        rate_limit_llm_window_seconds=_bounded_int(
            "RATE_LIMIT_LLM_WINDOW_SECONDS", 300, 10, 3_600
        ),
        rate_limit_llm_ip_calls=_bounded_int("RATE_LIMIT_LLM_IP_CALLS", 30, 1, 5_000),
        rate_limit_general_calls=_bounded_int("RATE_LIMIT_GENERAL_CALLS", 120, 10, 10_000),
        rate_limit_general_window_seconds=_bounded_int(
            "RATE_LIMIT_GENERAL_WINDOW_SECONDS", 60, 1, 3_600
        ),
        trust_proxy_headers=_env_bool("TRUST_PROXY_HEADERS", False),
        trusted_proxy_hops=_bounded_int("TRUSTED_PROXY_HOPS", 1, 1, 10),
        login_max_attempts=_bounded_int("LOGIN_MAX_ATTEMPTS", 10, 1, 100),
        login_window_seconds=_bounded_int("LOGIN_WINDOW_SECONDS", 900, 10, 3_600),
        max_resumes_per_user=_bounded_int("MAX_RESUMES_PER_USER", 10, 1, 100),
        max_versions_per_resume=_bounded_int("MAX_VERSIONS_PER_RESUME", 20, 1, 100),
        max_jds_per_user=_bounded_int("MAX_JDS_PER_USER", 50, 1, 500),
        max_versions_per_jd=_bounded_int("MAX_VERSIONS_PER_JD", 20, 1, 100),
        max_runs_per_user=_bounded_int("MAX_RUNS_PER_USER", 200, 10, 2_000),
        max_pdf_upload_bytes=_bounded_int(
            "MAX_PDF_UPLOAD_BYTES", 5_000_000, 1_000_000, 20_000_000
        ),
        # A resume is a short document. The bound keeps a mistaken upload (or a
        # deliberate one) from being billed as LLM input; see app/pdftext.py.
        max_import_pdf_pages=_bounded_int("MAX_IMPORT_PDF_PAGES", 3, 1, 20),
        pdftotext_bin=os.getenv("PDFTOTEXT_BIN", "pdftotext").strip() or "pdftotext",
        pdfinfo_bin=os.getenv("PDFINFO_BIN", "pdfinfo").strip() or "pdfinfo",
        pdftoppm_bin=os.getenv("PDFTOPPM_BIN", "pdftoppm").strip() or "pdftoppm",
        pdftohtml_bin=os.getenv("PDFTOHTML_BIN", "pdftohtml").strip() or "pdftohtml",
        pdf_extract_timeout_seconds=_bounded_int("PDF_EXTRACT_TIMEOUT_SECONDS", 30, 10, 120),
    )
