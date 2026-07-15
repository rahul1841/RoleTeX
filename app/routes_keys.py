"""Provider catalog and per-user encrypted API key management routes.

Security rationale:
- Keys are validated (known provider, printable, bounded length), encrypted
  with Fernet under the server secret, and stored per (user, provider). The
  plaintext is never persisted, logged, or echoed back — responses only carry
  a masked hint (ellipsis + last four characters).
- ``mock`` needs no key and ``custom`` is operator-only (its base URL comes
  from server env), so neither accepts stored keys.
"""

from __future__ import annotations

from typing import Any, List

from fastapi import FastAPI, Request

from . import security
from .auth import _api_error, require_user
from .llm import PROVIDERS
from .schemas import (
    KeyInfo,
    KeysResponse,
    OkResponse,
    ProviderInfo,
    ProvidersResponse,
    PutKeyRequest,
    PutKeyResponse,
)


PROVIDER_LABELS = {
    "mock": "Mock (offline demo)",
    "anthropic": "Anthropic",
    "cerebras": "Cerebras",
    "gemini": "Google Gemini",
    "groq": "Groq",
    "mistral": "Mistral",
    "openai": "OpenAI",
    "openrouter": "OpenRouter",
}

# Providers a user may store a key for: every real provider except the
# operator-configured "custom" passthrough.
KEYABLE_PROVIDERS = tuple(sorted(name for name in PROVIDERS if name != "custom"))


def _provider_catalog() -> List[ProviderInfo]:
    catalog = [
        ProviderInfo(
            id="mock",
            label=PROVIDER_LABELS["mock"],
            default_model="deterministic-local",
            needs_key=False,
        )
    ]
    for name in KEYABLE_PROVIDERS:
        definition = PROVIDERS[name]
        catalog.append(
            ProviderInfo(
                id=name,
                label=PROVIDER_LABELS.get(name, name.capitalize()),
                default_model=definition.default_model,
                needs_key=True,
            )
        )
    return catalog


def register_keys_routes(app: FastAPI, services: Any) -> None:
    @app.get("/api/providers", response_model=ProvidersResponse)
    async def list_providers() -> ProvidersResponse:
        return ProvidersResponse(providers=_provider_catalog())

    @app.get("/api/keys", response_model=KeysResponse)
    async def list_keys(request: Request) -> KeysResponse:
        user = await require_user(request, services)
        records = await services.database.api_keys.list_for_user(user["_id"])
        return KeysResponse(
            keys=[
                KeyInfo(
                    provider=record.get("provider", ""),
                    hint=record.get("hint", "…"),
                    updated_at=record.get("updated_at"),
                )
                for record in records
            ]
        )

    @app.put("/api/keys/{provider}", response_model=PutKeyResponse)
    async def put_key(
        provider: str, payload: PutKeyRequest, request: Request
    ) -> PutKeyResponse:
        user = await require_user(request, services)
        provider_name = provider.strip().lower()
        if provider_name not in KEYABLE_PROVIDERS:
            raise _api_error(
                422,
                "unknown_provider",
                "API keys can only be stored for: {0}".format(
                    ", ".join(KEYABLE_PROVIDERS)
                ),
            )
        api_key = payload.api_key.strip()
        if len(api_key) < 8:
            raise _api_error(
                422, "invalid_api_key", "The API key looks too short to be valid."
            )
        if any(ord(character) < 32 or ord(character) == 127 for character in api_key):
            raise _api_error(
                422, "invalid_api_key", "The API key contains control characters."
            )
        ciphertext = security.encrypt_secret(api_key, services.config.secret_key)
        hint = security.key_hint(api_key)
        await services.database.api_keys.upsert(
            user["_id"], provider_name, ciphertext, hint
        )
        return PutKeyResponse(provider=provider_name, hint=hint)

    @app.delete("/api/keys/{provider}", response_model=OkResponse)
    async def delete_key(provider: str, request: Request) -> OkResponse:
        user = await require_user(request, services)
        deleted = await services.database.api_keys.delete(
            user["_id"], provider.strip().lower()
        )
        if not deleted:
            raise _api_error(
                404, "key_not_found", "No stored key for this provider."
            )
        return OkResponse()
