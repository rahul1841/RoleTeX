"""Shared fixtures for the resume builder test suite."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import httpx
import pytest
from mongomock_motor import AsyncMongoMockClient

from app.db import Database
from app.llm import LLMExtractResult, LLMResult
from app.llm_stub import mock_extraction
from app.main import create_app
from app.resume import ResumeRepository, flattened_skills
from app.schemas import TailorProposal, dump_model


PROJECT_ROOT = Path(__file__).resolve().parents[1]

SAMPLE_LATEX = (
    r"\documentclass{article}\begin{document}"
    r"Jane Doe \\ jane@example.com \\ Berlin. Senior Engineer at Acme (2021-Present)."
    r"\end{document}"
)

_MODE_ENV_VARS = (
    "MONGODB_URI",
    "MONGODB_DB",
    "APP_SECRET_KEY",
    "SESSION_TTL_DAYS",
    "COOKIE_SECURE",
    "ALLOW_REGISTRATION",
    "ALLOW_ENV_KEY_FALLBACK",
    "RATE_LIMIT_LLM_CALLS",
    "RATE_LIMIT_LLM_WINDOW_SECONDS",
    "RATE_LIMIT_LLM_IP_CALLS",
    "RATE_LIMIT_GENERAL_CALLS",
    "RATE_LIMIT_GENERAL_WINDOW_SECONDS",
    "TRUST_PROXY_HEADERS",
    "TRUSTED_PROXY_HOPS",
    "LOGIN_MAX_ATTEMPTS",
    "LOGIN_WINDOW_SECONDS",
    "MAX_RESUMES_PER_USER",
    "MAX_VERSIONS_PER_RESUME",
    "MAX_JDS_PER_USER",
    "MAX_RUNS_PER_USER",
    "MAX_PDF_UPLOAD_BYTES",
    "PDFTOTEXT_BIN",
    "PDF_EXTRACT_TIMEOUT_SECONDS",
    "MAX_VERSIONS_PER_JD",
    "REQUIRE_EMAIL_VERIFICATION",
    "PASSWORD_RESET_TTL_MINUTES",
    "EMAIL_VERIFY_TTL_HOURS",
    "PUBLIC_BASE_URL",
    "MAIL_FROM",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USERNAME",
    "SMTP_PASSWORD",
    "SMTP_STARTTLS",
    "SMTP_TIMEOUT_SECONDS",
    "RATE_LIMIT_EMAIL_CALLS",
    "RATE_LIMIT_EMAIL_WINDOW_SECONDS",
    "LLM_PROVIDER",
    "LLM_API_KEY",
    "GROQ_API_KEY",
    "ANTHROPIC_API_KEY",
)


@pytest.fixture(autouse=True)
def _clean_app_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep every test deterministic regardless of the developer's shell env."""

    for name in _MODE_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def repository() -> ResumeRepository:
    return ResumeRepository(
        data_path=PROJECT_ROOT / "resume" / "data.json",
        template_path=PROJECT_ROOT / "resume" / "template.tex",
        assets_dir=PROJECT_ROOT / "resume" / "assets",
    )


@pytest.fixture
def resume(repository: ResumeRepository):
    return repository.load_data()


@pytest.fixture
def template(repository: ResumeRepository) -> str:
    return repository.load_template()


@pytest.fixture
def raw_resume_data() -> Dict[str, Any]:
    return json.loads((PROJECT_ROOT / "resume" / "data.json").read_text(encoding="utf-8"))


@pytest.fixture
def baseline_proposal(resume) -> TailorProposal:
    return TailorProposal(
        summary=resume.summary,
        bullet_rewrites=[],
        skills_order=flattened_skills(resume),
    )


@pytest.fixture
def proposal_factory(resume) -> Callable[..., TailorProposal]:
    def factory(**overrides: Any) -> TailorProposal:
        values: Dict[str, Any] = {
            "summary": resume.summary,
            "bullet_rewrites": [],
            "skills_order": flattened_skills(resume),
        }
        values.update(overrides)
        return TailorProposal(**values)

    return factory


@pytest.fixture
def valid_job_description() -> str:
    return (
        "We are hiring a backend engineer to build reliable Python and FastAPI "
        "services, improve PostgreSQL performance, and maintain Docker delivery workflows."
    )


# ---------------------------------------------------------------------------
# Multi-user API fixtures
# ---------------------------------------------------------------------------


