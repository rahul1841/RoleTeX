"""End-to-end tests for the import endpoint and tailoring by stored id."""

from __future__ import annotations

from pathlib import Path
from typing import Any, List, Optional

import httpx
import pytest

from app.compiler import CompileResult
from app.llm import LLMResponseError
from app.main import MAX_IMPORT_BODY_BYTES, create_app
from app.storage import UserResumeStore


SAMPLE_LATEX = (
    r"\documentclass{article}\begin{document}"
    r"Jane Doe \\ jane@example.com \\ Berlin. Senior Engineer at Acme (2021-Present)."
    r"\end{document}"
)


class StubCompiler:
    def __init__(self, results: Optional[List[CompileResult]] = None) -> None:
        self.results = list(results or [])
        self.only_cached = True
        self.calls: List[Any] = []

    def is_available(self) -> bool:
        return True

    async def compile(self, latex_source: str, assets_dir=None) -> CompileResult:
        self.calls.append(latex_source)
        return self.results.pop(0)


class FailingExtractionLLM:
    configured_provider = "stub"

    async def extract_resume(self, latex_source, provider=None, model=None):
        raise LLMResponseError("no json here", raw_content="garbage")


async def _request(app, method: str, path: str, **kwargs: Any) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.request(method, path, **kwargs)


@pytest.mark.asyncio
async def test_import_creates_profile_then_tailor_uses_stored_resume(tmp_path: Path) -> None:
    store = UserResumeStore(base_dir=tmp_path / "data")
    app = create_app(static_dir=tmp_path / "static", store=store)

    imported = await _request(
        app, "POST", "/api/import", json={"latex": SAMPLE_LATEX, "provider": "mock"}
    )
    assert imported.status_code == 200, imported.text
    body = imported.json()
    resume_id = body["id"]
    assert body["resume"]["identity"]["email"] == "imported.user@example.com"
    assert body["style"]["paper"] == "a4paper"
    assert (tmp_path / "data" / resume_id / "data.json").is_file()
    assert (tmp_path / "data" / resume_id / "source.tex").is_file()

    jd = (
        "Backend engineer strong in Python and SQL to build reliable services "
        "and scale data pipelines for a growing platform team."
    )
    tailored = await _request(
        app,
        "POST",
        "/api/tailor",
        json={"job_description": jd, "resume_id": resume_id, "compile": False, "provider": "mock"},
    )
    assert tailored.status_code == 200, tailored.text
    latex_source = tailored.json()["latex_source"]
    assert "@@" not in latex_source
    assert "imported.user@example.com" in latex_source


@pytest.mark.asyncio
async def test_import_then_compile_uses_sectioned_template(tmp_path: Path) -> None:
    store = UserResumeStore(base_dir=tmp_path / "data")
    compiler = StubCompiler(
        [CompileResult(success=True, pdf_bytes=b"%PDF-ok", page_count=1)]
    )
    app = create_app(compiler=compiler, static_dir=tmp_path / "static", store=store)

    imported = await _request(
        app, "POST", "/api/import", json={"latex": SAMPLE_LATEX, "provider": "mock"}
    )
    resume_id = imported.json()["id"]

    jd = "Backend engineer to build reliable Python services and scale data platforms for the team."
    tailored = await _request(
        app,
        "POST",
        "/api/tailor",
        json={"job_description": jd, "resume_id": resume_id, "provider": "mock"},
    )
    assert tailored.status_code == 200, tailored.text
    assert tailored.json()["page_count"] == 1
    # Sectioned rendering means no header remains for the empty projects section.
    assert r"\header{Projects}" not in compiler.calls[0]
    assert r"\header{Experience}" in compiler.calls[0]


@pytest.mark.asyncio
async def test_import_rejects_oversized_body_before_validation(tmp_path: Path) -> None:
    app = create_app(static_dir=tmp_path / "static", store=UserResumeStore(base_dir=tmp_path / "data"))

    response = await _request(
        app,
        "POST",
        "/api/import",
        content=b"{}",
        headers={
            "content-type": "application/json",
            "content-length": str(MAX_IMPORT_BODY_BYTES + 1),
        },
    )

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "request_too_large"


@pytest.mark.asyncio
async def test_tailor_with_unknown_resume_id_returns_404(tmp_path: Path) -> None:
    import uuid

    app = create_app(static_dir=tmp_path / "static", store=UserResumeStore(base_dir=tmp_path / "data"))

    response = await _request(
        app,
        "POST",
        "/api/tailor",
        json={
            "job_description": "A valid job description that is comfortably over the fifty character minimum length.",
            "resume_id": uuid.uuid4().hex,
            "compile": False,
            "provider": "mock",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "resume_not_found"


@pytest.mark.asyncio
async def test_import_extraction_failure_returns_422(tmp_path: Path) -> None:
    app = create_app(
        llm_client=FailingExtractionLLM(),
        static_dir=tmp_path / "static",
        store=UserResumeStore(base_dir=tmp_path / "data"),
    )

    response = await _request(
        app, "POST", "/api/import", json={"latex": SAMPLE_LATEX}
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_extraction"
