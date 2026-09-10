"""Account-lifecycle routes: password change/reset, email verification, sessions.

Security rationale:
- **No account oracle.** ``POST /api/auth/password/forgot`` returns the same
  body whether or not the address has an account, and never reports delivery
  status for a specific address — only whether this *server* has a real mail
  transport configured. The same applies to a disabled account.
- **Tokens are single-use, expiring, and stored hashed.** Only the SHA-256 hash
  reaches Mongo (as for sessions), redemption is an atomic conditional update in
  :class:`app.db.AuthTokenStore`, and every outstanding token for a user is
  destroyed the moment their password changes.
- **A password change ejects every other session.** Changing a password is the
  action a user takes when they believe a credential leaked, so it must
  invalidate the sessions an attacker might hold. A reset (where the user did
  not prove possession of the old password) revokes *all* sessions including the
  requester's, forcing a fresh sign-in.
- **Reset links cannot be poisoned via the Host header.** The link origin comes
  from ``PUBLIC_BASE_URL``. Deriving it from the request is permitted only while
  the console mailer is active, because that driver writes to the operator's own
  log rather than to a recipient's inbox — see :func:`_link_base`.
- **Mail endpoints have their own tight budget.** The general limiter (120/min)
  is far too loose to sit in front of an SMTP send, so these routes additionally
  consume a dedicated per-IP *and* per-address bucket, which bounds both
  spraying many addresses from one host and bombing one address from many.

Known residual: ``forgot`` does measurably more work for an address that has an
account, so a determined attacker can still infer membership from response
latency. Closing that fully requires deferring the send to a queue, which this
single-container deployment does not have; the rate limit above bounds how
cheaply the oracle can be sampled.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Tuple

from fastapi import FastAPI, Request, Response

from . import security
from .auth import (
    _api_error,
    _client_ip,
    build_user_out,
    clear_session_cookie,
    require_user,
    resolve_session,
)
from .db import AuthTokenStore
from .mailer import MailDeliveryError
from .schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    MailDispatchResponse,
    OkResponse,
    ResetPasswordRequest,
    RevokedResponse,
    SessionInfo,
    SessionListResponse,
    UserResponse,
    VerifyEmailRequest,
)


logger = logging.getLogger(__name__)


#: Real routes in the frontend's static export. ``trailingSlash: true`` in
#: frontend/next.config.ts emits ``reset-password/index.html``, so the trailing
#: slash is what FastAPI's ``StaticFiles(html=True)`` mount can actually serve.
RESET_PATH = "/reset-password/"
VERIFY_PATH = "/verify-email/"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _link_base(request: Request, services: Any) -> str:
    """Origin for a one-time link, or a 503 when it cannot be established safely.

    ``PUBLIC_BASE_URL`` is authoritative. Falling back to the request's own host
    is the classic password-reset poisoning vector — an attacker submits a
    ``forgot`` for someone else's address with a forged ``Host``, and the victim
    receives a real token pointing at the attacker's domain. That fallback is
    therefore allowed only while the mailer does not actually deliver (the
    console driver), where the link goes to the operator's log instead of a
    recipient's inbox.
    """

    configured = (services.config.public_base_url or "").strip()
    if configured:
        return configured.rstrip("/")
    if not services.mailer.delivers:
        return str(request.base_url).rstrip("/")
    raise _api_error(
        503,
        "mail_not_configured",
        "This server cannot send account emails until PUBLIC_BASE_URL is set.",
    )


def _check_email_budget(services: Any, client_ip: str, email: str) -> None:
    """Consume the per-IP and per-address mail budgets, or raise 429."""

    for bucket in ("mail:ip:" + (client_ip or "anonymous"), "mail:addr:" + email):
        retry_after = services.rate_limiter_email.check(bucket)
        if retry_after is not None:
            raise _api_error(
                429,
                "too_many_requests",
                "Too many email requests. Try again later.",
                headers={"Retry-After": str(max(1, int(retry_after + 0.999)))},
            )


async def _hash_password(password: str) -> str:
    """PBKDF2 off the event loop (~0.3s at 600k iterations)."""

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, security.hash_password, password)


async def _verify_password(password: str, stored: str) -> bool:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, security.verify_password, password, stored or ""
    )


async def _send(services: Any, to: str, subject: str, body: str) -> bool:
    """Best-effort delivery. A transport failure must not fail the request.

    Returning False (rather than raising) keeps the ``forgot`` response
    identical whether the send worked, which is what stops the endpoint from
    reporting on the existence or reachability of a specific address.
    """

    try:
        await services.mailer.send(to, subject, body)
        return True
    except MailDeliveryError:
        return False
    except Exception:  # a driver bug must not surface as a 500 to the caller
        logger.exception("Unexpected mailer failure")
        return False


def _token_link(base_url: str, path: str, token: str) -> str:
    """A one-time link with the token in the URL *fragment*, never the query.

    A fragment is never put on the wire: it is not in the request line, so it
    cannot reach an access log, a reverse proxy log, or an analytics pipeline,
    and it is stripped from the ``Referer`` of any request the page then makes,
    so a third-party script on the page cannot exfiltrate it. Moving the token
    to a real query string would leak a live credential into all of those.

    The page reads it with ``useFragmentToken()`` — see
    frontend/components/auth/token-link.ts, which documents the same contract
    from the other side.
    """

    return "{0}{1}#token={2}".format(base_url, path, token)


def _reset_email(base_url: str, token: str, ttl_minutes: int) -> Tuple[str, str]:
    link = _token_link(base_url, RESET_PATH, token)
    body = (
        "Someone asked to reset the password for your RoleTeX account.\n\n"
        "Open this link to choose a new password:\n\n"
        "{0}\n\n"
        "The link works once and expires in {1} minutes. If you did not ask "
        "for this, you can ignore this message — your password has not "
        "changed.\n".format(link, ttl_minutes)
    )
    return "Reset your RoleTeX password", body


def _verify_email(base_url: str, token: str, ttl_hours: int) -> Tuple[str, str]:
    link = _token_link(base_url, VERIFY_PATH, token)
    body = (
        "Confirm this address to finish setting up your RoleTeX account.\n\n"
        "{0}\n\n"
        "The link works once and expires in {1} hours.\n".format(link, ttl_hours)
    )
    return "Confirm your RoleTeX email address", body


def register_account_routes(app: FastAPI, services: Any) -> None:
    """Attach password, verification, and session-management routes."""

    def _database_or_503() -> Any:
        if services.database is None:
            raise _api_error(
                503,
                "database_not_configured",
                "This deployment is running in demo mode without a database.",
            )
        return services.database

    async def _current_token_hash(request: Request) -> Optional[str]:
        context = await resolve_session(request, services)
        return context[2] if context is not None else None

    # -- Password ---------------------------------------------------------

    @app.post("/api/auth/password", response_model=UserResponse)
    async def change_password(
        payload: ChangePasswordRequest, request: Request
    ) -> UserResponse:
        user = await require_user(request, services, allow_unverified=True)
        database = services.database

        if not await _verify_password(
            payload.current_password, user.get("password_hash", "")
        ):
            raise _api_error(
                403, "invalid_credentials", "The current password is incorrect."
            )
        policy_error = security.password_policy_error(payload.new_password)
        if policy_error is not None:
            raise _api_error(400, "weak_password", policy_error)
        if payload.new_password == payload.current_password:
            raise _api_error(
                400,
                "password_unchanged",
                "The new password must differ from the current one.",
            )

        password_hash = await _hash_password(payload.new_password)
        await database.users.update(
            user["_id"],
            {"password_hash": password_hash, "password_changed_at": _utc_now()},
        )
        # A password change is what a user does when they suspect compromise:
        # every other session and every outstanding reset link dies with it.
        keep = await _current_token_hash(request)
        await database.sessions.delete_for_user_except(user["_id"], keep or "")
        await database.auth_tokens.delete_for_user(user["_id"])

        refreshed = await database.users.get(user["_id"]) or user
        return UserResponse(user=await build_user_out(services, refreshed))

    @app.post("/api/auth/password/forgot", response_model=MailDispatchResponse)
    async def forgot_password(
        payload: ForgotPasswordRequest, request: Request
    ) -> MailDispatchResponse:
        database = _database_or_503()
        email = security.normalize_email(payload.email)
        client_ip = _client_ip(request, services.config)
        _check_email_budget(services, client_ip, email or "invalid")

        # Resolve the link origin before the account lookup so a misconfigured
        # server fails identically for known and unknown addresses.
        base_url = _link_base(request, services)

        if email is not None:
            user = await database.users.get_by_email(email)
            if user is not None and not user.get("disabled", False):
                token = security.new_one_time_token()
                await database.auth_tokens.create(
                    user["_id"],
                    AuthTokenStore.PURPOSE_PASSWORD_RESET,
                    security.hash_token(token),
                    _utc_now()
                    + timedelta(minutes=services.config.password_reset_ttl_minutes),
                )
                subject, body = _reset_email(
                    base_url, token, services.config.password_reset_ttl_minutes
                )
                await _send(services, email, subject, body)

        # Deliberately identical for every input: see the module docstring.
        return MailDispatchResponse(delivered=services.mailer.delivers)

    @app.post("/api/auth/password/reset", response_model=OkResponse)
    async def reset_password(
        payload: ResetPasswordRequest, request: Request, response: Response
    ) -> OkResponse:
        database = _database_or_503()
        policy_error = security.password_policy_error(payload.new_password)
        if policy_error is not None:
            raise _api_error(400, "weak_password", policy_error)

        record = await database.auth_tokens.consume(
            AuthTokenStore.PURPOSE_PASSWORD_RESET,
            security.hash_token(payload.token),
        )
        if record is None:
            raise _api_error(
                400,
                "invalid_token",
                "This reset link is invalid, already used, or expired. "
                "Request a new one.",
            )
        user_id = record.get("user_id", "")
        user = await database.users.get(user_id)
        if user is None or user.get("disabled", False):
            raise _api_error(
                400, "invalid_token", "This reset link is no longer valid."
            )

        password_hash = await _hash_password(payload.new_password)
        await database.users.update(
            user_id,
            {"password_hash": password_hash, "password_changed_at": _utc_now()},
        )
        # Nobody proved possession of the old password here, so every existing
        # session is suspect — including any the requester currently holds.
        await database.sessions.delete_for_user(user_id)
        await database.auth_tokens.delete_for_user(user_id)
        clear_session_cookie(response, request, services.config)
        return OkResponse()

    # -- Email verification ------------------------------------------------

    @app.post("/api/auth/verify/request", response_model=MailDispatchResponse)
    async def request_verification(request: Request) -> MailDispatchResponse:
        user = await require_user(request, services, allow_unverified=True)
        database = services.database
        email = user.get("email", "")
        _check_email_budget(services, _client_ip(request, services.config), email)

        if user.get("email_verified", False):
            raise _api_error(
                409, "already_verified", "This address is already verified."
            )

        base_url = _link_base(request, services)
        token = security.new_one_time_token()
        await database.auth_tokens.create(
            user["_id"],
            AuthTokenStore.PURPOSE_EMAIL_VERIFY,
            security.hash_token(token),
            _utc_now() + timedelta(hours=services.config.email_verify_ttl_hours),
        )
        subject, body = _verify_email(
            base_url, token, services.config.email_verify_ttl_hours
        )
        await _send(services, email, subject, body)
        return MailDispatchResponse(delivered=services.mailer.delivers)

    @app.post("/api/auth/verify/confirm", response_model=OkResponse)
    async def confirm_verification(payload: VerifyEmailRequest) -> OkResponse:
        # Deliberately unauthenticated: the link is often opened in a different
        # browser from the one that requested it. The token itself is the proof.
        database = _database_or_503()
        record = await database.auth_tokens.consume(
            AuthTokenStore.PURPOSE_EMAIL_VERIFY, security.hash_token(payload.token)
        )
        if record is None:
            raise _api_error(
                400,
                "invalid_token",
                "This verification link is invalid, already used, or expired.",
            )
        user_id = record.get("user_id", "")
        user = await database.users.get(user_id)
        if user is None or user.get("disabled", False):
            raise _api_error(
                400, "invalid_token", "This verification link is no longer valid."
            )
        await database.users.update(
            user_id, {"email_verified": True, "email_verified_at": _utc_now()}
        )
        return OkResponse()

    # -- Sessions ----------------------------------------------------------

    @app.get("/api/sessions", response_model=SessionListResponse)
    async def list_sessions(request: Request) -> SessionListResponse:
        user = await require_user(request, services, allow_unverified=True)
        current_hash = await _current_token_hash(request)
        records = await services.database.sessions.list_for_user(user["_id"])
        return SessionListResponse(
            sessions=[
                SessionInfo(
                    id=record.get("_id", ""),
                    created_at=record.get("created_at"),
                    last_seen_at=record.get("last_seen_at"),
                    expires_at=record.get("expires_at"),
                    user_agent=record.get("user_agent", "") or "",
                    client_ip=record.get("client_ip", "") or "",
                    current=bool(
                        current_hash and record.get("token_hash") == current_hash
                    ),
                )
                for record in records
            ]
        )

    @app.delete("/api/sessions/{session_id}", response_model=OkResponse)
    async def revoke_session(session_id: str, request: Request) -> OkResponse:
        user = await require_user(request, services, allow_unverified=True)
        deleted = await services.database.sessions.delete_by_id(
            user["_id"], session_id
        )
        if not deleted:
            raise _api_error(404, "session_not_found", "No such active session.")
        return OkResponse()

    @app.delete("/api/sessions", response_model=RevokedResponse)
    async def revoke_other_sessions(request: Request) -> RevokedResponse:
        user = await require_user(request, services, allow_unverified=True)
        keep = await _current_token_hash(request)
        revoked = await services.database.sessions.delete_for_user_except(
            user["_id"], keep or ""
        )
        return RevokedResponse(revoked=revoked)
