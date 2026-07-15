"""Tests for structured model output and privacy-preserving provider requests."""

from __future__ import annotations

import json
from typing import Any, Dict, List

import httpx
import pytest

from app.llm import (
    EXTRACTION_SYSTEM_PROMPT,
    EXTRACTION_TEXT_SYSTEM_PROMPT,
    LLMConfigurationError,
    LLMResponseError,
    OpenAICompatibleLLM,
    parse_proposal,
    supported_providers,
)
from app.resume import flattened_skills
from app.schemas import ResumeData, TailorProposal, dump_model, validate_model


def _proposal_payload(resume) -> Dict[str, Any]:
    return {
        "summary": resume.summary,
        "bullet_rewrites": [],
        "skills_order": flattened_skills(resume),
    }


@pytest.mark.asyncio
async def test_mock_provider_is_deterministic_and_never_calls_http(
    resume, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: List[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        raise AssertionError("mock mode must not make a network request")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = OpenAICompatibleLLM(http_client=http_client)
        monkeypatch.setenv("LLM_PROVIDER", "mock")
        job = "Redis redis FastAPI backend role"
        first = await client.generate(resume, job)
        second = await client.generate(resume, job)

    assert calls == []
    assert first.raw_content == second.raw_content
    assert first.proposal == second.proposal
    assert first.provider == "mock"
    assert first.model == "deterministic-local"
    assert first.proposal.skills_order[0] == "Redis"
    assert "FastAPI" not in first.proposal.skills_order
    assert first.proposal.summary == resume.summary
    assert first.proposal.bullet_rewrites == []


@pytest.mark.asyncio
async def test_outbound_generate_request_contains_no_identity_pii(
    raw_resume_data: Dict[str, Any], valid_job_description: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    raw_resume_data["identity"] = {
        "name": "PRIVATE-NAME-a813",
        "email": "private-email-a813@example.invalid",
        "phone": "+99-PRIVATE-PHONE-a813",
        "location": "PRIVATE-LOCATION-a813",
        "links": [{"label": "PRIVATE-LABEL-a813", "url": "https://private-a813.invalid"}],
    }
    resume = validate_model(ResumeData, raw_resume_data)
    captured_bodies: List[Dict[str, Any]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        captured_bodies.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps(_proposal_payload(resume))}}
                ]
            },
        )

    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.invalid/v1")
    monkeypatch.setenv("LLM_API_KEY", "server-secret")
    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = OpenAICompatibleLLM(http_client=http_client)
        result = await client.generate(
            resume,
            valid_job_description,
            provider="custom",
            model="test-model",
        )

    assert result.proposal.skills_order == flattened_skills(resume)
    assert len(captured_bodies) == 1
    serialized = json.dumps(captured_bodies[0], sort_keys=True)
    for marker in (
        "PRIVATE-NAME-a813",
        "private-email-a813",
        "PRIVATE-PHONE-a813",
        "PRIVATE-LOCATION-a813",
        "PRIVATE-LABEL-a813",
        "private-a813",
    ):
        assert marker not in serialized
    assert valid_job_description in serialized
    assert "<job_description>" in serialized
    assert "identity deliberately excluded" in serialized.lower()


@pytest.mark.asyncio
async def test_outbound_repair_request_also_omits_identity_pii(
    raw_resume_data: Dict[str, Any], valid_job_description: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    raw_resume_data["identity"]["name"] = "REPAIR-PRIVATE-NAME-f127"
    raw_resume_data["identity"]["email"] = "repair-private-f127@example.invalid"
    raw_resume_data["identity"]["phone"] = "+99-REPAIR-PRIVATE-f127"
    raw_resume_data["identity"]["location"] = "REPAIR-PRIVATE-LOCATION-f127"
    raw_resume_data["identity"]["links"] = []
    resume = validate_model(ResumeData, raw_resume_data)
    captured: List[Dict[str, Any]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps(_proposal_payload(resume))}}
                ]
            },
        )

    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.invalid/v1")
    monkeypatch.setenv("LLM_API_KEY", "server-secret")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        await OpenAICompatibleLLM(http_client=http_client).repair(
            resume,
            valid_job_description,
            issue="unknown bullet ID",
            previous_output='{"summary":"broken"}',
            provider="custom",
            model="test-model",
        )

    serialized = json.dumps(captured[0], sort_keys=True)
    assert "REPAIR-PRIVATE-NAME-f127" not in serialized
    assert "repair-private-f127" not in serialized
    assert "REPAIR-PRIVATE-LOCATION-f127" not in serialized
    assert "unknown bullet ID" in serialized


@pytest.mark.parametrize(
    "wrapper",
    [
        lambda payload: payload,
        lambda payload: "```json\n{0}\n```".format(payload),
        lambda payload: "Here is the object:\n{0}\nEnd.".format(payload),
    ],
)
def test_parse_proposal_accepts_a_single_embedded_json_object(
    resume, wrapper
) -> None:
    payload = json.dumps(_proposal_payload(resume))

    parsed = parse_proposal(wrapper(payload))

    assert dump_model(parsed) == _proposal_payload(resume)