class RecordingStubLLM:
    """Stub LLM for multi-user tests; records the api_key each call received."""

    configured_provider = "stub"

    def __init__(
        self,
        proposal: Optional[TailorProposal] = None,
        repair_proposal: Optional[TailorProposal] = None,
        provider: str = "stub",
    ) -> None:
        self.proposal = proposal
        self.repair_proposal = repair_proposal or proposal
        self.provider = provider
        self.generate_calls: List[Dict[str, Any]] = []
        self.repair_calls: List[Dict[str, Any]] = []
        self.extract_calls: List[Dict[str, Any]] = []

    async def generate(
        self, resume, job_description: str, provider=None, model=None, api_key=None
    ) -> LLMResult:
        self.generate_calls.append(
            {
                "resume": resume,
                "job_description": job_description,
                "provider": provider,
                "model": model,
                "api_key": api_key,
            }
        )
        raw = json.dumps(dump_model(self.proposal))
        return LLMResult(self.proposal, self.provider, "stub-model", raw)

    async def repair(
        self,
        resume,
        job_description: str,
        issue: str,
        previous_output: str,
        provider=None,
        model=None,
        api_key=None,
    ) -> LLMResult:
        self.repair_calls.append(
            {
                "resume": resume,
                "job_description": job_description,
                "issue": issue,
                "previous_output": previous_output,
                "provider": provider,
                "model": model,
                "api_key": api_key,
            }
        )
        raw = json.dumps(dump_model(self.repair_proposal))
        return LLMResult(self.repair_proposal, self.provider, "stub-model", raw)

    async def extract_resume(
        self,
        source: str,
        provider=None,
        model=None,
        api_key=None,
        source_kind: str = "latex",
    ) -> LLMExtractResult:
        self.extract_calls.append(
            {
                "source": source,
                "provider": provider,
                "model": model,
                "api_key": api_key,
                "source_kind": source_kind,
            }
        )
        resume, style = mock_extraction(source)
        return LLMExtractResult(
            resume, style, provider or self.provider, model or "stub-model", "{}"
        )


class RecordingMailer:
    """Test mailer that captures messages instead of sending them.

    ``delivers`` defaults to True so tests exercise the production branch of
    :func:`app.routes_account._link_base` (which requires ``PUBLIC_BASE_URL``);
    set it False to model the console driver.
    """

    driver = "recording"

    def __init__(self, delivers: bool = True, fail: bool = False) -> None:
        self.delivers = delivers
        self.fail = fail
        self.sent: List[Dict[str, str]] = []

    async def send(self, to: str, subject: str, body: str) -> None:
        if self.fail:
            from app.mailer import MailDeliveryError

            raise MailDeliveryError("boom")
        self.sent.append({"to": to, "subject": subject, "body": body})

    def last_link(self) -> str:
        """Extract the one-time link from the most recent message."""

        assert self.sent, "no message was sent"
        for word in self.sent[-1]["body"].split():
            if "token=" in word:
                return word
        raise AssertionError("no token link in message body")

    def last_token(self) -> str:
        return self.last_link().split("token=", 1)[1].strip()


@pytest.fixture
def mailer() -> RecordingMailer:
    return RecordingMailer()


@pytest.fixture
def _fast_password_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Speed up API tests: fewer PBKDF2 iterations for throwaway accounts.

    ``verify_password`` reads the iteration count back from the stored hash,
    so lowering the constant only affects hashes created inside these tests.
    ``tests/test_security.py`` never uses this fixture and keeps exercising
    the real 600k-iteration parameters.
    """

    from app import security

    monkeypatch.setattr(security, "PBKDF2_ITERATIONS", 1_000)


@pytest.fixture
async def database() -> Database:
    db = Database(AsyncMongoMockClient()["testdb"])
    await db.ensure_indexes()
    return db


@pytest.fixture
def make_app(
    database: Database,
    repository: ResumeRepository,
    tmp_path: Path,
    mailer: "RecordingMailer",
    _fast_password_hashing: None,
):
    """Factory for multi-user (default) or demo apps with injected doubles."""

    def factory(
        llm: Any = None,
        compiler: Any = None,
        pdf_extractor: Any = None,
        multi_user: bool = True,
        repo: Any = None,
        mail: Any = None,
    ):
        return create_app(
            repository=repo or repository,
            llm_client=llm,
            compiler=compiler,
            static_dir=tmp_path / "static",
            database=database if multi_user else None,
            pdf_extractor=pdf_extractor,
            mailer=mail if mail is not None else mailer,
        )

    return factory


@pytest.fixture
def make_client():
    """HTTP client factory; each client keeps its own cookie jar (one user)."""

    def factory(app) -> httpx.AsyncClient:
        transport = httpx.ASGITransport(app=app)
        return httpx.AsyncClient(transport=transport, base_url="http://testserver")

    return factory


@pytest.fixture
def register_user():
    """Register (and thereby sign in) a user on the given client."""

    async def _register(
        client: httpx.AsyncClient,
        email: str = "user@example.com",
        password: str = "password123",
        name: str = "Test User",
    ) -> Dict[str, Any]:
        response = await client.post(
            "/api/auth/register",
            json={"email": email, "password": password, "name": name},
        )
        assert response.status_code == 201, response.text
        return response.json()["user"]

    return _register
