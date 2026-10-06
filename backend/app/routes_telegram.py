"""Linking a Telegram chat for job digests.

Security rationale:
- ``POST /api/telegram/link`` mints a 256-bit one-time token for the signed-in
  user, stores only its SHA-256 (``AuthTokenStore``, purpose
  ``telegram_link``, short TTL) and returns a ``t.me`` deep link. The bot binds
  the chat when Telegram delivers ``/start <token>`` (``CrawlerService``), so a
  chat id never comes from the browser.
- Minting a new link revokes the user's earlier unused ones.
- The bot token never leaves the server; the response carries only the bot's
  public username.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, Request

from . import security
from .auth import _api_error, require_user
from .crawler.telegram import deep_link
from .db import AuthTokenStore
from .schemas import OkResponse, TelegramLinkResponse, TelegramStatus


def register_telegram_routes(app: FastAPI, services: Any) -> None:
    database = services.database

    @app.get("/api/telegram", response_model=TelegramStatus)
    async def telegram_status(request: Request) -> TelegramStatus:
        user = await require_user(request, services)
        linked = user.get("telegram") if isinstance(user.get("telegram"), dict) else None
        return TelegramStatus(
            available=bool(services.notifier.configured),
            linked=linked is not None and linked.get("chat_id") is not None,
            linked_at=(linked or {}).get("linked_at"),
            bot_username=services.notifier.bot_username if services.notifier.configured else "",
        )

    @app.post("/api/telegram/link", response_model=TelegramLinkResponse)
    async def telegram_link(request: Request) -> TelegramLinkResponse:
        user = await require_user(request, services)
        if not services.notifier.configured:
            raise _api_error(
                503,
                "telegram_not_configured",
                "Telegram alerts are not set up on this server.",
            )
        await database.auth_tokens.delete_for_user(
            user["_id"], AuthTokenStore.PURPOSE_TELEGRAM_LINK
        )
        token = security.new_one_time_token()
        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=services.config.telegram_link_ttl_minutes
        )
        await database.auth_tokens.create(
            user["_id"],
            AuthTokenStore.PURPOSE_TELEGRAM_LINK,
            security.hash_token(token),
            expires_at,
        )
        return TelegramLinkResponse(
            url=deep_link(services.notifier.bot_username, token), expires_at=expires_at
        )

    @app.delete("/api/telegram", response_model=OkResponse)
    async def telegram_unlink(request: Request) -> OkResponse:
        user = await require_user(request, services)
        await database.users.unlink_telegram(user["_id"])
        return OkResponse()