@pytest.mark.parametrize(
    "content",
    [
        "not json",
        "[]",
        '{"summary":"only one field"}',
        '{"summary":"x","bullet_rewrites":[],"skills_order":[],"extra":true}',
    ],
)
def test_parse_proposal_rejects_malformed_or_non_strict_output(content: str) -> None:
    with pytest.raises(LLMResponseError, match="required proposal schema"):
        parse_proposal(content)


def test_provider_configuration_requires_https_and_server_secret(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    client = OpenAICompatibleLLM()
    monkeypatch.setenv("LLM_BASE_URL", "http://llm.example.invalid/v1")
    monkeypatch.setenv("LLM_API_KEY", "secret")
    monkeypatch.delenv("ALLOW_INSECURE_LLM_BASE_URL", raising=False)

    with pytest.raises(LLMConfigurationError, match="must use HTTPS"):
        client.resolve_config("custom", "model")

    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.invalid/v1")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    with pytest.raises(LLMConfigurationError, match="No API key configured"):
        client.resolve_config("custom", "model")


def test_supported_provider_list_includes_offline_and_configured_adapters() -> None:
    providers = supported_providers()

    assert providers[0] == "mock"
    assert {"groq", "gemini", "openrouter", "custom"}.issubset(providers)


def test_gemini_uses_current_flash_model_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-only-key")
    monkeypatch.delenv("LLM_MODEL", raising=False)

    config = OpenAICompatibleLLM().resolve_config("gemini")

    assert config.model == "gemini-3.5-flash"


def test_anthropic_provider_uses_openai_compatible_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only-key")
    monkeypatch.delenv("LLM_MODEL", raising=False)

    config = OpenAICompatibleLLM().resolve_config("anthropic")

    assert "anthropic" in supported_providers()
    assert config.base_url == "https://api.anthropic.com/v1"
    assert config.model == "claude-sonnet-5"
    assert config.api_key == "test-only-key"


def test_api_key_override_skips_env_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    client = OpenAICompatibleLLM()

    with pytest.raises(LLMConfigurationError, match="No API key configured"):
        client.resolve_config("groq")

    config = client.resolve_config("groq", api_key_override="user-supplied-key")
    assert config.api_key == "user-supplied-key"

    # And the override wins even when an env key exists.
    monkeypatch.setenv("GROQ_API_KEY", "operator-env-key")
    config = client.resolve_config("groq", api_key_override="user-supplied-key")
    assert config.api_key == "user-supplied-key"

    # A blank override falls back to the env lookup.
    config = client.resolve_config("groq", api_key_override="   ")
    assert config.api_key == "operator-env-key"


@pytest.mark.asyncio
async def test_generate_sends_the_overriding_key_as_bearer(
    resume, valid_job_description: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.invalid/v1")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    captured_headers = []

    async def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.append(dict(request.headers))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps(_proposal_payload(resume))}}
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        await OpenAICompatibleLLM(http_client=http_client).generate(
            resume,
            valid_job_description,
            provider="custom",
            model="test-model",
            api_key="user-override-key",
        )

    assert captured_headers[0]["authorization"] == "Bearer user-override-key"


@pytest.mark.asyncio
async def test_extract_resume_text_kind_uses_text_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.invalid/v1")
    monkeypatch.setenv("LLM_API_KEY", "server-secret")
    captured_bodies = []
    extraction_payload = {
        "identity": {"name": "Jane", "email": "j@x.com", "phone": "+1", "location": "Berlin"},
        "summary": "Engineer",
        "style": {"paper": "a4paper"},
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        captured_bodies.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(extraction_payload)}}]},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = OpenAICompatibleLLM(http_client=http_client)
        await client.extract_resume(
            "Jane Doe, Berlin. Engineer at Acme.",
            provider="custom",
            model="test-model",
            source_kind="text",
        )
        await client.extract_resume(
            r"\documentclass{article} Jane Doe",
            provider="custom",
            model="test-model",
        )

    text_messages = captured_bodies[0]["messages"]
    assert text_messages[0]["content"] == EXTRACTION_TEXT_SYSTEM_PROMPT
    assert "<resume_text>" in text_messages[1]["content"]

    latex_messages = captured_bodies[1]["messages"]
    assert latex_messages[0]["content"] == EXTRACTION_SYSTEM_PROMPT
    assert "<resume_latex>" in latex_messages[1]["content"]


@pytest.mark.asyncio
async def test_extract_resume_mock_supports_text_kind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "mock")

    result = await OpenAICompatibleLLM().extract_resume(
        "Plain text resume body", source_kind="text"
    )

    assert result.provider == "mock"
    assert result.resume["identity"]["email"] == "imported.user@example.com"
    assert result.style["paper"] == "a4paper"
