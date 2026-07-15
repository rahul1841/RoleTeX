"""Multi-user tailor flow and tailor-history (runs) API tests."""

from __future__ import annotations

import base64
from typing import Any, List, Optional

import pytest

from app.compiler import CompileResult
from app.schemas import TailorProposal
from tests.conftest import SAMPLE_LATEX, RecordingStubLLM


JD_CONTENT = (
    "We are hiring a backend engineer to build reliable Python and FastAPI "
    "services, improve PostgreSQL performance, and maintain Docker delivery workflows."
)


class StubCompiler:
    def __init__(self, results: Optional[List[CompileResult]] = None, available: bool = True):
        self.results = list(results or [])
        self.available = available
        self.only_cached = True
        self.calls: List[Any] = []

    def is_available(self) -> bool:
        return self.available

    async def compile(self, latex_source: str, assets_dir=None) -> CompileResult:
        self.calls.append(latex_source)
        if not self.results:
            raise AssertionError("unexpected compiler call")
        return self.results.pop(0)


def _mock_resume_proposal() -> TailorProposal:
    return TailorProposal(
        summary="Engineer imported in deterministic mock mode",
        bullet_rewrites=[],
        skills_order=["Python", "SQL"],
    )


async def _setup_user_with_resume(client, register_user) -> str:
    await register_user(client)
    imported = await client.post(
        "/api/resumes", json={"latex": SAMPLE_LATEX, "provider": "mock"}
    )
    assert imported.status_code == 201, imported.text
    return imported.json()["resume"]["id"]


async def _tailor(client, resume_id: str, **overrides) -> Any:
    payload = {
        "job_description": JD_CONTENT,
        "resume_id": resume_id,
        "provider": "mock",
        "compile": False,
    }
    payload.update(overrides)
    return await client.post("/api/tailor", json=payload)


