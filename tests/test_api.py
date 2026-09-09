"""End-to-end API tests with injected network and compiler doubles."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any, List, Optional

import httpx
import pytest

from app.compiler import CompileResult
from app.llm import LLMResponseError, LLMResult
from app.main import MAX_HTTP_BODY_BYTES, create_app
from app.resume import ResumeError, flattened_skills
from app.schemas import TailorProposal, dump_model


class StubLLM:
    configured_provider = "stub"

    def __init__(
        self,
        proposal: TailorProposal,
        repair_proposal: Optional[TailorProposal] = None,
        provider: str = "stub",
    ) -> None:
        self.proposal = proposal
        self.repair_proposal = repair_proposal or proposal
        self.provider = provider
        self.generate_calls: List[Any] = []
        self.repair_calls: List[Any] = []

    async def generate(
        self, resume, job_description: str, provider=None, model=None
    ) -> LLMResult:
        self.generate_calls.append((resume, job_description, provider, model))
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
    ) -> LLMResult:
        self.repair_calls.append(
            (resume, job_description, issue, previous_output, provider, model)
        )
        raw = json.dumps(dump_model(self.repair_proposal))
        return LLMResult(self.repair_proposal, self.provider, "stub-model", raw)


class InvalidResponseLLM(StubLLM):
    async def generate(self, resume, job_description: str, provider=None, model=None):
        self.generate_calls.append((resume, job_description, provider, model))
        raise LLMResponseError("bad initial output", raw_content="not-json")

    async def repair(
        self,
        resume,
        job_description: str,
        issue: str,
        previous_output: str,
        provider=None,
        model=None,
    ):
        self.repair_calls.append(
            (resume, job_description, issue, previous_output, provider, model)
        )
        raise LLMResponseError("bad repaired output", raw_content="still-not-json")


class StubCompiler:
    def __init__(
        self,
        results: Optional[List[CompileResult]] = None,
        available: bool = True,
    ) -> None:
        self.results = list(results or [])
        self.available = available
        self.only_cached = True
        self.calls: List[Any] = []

    def is_available(self) -> bool:
        return self.available

    async def compile(self, latex_source: str, assets_dir=None) -> CompileResult:
        self.calls.append((latex_source, assets_dir))
        if not self.results:
            raise AssertionError("unexpected compiler call")
        return self.results.pop(0)


class BrokenRepository:
    assets_dir = None

    def load(self):
        raise ResumeError("broken locked source")


def _changed_proposal(resume, summary: Optional[str] = None) -> TailorProposal:
    return TailorProposal(
        summary=summary or "Backend engineer focused on reliable Python services and cloud delivery.",
        bullet_rewrites=[
            {
                "id": resume.projects[0].bullets[0].id,
                "text": "Built a safe schema-validated resume tailoring workflow.",
            }
        ],
        skills_order=list(reversed(flattened_skills(resume))),
    )


async def _request(app, method: str, path: str, **kwargs: Any) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.request(method, path, **kwargs)


@pytest.mark.asyncio
async def test_health_reports_all_injected_services_ready(
    repository, resume, baseline_proposal, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("LLM_MODEL", raising=False)
    llm = StubLLM(baseline_proposal)
    compiler = StubCompiler(available=True)
    app = create_app(repository, llm, compiler, static_dir=tmp_path / "static")

    response = await _request(app, "GET", "/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["resume_valid"] is True
    assert body["compiler_available"] is True
    assert body["provider"] == "stub"
    assert body["model"] == "injected"
    assert body["checks"]["resume"] == "ok"
    assert body["checks"]["compiler"] == "ok"
    assert body["checks"]["compiler_only_cached"] is True
    assert body["checks"]["llm"] == "injected"


@pytest.mark.asyncio
async def test_health_reports_demo_mode_without_database(
    repository, baseline_proposal, tmp_path: Path
) -> None:
    app = create_app(
        repository,
        StubLLM(baseline_proposal),
        StubCompiler(available=True),
        static_dir=tmp_path / "static",
    )

    response = await _request(app, "GET", "/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "demo"
    assert body["checks"]["database"] == "not_configured"
    assert body["checks"]["secret_key"] == "ephemeral"
    assert "pdftotext" in body["checks"]
    # Demo mode never degrades for the missing database.
    assert body["status"] == "ok"


@pytest.mark.asyncio
async def test_health_reports_multi_user_mode_with_user_keys(
    repository, baseline_proposal, tmp_path: Path, database, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    app = create_app(
        repository,
        StubLLM(baseline_proposal),
        StubCompiler(available=True),
        static_dir=tmp_path / "static",
        database=database,
    )

    response = await _request(app, "GET", "/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "multi_user"
    assert body["checks"]["database"] == "ok"
    # Without an env provider, users bring their own keys — not degraded.
    assert body["checks"]["llm"] == "user_keys"
    assert body["status"] == "ok"


@pytest.mark.asyncio
async def test_health_is_degraded_when_resume_and_compiler_are_unavailable(
    baseline_proposal, tmp_path: Path
) -> None:
    app = create_app(
        BrokenRepository(),
        StubLLM(baseline_proposal),
        StubCompiler(available=False),
        static_dir=tmp_path / "static",
    )

    response = await _request(app, "GET", "/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["resume_valid"] is False
    assert body["compiler_available"] is False
    assert "broken locked source" in body["checks"]["resume"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"job_description": "too short"},
        {"job_description": "x" * 20_001},
        {"job_description": "x" * 60, "unexpected": True},
        {"job_description": "x" * 60, "provider": ""},
    ],
)
async def test_tailor_request_schema_rejects_invalid_input(
    repository, baseline_proposal, tmp_path: Path, payload
) -> None:
    app = create_app(
        repository,
        StubLLM(baseline_proposal),
        StubCompiler(),
        static_dir=tmp_path / "static",
    )

    response = await _request(app, "POST", "/api/tailor", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"]


@pytest.mark.asyncio
async def test_api_rejects_declared_body_over_64kb_before_validation(
    repository, baseline_proposal, tmp_path: Path
) -> None:
    app = create_app(
        repository,
        StubLLM(baseline_proposal),
        StubCompiler(),
        static_dir=tmp_path / "static",
    )

    response = await _request(
        app,
        "POST",
        "/api/tailor",
        content=b"{}",
        headers={
            "content-type": "application/json",
            "content-length": str(MAX_HTTP_BODY_BYTES + 1),
        },
    )

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "request_too_large"


@pytest.mark.asyncio
async def test_compile_disabled_tailor_path_returns_preview_without_compiler(
    repository, resume, valid_job_description: str, tmp_path: Path
) -> None:
    proposal = _changed_proposal(resume)
    llm = StubLLM(proposal)
    compiler = StubCompiler()
    app = create_app(repository, llm, compiler, static_dir=tmp_path / "static")

    response = await _request(
        app,
        "POST",
        "/api/tailor",
        json={
            "job_description": valid_job_description,
            "compile": False,
            "provider": "mock",
            "model": "local-test",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert len(llm.generate_calls) == 1
    assert llm.generate_calls[0][1] == valid_job_description
    assert llm.generate_calls[0][2:] == ("mock", "local-test")
    assert compiler.calls == []
    assert body["provider"] == "stub"
    assert body["model"] == "stub-model"
    assert body["pdf_base64"] is None
    assert body["compiler"]["attempted"] is False
    assert body["compiler"]["success"] is True
    assert "Compilation was skipped" in body["warnings"][0]
    assert "@@" not in body["latex_source"]
    assert resume.identity.email in body["latex_source"]
    assert {change["field_id"] for change in body["changes"]} == {
        "summary",
        resume.projects[0].bullets[0].id,
        "skills_order",
    }
    assert "--- original" in body["unified_diff"]


@pytest.mark.asyncio
async def test_compiled_tailor_path_returns_base64_pdf_and_report(
    repository, resume, valid_job_description: str, tmp_path: Path
) -> None:
    pdf = b"%PDF-1.4\ncompiled result\n%%EOF\n"
    compiler = StubCompiler(
        [
            CompileResult(
                success=True,
                pdf_bytes=pdf,
                page_count=1,
                extracted_text="Rahul Kumar Python FastAPI",
                warnings=["visual review recommended"],
                log="successful compiler noise",
            )
        ]
    )
    llm = StubLLM(_changed_proposal(resume))
    app = create_app(repository, llm, compiler, static_dir=tmp_path / "static")

    response = await _request(
        app,
        "POST",
        "/api/tailor",
        json={"job_description": valid_job_description},
    )

    assert response.status_code == 200
    body = response.json()
    assert base64.b64decode(body["pdf_base64"]) == pdf
    assert body["pdf_data_url"] is None
    assert body["filename"] == "tailored-resume.pdf"
    assert body["page_count"] == 1
    assert body["compiler"] == {
        "attempted": True,
        "success": True,
        "page_count": 1,
        "text_preview": "Rahul Kumar Python FastAPI",
        "warnings": ["visual review recommended"],
        "log": None,
    }
    assert body["warnings"] == ["visual review recommended"]
    assert len(compiler.calls) == 1
    assert "@@" not in compiler.calls[0][0]


@pytest.mark.asyncio
async def test_invalid_initial_proposal_gets_exactly_one_semantic_repair(
    repository, resume, valid_job_description: str, tmp_path: Path
) -> None:
    invalid = TailorProposal(
        summary=resume.summary,
        bullet_rewrites=[{"id": "unknown_id", "text": "Unknown work"}],
        skills_order=flattened_skills(resume),
    )
    valid = _changed_proposal(resume)
    llm = StubLLM(invalid, repair_proposal=valid)
    compiler = StubCompiler()
    app = create_app(repository, llm, compiler, static_dir=tmp_path / "static")

    response = await _request(
        app,
        "POST",
        "/api/tailor",
        json={"job_description": valid_job_description, "compile": False},
    )

    assert response.status_code == 200
    assert response.json()["repaired"] is True
    assert len(llm.generate_calls) == 1
    assert len(llm.repair_calls) == 1
    assert "unknown bullet IDs" in llm.repair_calls[0][2]


@pytest.mark.asyncio
async def test_two_invalid_llm_outputs_return_structured_422(
    repository, baseline_proposal, valid_job_description: str, tmp_path: Path
) -> None:
    llm = InvalidResponseLLM(baseline_proposal)
    app = create_app(repository, llm, StubCompiler(), static_dir=tmp_path / "static")

    response = await _request(
        app,
        "POST",
        "/api/tailor",
        json={"job_description": valid_job_description, "compile": False},
    )

    assert response.status_code == 422
    body = response.json()["detail"]
    assert body["code"] == "invalid_llm_proposal"
    assert "after one repair attempt" in body["message"]
    assert len(llm.generate_calls) == 1
    assert len(llm.repair_calls) == 1
    assert llm.repair_calls[0][3] == "not-json"


@pytest.mark.asyncio
async def test_one_page_overflow_gets_one_repair_and_second_compile(
    repository, resume, valid_job_description: str, tmp_path: Path
) -> None:
    initial = _changed_proposal(resume)
    repaired = _changed_proposal(
        resume, summary="Python backend engineer focused on reliable services."
    )
    compiler = StubCompiler(
        [
            CompileResult(success=True, pdf_bytes=b"%PDF-first", page_count=2),
            CompileResult(success=True, pdf_bytes=b"%PDF-second", page_count=1),
        ]
    )
    llm = StubLLM(initial, repair_proposal=repaired, provider="stub")
    app = create_app(repository, llm, compiler, static_dir=tmp_path / "static")

    response = await _request(
        app,
        "POST",
        "/api/tailor",
        json={"job_description": valid_job_description, "require_one_page": True},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["repaired"] is True
    assert body["page_count"] == 1
    assert base64.b64decode(body["pdf_base64"]) == b"%PDF-second"
    assert len(llm.repair_calls) == 1
    assert "has 2 pages" in llm.repair_calls[0][2]
    assert len(compiler.calls) == 2


@pytest.mark.asyncio
async def test_compile_repair_redacts_identity_from_compiler_excerpt(
    repository, resume, valid_job_description: str, tmp_path: Path
) -> None:
    proposal = _changed_proposal(resume)
    compiler = StubCompiler(
        [
            CompileResult(
                success=False,
                error_code="latex_compile_failed",
                log="Failure echoed {0}, {1}, and {2}".format(
                    resume.identity.name,
                    resume.identity.email,
                    resume.identity.links[0].url,
                ),
            ),
            CompileResult(success=True, pdf_bytes=b"%PDF-repaired", page_count=1),
        ]
    )
    llm = StubLLM(proposal, repair_proposal=proposal, provider="stub")
    app = create_app(repository, llm, compiler, static_dir=tmp_path / "static")

    response = await _request(
        app,
        "POST",
        "/api/tailor",
        json={"job_description": valid_job_description},
    )

    assert response.status_code == 200
    assert len(llm.repair_calls) == 1
    repair_issue = llm.repair_calls[0][2]
    assert "[REDACTED_IDENTITY]" in repair_issue
    assert resume.identity.name not in repair_issue
    assert resume.identity.email not in repair_issue
    assert resume.identity.links[0].url not in repair_issue
    assert len(compiler.calls) == 2


@pytest.mark.asyncio
async def test_compiler_not_found_maps_to_structured_503_without_llm_repair(
    repository, resume, valid_job_description: str, tmp_path: Path
) -> None:
    compiler = StubCompiler(
        [
            CompileResult(
                success=False,
                error_code="compiler_not_found",
                log="Tectonic was not found",
            )
        ]
    )
    llm = StubLLM(_changed_proposal(resume), provider="mock")
    app = create_app(repository, llm, compiler, static_dir=tmp_path / "static")

    response = await _request(
        app,
        "POST",
        "/api/tailor",
        json={"job_description": valid_job_description},
    )

    assert response.status_code == 503
    body = response.json()["detail"]
    assert body["code"] == "compiler_not_found"
    assert body["compiler_log"] == "Tectonic was not found"
    assert llm.repair_calls == []


@pytest.mark.asyncio
async def test_broken_resume_configuration_returns_safe_500(
    baseline_proposal, valid_job_description: str, tmp_path: Path
) -> None:
    app = create_app(
        BrokenRepository(),
        StubLLM(baseline_proposal),
        StubCompiler(),
        static_dir=tmp_path / "static",
    )

    response = await _request(
        app,
        "POST",
        "/api/tailor",
        json={"job_description": valid_job_description},
    )

    assert response.status_code == 500
    body = response.json()["detail"]
    assert body["code"] == "resume_configuration_error"
    assert "broken locked source" not in json.dumps(body)
