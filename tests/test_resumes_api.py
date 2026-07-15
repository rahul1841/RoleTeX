"""Resume library API tests: LaTeX import, PDF import, versions, ownership."""

from __future__ import annotations

from typing import Any, Optional

import pytest

from app.llm import LLMResponseError
from app.pdftext import PdfExtractionError
from tests.conftest import SAMPLE_LATEX


PDF_BYTES = b"%PDF-1.4 fake but correctly-tagged upload"
PDF_TEXT = (
    "Jane Doe jane@example.com Berlin. Senior Engineer at Acme since 2021, "
    "building reliable backend services in Python and SQL for production use."
)


class FailingExtractionLLM:
    configured_provider = "stub"

    async def extract_resume(
        self, source: str, provider=None, model=None, api_key=None, source_kind="latex"
    ) -> Any:
        raise LLMResponseError("no json here", raw_content="garbage")


def _raising_extractor(code: str):
    def extractor(pdf_bytes: bytes) -> str:
        raise PdfExtractionError("boom", code)

    return extractor


async def _import_resume(client, name: Optional[str] = None) -> dict:
    payload = {"latex": SAMPLE_LATEX, "provider": "mock"}
    if name is not None:
        payload["name"] = name
    response = await client.post("/api/resumes", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def test_resumes_require_auth_and_database(make_app, make_client) -> None:
    multi = make_app()
    async with make_client(multi) as client:
        response = await client.get("/api/resumes")
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "not_authenticated"

    demo = make_app(multi_user=False)
    async with make_client(demo) as client:
        response = await client.get("/api/resumes")
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "database_not_configured"


async def test_latex_import_creates_versioned_resume(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        body = await _import_resume(client)

        detail = body["resume"]
        assert detail["source_type"] == "latex"
        assert detail["version"] == 1
        assert detail["name"].startswith("Imported User —")
        assert detail["data"]["identity"]["email"] == "imported.user@example.com"
        assert detail["style"]["paper"] == "a4paper"
        assert any("mock" in warning.lower() for warning in body["warnings"])
        assert any("review" in warning.lower() for warning in body["warnings"])

        listing = await client.get("/api/resumes")
        assert listing.status_code == 200
        summaries = listing.json()["resumes"]
        assert len(summaries) == 1
        assert summaries[0]["id"] == detail["id"]
        assert "data" not in summaries[0]

        fetched = await client.get("/api/resumes/{0}".format(detail["id"]))
        assert fetched.status_code == 200
        assert fetched.json()["resume"]["id"] == detail["id"]


async def test_import_honours_custom_name(make_app, make_client, register_user) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        body = await _import_resume(client, name="My best CV")
        assert body["resume"]["name"] == "My best CV"


async def test_resumes_are_isolated_between_users(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as owner, make_client(app) as intruder:
        await register_user(owner, email="owner@example.com")
        await register_user(intruder, email="intruder@example.com")
        resume_id = (await _import_resume(owner))["resume"]["id"]

        assert (await intruder.get("/api/resumes")).json()["resumes"] == []
        for method, path in [
            ("GET", "/api/resumes/{0}".format(resume_id)),
            ("DELETE", "/api/resumes/{0}".format(resume_id)),
            ("GET", "/api/resumes/{0}/versions".format(resume_id)),
            ("GET", "/api/resumes/{0}/versions/1/source".format(resume_id)),
        ]:
            response = await intruder.request(method, path)
            assert response.status_code == 404, path
            assert response.json()["detail"]["code"] == "resume_not_found"

        rename = await intruder.patch(
            "/api/resumes/{0}".format(resume_id), json={"name": "stolen"}
        )
        assert rename.status_code == 404


async def test_rename_and_delete_resume(make_app, make_client, register_user) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        resume_id = (await _import_resume(client))["resume"]["id"]

        renamed = await client.patch(
            "/api/resumes/{0}".format(resume_id), json={"name": "Renamed CV"}
        )
        assert renamed.status_code == 200
        assert renamed.json()["resume"]["name"] == "Renamed CV"

        deleted = await client.delete("/api/resumes/{0}".format(resume_id))
        assert deleted.status_code == 200
        assert deleted.json() == {"ok": True}
        assert (await client.get("/api/resumes/{0}".format(resume_id))).status_code == 404


async def test_resume_quota_is_enforced(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MAX_RESUMES_PER_USER", "1")
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        await _import_resume(client)

        second = await client.post(
            "/api/resumes", json={"latex": SAMPLE_LATEX, "provider": "mock"}
        )
        assert second.status_code == 409
        assert second.json()["detail"]["code"] == "resume_quota_exceeded"


async def test_new_versions_bump_and_expose_source(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        resume_id = (await _import_resume(client))["resume"]["id"]

        version2 = await client.post(
            "/api/resumes/{0}/versions".format(resume_id),
            json={"latex": SAMPLE_LATEX + "% v2", "provider": "mock"},
        )
        assert version2.status_code == 201, version2.text
        assert version2.json()["resume"]["version"] == 2

        versions = await client.get("/api/resumes/{0}/versions".format(resume_id))
        assert versions.status_code == 200
        listed = versions.json()["versions"]
        assert [item["version"] for item in listed] == [2, 1]
        assert all("source_text" not in item for item in listed)

        source = await client.get(
            "/api/resumes/{0}/versions/2/source".format(resume_id)
        )
        assert source.status_code == 200
        body = source.json()
        assert body["version"] == 2
        assert body["source_text"] == SAMPLE_LATEX + "% v2"
        assert "documentclass" in body["template_tex"]

        missing = await client.get(
            "/api/resumes/{0}/versions/9/source".format(resume_id)
        )
        assert missing.status_code == 404


async def test_version_quota_is_enforced(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MAX_VERSIONS_PER_RESUME", "1")
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        resume_id = (await _import_resume(client))["resume"]["id"]

        blocked = await client.post(
            "/api/resumes/{0}/versions".format(resume_id),
            json={"latex": SAMPLE_LATEX, "provider": "mock"},
        )
        assert blocked.status_code == 409
        assert blocked.json()["detail"]["code"] == "version_quota_exceeded"


async def test_pdf_import_uses_extractor_and_text_extraction_prompt(
    make_app, make_client, register_user
) -> None:
    seen: list = []

    def extractor(pdf_bytes: bytes) -> str:
        seen.append(pdf_bytes)
        return PDF_TEXT

    app = make_app(pdf_extractor=extractor)
    async with make_client(app) as client:
        await register_user(client)
        response = await client.post(
            "/api/resumes/pdf",
            files={"file": ("resume.pdf", PDF_BYTES, "application/pdf")},
            data={"provider": "mock", "name": "From PDF"},
        )

        assert response.status_code == 201, response.text
        detail = response.json()["resume"]
        assert detail["source_type"] == "pdf"
        assert detail["name"] == "From PDF"
        assert seen == [PDF_BYTES]

        source = await client.get(
            "/api/resumes/{0}/versions/1/source".format(detail["id"])
        )
        assert source.json()["source_text"] == PDF_TEXT
        assert source.json()["source_type"] == "pdf"


async def test_pdf_version_import_bumps_existing_resume(
    make_app, make_client, register_user
) -> None:
    app = make_app(pdf_extractor=lambda pdf_bytes: PDF_TEXT)
    async with make_client(app) as client:
        await register_user(client)
        resume_id = (await _import_resume(client))["resume"]["id"]

        response = await client.post(
            "/api/resumes/{0}/versions/pdf".format(resume_id),
            files={"file": ("resume.pdf", PDF_BYTES, "application/pdf")},
            data={"provider": "mock"},
        )
        assert response.status_code == 201, response.text
        assert response.json()["resume"]["version"] == 2
        assert response.json()["resume"]["source_type"] == "pdf"


async def test_pdf_upload_rejects_non_pdf_magic_bytes(
    make_app, make_client, register_user
) -> None:
    app = make_app(pdf_extractor=lambda pdf_bytes: PDF_TEXT)
    async with make_client(app) as client:
        await register_user(client)
        response = await client.post(
            "/api/resumes/pdf",
            files={"file": ("resume.pdf", b"MZ not a pdf at all", "application/pdf")},
            data={"provider": "mock"},
        )

        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_pdf"


async def test_pdf_upload_rejects_oversized_file(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MAX_PDF_UPLOAD_BYTES", "1000000")
    app = make_app(pdf_extractor=lambda pdf_bytes: PDF_TEXT)
    async with make_client(app) as client:
        await register_user(client)
        oversized = b"%PDF-" + b"x" * 1_000_001
        response = await client.post(
            "/api/resumes/pdf",
            files={"file": ("resume.pdf", oversized, "application/pdf")},
            data={"provider": "mock"},
        )

        assert response.status_code == 413
        assert response.json()["detail"]["code"] == "pdf_too_large"


@pytest.mark.parametrize(
    "code,status,expected_code",
    [
        ("pdf_no_text", 422, "pdf_no_text"),
        ("pdftotext_missing", 503, "pdf_support_unavailable"),
        ("pdf_extract_timeout", 504, "pdf_extract_timeout"),
        ("pdf_extract_failed", 422, "pdf_extract_failed"),
    ],
)
async def test_pdf_extraction_errors_map_to_structured_responses(
    make_app, make_client, register_user, code: str, status: int, expected_code: str
) -> None:
    app = make_app(pdf_extractor=_raising_extractor(code))
    async with make_client(app) as client:
        await register_user(client)
        response = await client.post(
            "/api/resumes/pdf",
            files={"file": ("resume.pdf", PDF_BYTES, "application/pdf")},
            data={"provider": "mock"},
        )

        assert response.status_code == status
        assert response.json()["detail"]["code"] == expected_code


async def test_import_extraction_failure_returns_422(
    make_app, make_client, register_user
) -> None:
    app = make_app(llm=FailingExtractionLLM())
    async with make_client(app) as client:
        await register_user(client)
        response = await client.post(
            "/api/resumes", json={"latex": SAMPLE_LATEX, "provider": "mock"}
        )

        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_extraction"


async def test_import_requires_provider_and_key(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)

        no_provider = await client.post("/api/resumes", json={"latex": SAMPLE_LATEX})
        assert no_provider.status_code == 400
        assert no_provider.json()["detail"]["code"] == "provider_required"

        no_key = await client.post(
            "/api/resumes", json={"latex": SAMPLE_LATEX, "provider": "openai"}
        )
        assert no_key.status_code == 400
        assert no_key.json()["detail"]["code"] == "llm_key_required"
        assert "openai" in no_key.json()["detail"]["message"]