async def test_multi_user_tailor_persists_run_with_saved_jd(
    make_app, make_client, register_user
) -> None:
    stub = RecordingStubLLM(proposal=_mock_resume_proposal())
    app = make_app(llm=stub)
    async with make_client(app) as client:
        resume_id = await _setup_user_with_resume(client, register_user)
        jd = await client.post(
            "/api/jds", json={"title": "Backend role", "content": JD_CONTENT}
        )
        jd_id = jd.json()["jd"]["id"]

        response = await _tailor(
            client, resume_id, job_description=None, jd_id=jd_id
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["run_id"]
        assert "@@" not in body["latex_source"]
        assert "imported.user@example.com" in body["latex_source"]
        # The stored JD's content reached the LLM.
        assert stub.generate_calls[0]["job_description"] == JD_CONTENT
        # Offline mock warning surfaced from the provider resolution step.
        assert any("mock" in warning.lower() for warning in body["warnings"])

        listing = await client.get("/api/runs")
        assert listing.status_code == 200
        runs = listing.json()["runs"]
        assert len(runs) == 1
        summary = runs[0]
        assert summary["id"] == body["run_id"]
        assert summary["jd_id"] == jd_id
        assert summary["jd_title"] == "Backend role"
        assert summary["resume_id"] == resume_id
        assert summary["resume_version"] == 1
        assert summary["repaired"] is False
        assert "latex_source" not in summary
        assert "unified_diff" not in summary

        detail = await client.get("/api/runs/{0}".format(body["run_id"]))
        assert detail.status_code == 200
        run = detail.json()["run"]
        assert run["latex_source"] == body["latex_source"]
        assert run["proposal"]["skills_order"] == ["Python", "SQL"]
        assert run["jd_excerpt"] == JD_CONTENT[:300]


async def test_tailor_with_pasted_jd_and_save_run_disabled(
    make_app, make_client, register_user
) -> None:
    stub = RecordingStubLLM(proposal=_mock_resume_proposal())
    app = make_app(llm=stub)
    async with make_client(app) as client:
        resume_id = await _setup_user_with_resume(client, register_user)

        response = await _tailor(client, resume_id, save_run=False)
        assert response.status_code == 200, response.text
        assert response.json()["run_id"] is None
        assert (await client.get("/api/runs")).json()["runs"] == []


async def test_tailor_requires_exactly_one_jd_source(
    make_app, make_client, register_user
) -> None:
    app = make_app(llm=RecordingStubLLM(proposal=_mock_resume_proposal()))
    async with make_client(app) as client:
        resume_id = await _setup_user_with_resume(client, register_user)

        neither = await _tailor(client, resume_id, job_description=None)
        assert neither.status_code == 422
        assert neither.json()["detail"]["code"] == "jd_required"

        both = await _tailor(client, resume_id, jd_id="a" * 32)
        assert both.status_code == 422
        assert both.json()["detail"]["code"] == "jd_required"


async def test_tailor_multi_user_error_paths(
    make_app, make_client, register_user, database
) -> None:
    app = make_app(llm=RecordingStubLLM(proposal=_mock_resume_proposal()))
    async with make_client(app) as anonymous:
        unauth = await anonymous.post(
            "/api/tailor", json={"job_description": JD_CONTENT}
        )
        assert unauth.status_code == 401
        assert unauth.json()["detail"]["code"] == "not_authenticated"

    async with make_client(app) as client:
        user = await register_user(client)

        no_resume = await client.post(
            "/api/tailor", json={"job_description": JD_CONTENT, "provider": "mock"}
        )
        assert no_resume.status_code == 400
        assert no_resume.json()["detail"]["code"] == "resume_required"

        unknown_resume = await _tailor(client, "f" * 32)
        assert unknown_resume.status_code == 404
        assert unknown_resume.json()["detail"]["code"] == "resume_not_found"

        imported = await client.post(
            "/api/resumes", json={"latex": SAMPLE_LATEX, "provider": "mock"}
        )
        resume_id = imported.json()["resume"]["id"]

        unknown_jd = await _tailor(
            client, resume_id, job_description=None, jd_id="e" * 32
        )
        assert unknown_jd.status_code == 404
        assert unknown_jd.json()["detail"]["code"] == "jd_not_found"

        no_provider = await _tailor(client, resume_id, provider=None)
        assert no_provider.status_code == 400
        assert no_provider.json()["detail"]["code"] == "provider_required"

        no_key = await _tailor(client, resume_id, provider="groq")
        assert no_key.status_code == 400
        assert no_key.json()["detail"]["code"] == "llm_key_required"

        # A stored key that no longer decrypts (e.g. APP_SECRET_KEY changed).
        await database.api_keys.upsert(user["id"], "groq", "not-a-fernet-token", "…dead")
        broken = await _tailor(client, resume_id, provider="groq")
        assert broken.status_code == 500
        assert broken.json()["detail"]["code"] == "key_decrypt_failed"


async def test_env_key_fallback_when_operator_allows_it(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ALLOW_ENV_KEY_FALLBACK", "true")
    monkeypatch.setenv("GROQ_API_KEY", "env-operator-key")
    stub = RecordingStubLLM(proposal=_mock_resume_proposal())
    app = make_app(llm=stub)
    async with make_client(app) as client:
        resume_id = await _setup_user_with_resume(client, register_user)

        response = await _tailor(client, resume_id, provider="groq")
        assert response.status_code == 200, response.text
        # Env fallback means no per-user override is injected.
        assert stub.generate_calls[-1]["provider"] == "groq"
        assert stub.generate_calls[-1]["api_key"] is None


async def test_user_default_provider_is_used_when_request_omits_it(
    make_app, make_client, register_user
) -> None:
    stub = RecordingStubLLM(proposal=_mock_resume_proposal())
    app = make_app(llm=stub)
    async with make_client(app) as client:
        resume_id = await _setup_user_with_resume(client, register_user)
        await client.put("/api/keys/groq", json={"api_key": "sk-default-12345678"})
        await client.patch(
            "/api/me", json={"default_provider": "groq", "default_model": "llama-y"}
        )

        response = await _tailor(client, resume_id, provider=None)
        assert response.status_code == 200, response.text
        assert stub.generate_calls[-1]["provider"] == "groq"
        assert stub.generate_calls[-1]["model"] == "llama-y"
        assert stub.generate_calls[-1]["api_key"] == "sk-default-12345678"


async def test_provider_default_model_wins_over_env_llm_model(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Operator env LLM_MODEL must not bleed into per-user provider requests."""

    from app.llm import PROVIDERS

    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("LLM_MODEL", "llama-3.3-70b-versatile")
    stub = RecordingStubLLM(proposal=_mock_resume_proposal())
    app = make_app(llm=stub)
    async with make_client(app) as client:
        resume_id = await _setup_user_with_resume(client, register_user)
        await client.put("/api/keys/openai", json={"api_key": "sk-user-12345678"})

        response = await _tailor(client, resume_id, provider="openai")
        assert response.status_code == 200, response.text
        # Spec §6.4 step 4: with no request/user model, the *selected*
        # provider's default applies — never the env model of another provider.
        assert stub.generate_calls[-1]["model"] == PROVIDERS["openai"].default_model
        assert stub.generate_calls[-1]["provider"] == "openai"


async def test_run_recompile_returns_pdf_and_maps_failures(
    make_app, make_client, register_user
) -> None:
    compiler = StubCompiler(
        [
            CompileResult(
                success=True,
                pdf_bytes=b"%PDF-history",
                page_count=1,
                extracted_text="history text",
            ),
            CompileResult(
                success=False, error_code="latex_compile_failed", log="boom"
            ),
        ]
    )
    app = make_app(llm=RecordingStubLLM(proposal=_mock_resume_proposal()), compiler=compiler)
    async with make_client(app) as client:
        resume_id = await _setup_user_with_resume(client, register_user)
        run_id = (await _tailor(client, resume_id)).json()["run_id"]

        compiled = await client.post("/api/runs/{0}/compile".format(run_id))
        assert compiled.status_code == 200, compiled.text
        body = compiled.json()
        assert base64.b64decode(body["pdf_base64"]) == b"%PDF-history"
        assert body["page_count"] == 1
        assert body["compiler"]["success"] is True
        assert "@@" not in compiler.calls[0]

        failed = await client.post("/api/runs/{0}/compile".format(run_id))
        assert failed.status_code == 422
        assert failed.json()["detail"]["code"] == "latex_compile_failed"

        missing = await client.post("/api/runs/{0}/compile".format("d" * 32))
        assert missing.status_code == 404
        assert missing.json()["detail"]["code"] == "run_not_found"


async def test_runs_are_isolated_and_deletable(
    make_app, make_client, register_user
) -> None:
    app = make_app(llm=RecordingStubLLM(proposal=_mock_resume_proposal()))
    async with make_client(app) as owner, make_client(app) as intruder:
        resume_id = await _setup_user_with_resume(owner, register_user)
        await register_user(intruder, email="intruder@example.com")
        run_id = (await _tailor(owner, resume_id)).json()["run_id"]

        for method, path in [
            ("GET", "/api/runs/{0}".format(run_id)),
            ("POST", "/api/runs/{0}/compile".format(run_id)),
            ("DELETE", "/api/runs/{0}".format(run_id)),
        ]:
            response = await intruder.request(method, path)
            assert response.status_code == 404, path
            assert response.json()["detail"]["code"] == "run_not_found"
        assert (await intruder.get("/api/runs")).json()["runs"] == []

        deleted = await owner.delete("/api/runs/{0}".format(run_id))
        assert deleted.status_code == 200
        assert (await owner.get("/api/runs")).json()["runs"] == []


async def test_runs_routes_return_503_in_demo_mode(make_app, make_client) -> None:
    app = make_app(multi_user=False)
    async with make_client(app) as client:
        response = await client.get("/api/runs")
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "database_not_configured"

        # Demo-mode tailoring is seed-only: stored ids need a database.
        with_resume_id = await client.post(
            "/api/tailor",
            json={"job_description": JD_CONTENT, "resume_id": "a" * 32},
        )
        assert with_resume_id.status_code == 503
        assert with_resume_id.json()["detail"]["code"] == "database_not_configured"
