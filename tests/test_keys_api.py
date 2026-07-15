"""Provider catalog and encrypted per-user API key tests (round-trip included)."""

from __future__ import annotations

import pytest

from app.schemas import TailorProposal
from tests.conftest import SAMPLE_LATEX, RecordingStubLLM


def _mock_resume_proposal() -> TailorProposal:
    """A proposal valid against the deterministic mock-extraction resume."""

    return TailorProposal(
        summary="Engineer imported in deterministic mock mode",
        bullet_rewrites=[],
        skills_order=["Python", "SQL"],
    )


async def test_providers_catalog_is_public_and_curated(make_app, make_client) -> None:
    app = make_app(multi_user=False)
    async with make_client(app) as client:
        response = await client.get("/api/providers")

        assert response.status_code == 200
        providers = {item["id"]: item for item in response.json()["providers"]}
        assert "custom" not in providers
        assert providers["mock"]["needs_key"] is False
        assert providers["anthropic"]["needs_key"] is True
        assert providers["anthropic"]["default_model"] == "claude-sonnet-5"
        assert {"openai", "groq", "gemini", "openrouter", "mistral", "cerebras"}.issubset(
            providers
        )


async def test_keys_require_authentication(make_app, make_client) -> None:
    app = make_app()
    async with make_client(app) as client:
        assert (await client.get("/api/keys")).status_code == 401
        put = await client.put("/api/keys/groq", json={"api_key": "sk-test-12345678"})
        assert put.status_code == 401


async def test_put_key_stores_masked_hint_and_never_echoes_key(
    make_app, make_client, register_user, database
) -> None:
    app = make_app()
    async with make_client(app) as client:
        user = await register_user(client)
        secret = "sk-live-round-trip-9876"

        put = await client.put("/api/keys/groq", json={"api_key": secret})
        assert put.status_code == 200
        assert put.json() == {"provider": "groq", "hint": "…9876"}

        listing = await client.get("/api/keys")
        assert listing.status_code == 200
        keys = listing.json()["keys"]
        assert len(keys) == 1
        assert keys[0]["provider"] == "groq"
        assert keys[0]["hint"] == "…9876"
        assert secret not in listing.text

        # Encrypted at rest: the stored ciphertext never contains the key.
        record = await database.api_keys.get(user["id"], "groq")
        assert record is not None
        assert secret not in record["ciphertext"]

        me = await client.get("/api/me")
        assert me.json()["user"]["providers_with_keys"] == ["groq"]


@pytest.mark.parametrize("provider", ["mock", "custom", "made-up"])
async def test_put_key_rejects_unknown_or_keyless_providers(
    make_app, make_client, register_user, provider: str
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        response = await client.put(
            "/api/keys/{0}".format(provider), json={"api_key": "sk-test-12345678"}
        )

        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "unknown_provider"


@pytest.mark.parametrize(
    "api_key",
    [
        "  1234  ",  # too short once whitespace is stripped
        "abc\x01defgh",  # control character
    ],
)
async def test_put_key_rejects_malformed_keys(
    make_app, make_client, register_user, api_key: str
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        response = await client.put("/api/keys/groq", json={"api_key": api_key})

        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_api_key"


async def test_delete_key_and_missing_key_404(make_app, make_client, register_user) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        await client.put("/api/keys/openai", json={"api_key": "sk-test-12345678"})

        deleted = await client.delete("/api/keys/openai")
        assert deleted.status_code == 200
        assert deleted.json() == {"ok": True}

        missing = await client.delete("/api/keys/openai")
        assert missing.status_code == 404
        assert missing.json()["detail"]["code"] == "key_not_found"


async def test_stored_key_round_trip_reaches_llm_decrypted(
    make_app, make_client, register_user, valid_job_description
) -> None:
    """PUT key -> tailor with that provider -> the LLM saw the decrypted key."""

    stub = RecordingStubLLM(proposal=_mock_resume_proposal())
    app = make_app(llm=stub)
    secret = "sk-live-decrypt-me-4242"
    async with make_client(app) as client:
        await register_user(client)
        put = await client.put("/api/keys/groq", json={"api_key": secret})
        assert put.status_code == 200

        imported = await client.post(
            "/api/resumes", json={"latex": SAMPLE_LATEX, "provider": "mock"}
        )
        assert imported.status_code == 201, imported.text
        resume_id = imported.json()["resume"]["id"]

        tailored = await client.post(
            "/api/tailor",
            json={
                "job_description": valid_job_description,
                "resume_id": resume_id,
                "provider": "groq",
                "compile": False,
            },
        )
        assert tailored.status_code == 200, tailored.text

    assert len(stub.generate_calls) == 1
    assert stub.generate_calls[0]["provider"] == "groq"
    assert stub.generate_calls[0]["api_key"] == secret


async def test_keys_routes_return_503_in_demo_mode(make_app, make_client) -> None:
    app = make_app(multi_user=False)
    async with make_client(app) as client:
        response = await client.get("/api/keys")

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "database_not_configured"
