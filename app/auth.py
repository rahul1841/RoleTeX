"""Account/session routes plus the shared auth and error plumbing.

Security rationale:
- Sessions are opaque 256-bit tokens delivered via an HttpOnly SameSite=Lax
  cookie (or an ``Authorization: Bearer`` header for non-browser clients);
  only SHA-256 hashes are ever stored or compared server-side.
- The login route applies a per-(email, client IP) failure throttle and
  returns the same ``invalid_credentials`` error for unknown emails and wrong
  passwords, so accounts cannot be enumerated.
- Every DB-backed route funnels through :func:`require_user`, which returns a
  structured 503 in demo mode (no database) and 401 without a valid session —
  handlers never see an unauthenticated request.
- :func:`resolve_llm_selection` is the single place where a user's stored
  provider key is decrypted; the plaintext key only ever lives in the request
  scope and is never logged, echoed, or persisted.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Request, Response

from . import security
from .db import DuplicateEmailError
from .llm import PROVIDERS, supported_providers
from .schemas import (
    DeleteMeRequest,
    LoginRequest,
    OkResponse,
    RegisterRequest,
    UpdateMeRequest,
    UserOut,
    UserResponse,
)


logger = logging.getLogger(__name__)


def _api_error(
    status_code: int,
    code: str,
    message: str,
    headers: Optional[Dict[str, str]] = None,
    **details: Any,
) -> HTTPException:
    """Canonical structured API error: ``{code, message, ...details}``."""

    payload: Dict[str, Any] = {"code": code, "message": message}
    payload.update(details)
    return HTTPException(status_code=status_code, detail=payload, headers=headers)


def _client_ip(request: Request) -> str:
    client = getattr(request, "client", None)
    return getattr(client, "host", "") or ""


def extract_session_token(request: Request) -> Optional[str]:
    """Session token from the cookie, or an ``Authorization: Bearer`` header."""

    token = request.cookies.get(security.SESSION_COOKIE_NAME)
    if token:
        return token
    authorization = (request.headers.get("authorization") or "").strip()
    if authorization.lower().startswith("bearer "):
        candidate = authorization[7:].strip()
        if candidate:
            return candidate
    return None


async def resolve_session(
    request: Request, services: Any
) -> Optional[Tuple[Dict[str, Any], Dict[str, Any], str]]:
    """Resolve ``(user, session, token_hash)`` for a request, with caching.

    Returns None when there is no database, no token, or no live session.
    The result is cached on ``request.state`` so the rate-limit middleware and
    the route dependency share one lookup per request.
    """

    cached = getattr(request.state, "auth_context", None)
    if cached is not None:
        return cached or None
    if getattr(request.state, "auth_context_resolved", False):
        return None

    request.state.auth_context_resolved = True
    request.state.auth_context = None
    database = getattr(services, "database", None)
    if database is None:
        return None
    token = extract_session_token(request)
    if not token:
        return None
    token_hash = security.hash_token(token)
    session = await database.sessions.get(token_hash)
    if session is None:
        return None
    user = await database.users.get(session.get("user_id", ""))
    if user is None:
        return None
    context = (user, session, token_hash)
    request.state.auth_context = context
    return context


async def require_user(request: Request, services: Any) -> Dict[str, Any]:
    """Session dependency for DB-backed routes (503 in demo mode, 401 unauthenticated)."""

    if getattr(services, "database", None) is None:
        raise _api_error(
            503,
            "database_not_configured",
            "This deployment is running in demo mode without a database.",
        )
    context = await resolve_session(request, services)
    if context is None:
        raise _api_error(401, "not_authenticated", "Sign in to use this feature.")
    user, session, token_hash = context

    # Sliding renewal: refresh the server-side expiry once <75% TTL remains.
    ttl_seconds = services.config.session_ttl_seconds
    expires_at = session.get("expires_at")
    if isinstance(expires_at, datetime) and security.session_needs_renewal(
        expires_at, ttl_seconds
    ):
        try:
            await services.database.sessions.touch(
                token_hash, _session_expiry(ttl_seconds)
            )
        except Exception:  # renewal is best-effort; the session is still valid
            logger.warning("Session renewal failed; continuing with current expiry")
    return user


def _session_expiry(ttl_seconds: int) -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)


def set_session_cookie(
    response: Response, request: Request, token: str, config: Any
) -> None:
    response.set_cookie(
        key=security.SESSION_COOKIE_NAME,
        value=token,
        max_age=config.session_ttl_seconds,
        path="/",
        httponly=True,
        samesite="lax",
        secure=security.should_secure_cookie(request, config.cookie_secure),
    )


def clear_session_cookie(response: Response, request: Request, config: Any) -> None:
    response.delete_cookie(
        key=security.SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=security.should_secure_cookie(request, config.cookie_secure),
    )


async def build_user_out(services: Any, user: Dict[str, Any]) -> UserOut:
    keys = await services.database.api_keys.list_for_user(user["_id"])
    providers_with_keys = sorted({doc.get("provider", "") for doc in keys if doc.get("provider")})
    return UserOut(
        id=user["_id"],
        email=user.get("email", ""),
        name=user.get("name") or "",
        default_provider=user.get("default_provider") or None,
        default_model=user.get("default_model") or None,
        created_at=user.get("created_at"),
        providers_with_keys=providers_with_keys,
    )


# ---------------------------------------------------------------------------
# Provider/key resolution for user-initiated LLM requests (spec §6.4)
# ---------------------------------------------------------------------------


async def resolve_llm_selection(
    services: Any,
    user: Dict[str, Any],
    requested_provider: Optional[str],
    requested_model: Optional[str],
) -> Tuple[str, Optional[str], Optional[str], List[str]]:
    """Resolve ``(provider, model, api_key_override, warnings)`` for a user.

    The user's stored key is decrypted here and returned only to be passed as
    a per-call override; env provider keys are used solely when the operator
    explicitly enabled ``ALLOW_ENV_KEY_FALLBACK``.
    """

    warnings: List[str] = []
    user_default_provider = (user.get("default_provider") or "").strip().lower()
    provider = (requested_provider or user_default_provider or "").strip().lower()
    if not provider:
        if os.getenv("LLM_PROVIDER", "").strip().lower() == "mock":
            provider = "mock"
        else:
            raise _api_error(
                400,
                "provider_required",
                "Choose an AI provider (or set a default in Settings) for this request.",
            )
    if provider == "mock":
        warnings.append(
            "Offline mock output: no AI provider was called for this request."
        )
        return "mock", requested_model, None, warnings

    if provider not in PROVIDERS:
        raise _api_error(
            422,
            "unknown_provider",
            "Unsupported provider '{0}'. Supported: {1}".format(
                provider, ", ".join(supported_providers())
            ),
        )

    api_key: Optional[str] = None
    record = await services.database.api_keys.get(user["_id"], provider)
    if record is not None:
        try:
            api_key = security.decrypt_secret(
                record.get("ciphertext", ""), services.config.secret_key
            )
        except security.SecretCipherError as exc:
            raise _api_error(
                500,
                "key_decrypt_failed",
                "Your stored {0} key could not be decrypted (the server secret "
                "key may have changed). Save the key again in Settings.".format(provider),
            ) from exc
    else:
        definition = PROVIDERS[provider]
        env_key = os.getenv(definition.key_env, "") or os.getenv("LLM_API_KEY", "")
        if not (services.config.allow_env_key_fallback and env_key.strip()):
            raise _api_error(
                400,
                "llm_key_required",
                "Add your {0} API key in Settings.".format(provider),
            )

    model = (requested_model or "").strip() or None
    if model is None and provider == user_default_provider:
        model = (user.get("default_model") or "").strip() or None
    if model is None:
        # Complete the spec §6.4 chain with the *selected provider's* default
        # so the operator's env LLM_MODEL (which belongs to the env-configured
        # provider) can never bleed into a per-user request for another one.
        model = (PROVIDERS[provider].default_model or "").strip() or None
    return provider, model, api_key, warnings


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


def register_auth_routes(app: FastAPI, services: Any) -> None:
    """Attach register/login/logout/me routes to the application."""

    def _database_or_503() -> Any:
        if services.database is None:
            raise _api_error(
                503,
                "database_not_configured",
                "This deployment is running in demo mode without a database.",
            )
        return services.database

    async def _open_session(
        request: Request, response: Response, user_id: str
    ) -> None:
        token = security.new_session_token()
        await services.database.sessions.create(
            user_id,
            security.hash_token(token),
            _session_expiry(services.config.session_ttl_seconds),
        )
        set_session_cookie(response, request, token, services.config)

    @app.post(
        "/api/auth/register", response_model=UserResponse, status_code=201
    )
    async def register(
        payload: RegisterRequest, request: Request, response: Response
    ) -> UserResponse:
        database = _database_or_503()
        if not services.config.allow_registration:
            raise _api_error(
                403, "registration_disabled", "Registration is disabled on this server."
            )
        email = security.normalize_email(payload.email)
        if email is None:
            raise _api_error(422, "invalid_email", "Enter a valid email address.")
        policy_error = security.password_policy_error(payload.password)
        if policy_error is not None:
            raise _api_error(400, "weak_password", policy_error)
        # PBKDF2 is CPU-bound (~0.3s at 600k iterations) and releases the GIL,
        # so hash in a worker thread to keep the event loop responsive.
        loop = asyncio.get_running_loop()
        password_hash = await loop.run_in_executor(
            None, security.hash_password, payload.password
        )
        try:
            user = await database.users.create(
                email, password_hash, payload.name.strip()
            )
        except DuplicateEmailError as exc:
            raise _api_error(
                409, "email_taken", "An account with this email already exists."
            ) from exc
        await _open_session(request, response, user["_id"])
        return UserResponse(user=await build_user_out(services, user))

    @app.post("/api/auth/login", response_model=UserResponse)
    async def login(
        payload: LoginRequest, request: Request, response: Response
    ) -> UserResponse:
        database = _database_or_503()
        client_ip = _client_ip(request)
        email = security.normalize_email(payload.email) or payload.email.strip().lower()

        retry_after = services.login_throttle.check(email, client_ip)
        if retry_after is not None:
            raise _api_error(
                429,
                "too_many_attempts",
                "Too many failed sign-in attempts. Try again later.",
                headers={"Retry-After": str(max(1, int(retry_after + 0.999)))},
            )

        user = await database.users.get_by_email(email)
        # Always do the full PBKDF2 verification — against a dummy hash when
        # the account does not exist — so response timing cannot be used to
        # enumerate registered emails. Run it in a worker thread so the
        # event loop is not blocked for the hash duration.
        loop = asyncio.get_running_loop()
        if user is not None:
            stored_hash = user.get("password_hash", "")
        else:
            stored_hash = await loop.run_in_executor(
                None, security.dummy_password_hash
            )
        verified = await loop.run_in_executor(
            None, security.verify_password, payload.password, stored_hash
        )
        password_ok = user is not None and verified
        if not password_ok:
            services.login_throttle.record_failure(email, client_ip)
            raise _api_error(
                401, "invalid_credentials", "Incorrect email or password."
            )

        services.login_throttle.clear(email, client_ip)
        await _open_session(request, response, user["_id"])
        return UserResponse(user=await build_user_out(services, user))

    @app.post("/api/auth/logout", response_model=OkResponse)
    async def logout(request: Request, response: Response) -> OkResponse:
        database = _database_or_503()
        token = extract_session_token(request)
        if token:
            await database.sessions.delete(security.hash_token(token))
        clear_session_cookie(response, request, services.config)
        return OkResponse()

    @app.get("/api/me", response_model=UserResponse)
    async def me(request: Request) -> UserResponse:
        user = await require_user(request, services)
        return UserResponse(user=await build_user_out(services, user))

    @app.patch("/api/me", response_model=UserResponse)
    async def update_me(payload: UpdateMeRequest, request: Request) -> UserResponse:
        user = await require_user(request, services)
        # ``model_fields_set`` distinguishes an explicit null (clear the field)
        # from an omitted field (leave unchanged) on Pydantic v2 models.
        fields_set = getattr(payload, "model_fields_set", None)
        if fields_set is None:
            fields_set = getattr(payload, "__fields_set__", set())
        updates: Dict[str, Any] = {}
        if payload.name is not None:
            updates["name"] = payload.name.strip()
        if "default_provider" in fields_set:
            provider = (payload.default_provider or "").strip().lower()
            if provider == "":
                updates["default_provider"] = None
            elif provider not in supported_providers():
                raise _api_error(
                    422,
                    "unknown_provider",
                    "Unsupported provider '{0}'.".format(provider),
                )
            else:
                updates["default_provider"] = provider
        if "default_model" in fields_set:
            updates["default_model"] = (payload.default_model or "").strip() or None
        if updates:
            await services.database.users.update(user["_id"], updates)
            user = await services.database.users.get(user["_id"]) or user
        return UserResponse(user=await build_user_out(services, user))

    @app.delete("/api/me", response_model=OkResponse)
    async def delete_me(
        payload: DeleteMeRequest, request: Request, response: Response
    ) -> OkResponse:
        user = await require_user(request, services)
        loop = asyncio.get_running_loop()
        password_ok = await loop.run_in_executor(
            None, security.verify_password, payload.password, user.get("password_hash", "")
        )
        if not password_ok:
            raise _api_error(
                403, "invalid_credentials", "The password did not match this account."
            )
        database = services.database
        user_id = user["_id"]
        await database.sessions.delete_for_user(user_id)
        await database.api_keys.delete_for_user(user_id)
        await database.resumes.delete_for_user(user_id)
        await database.jds.delete_for_user(user_id)
        await database.runs.delete_for_user(user_id)
        await database.users.delete(user_id)
        clear_session_cookie(response, request, services.config)
        return OkResponse()
