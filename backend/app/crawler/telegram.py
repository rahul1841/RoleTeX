"""Telegram delivery for job digests, and the bot's two commands.

Security rationale:
- The bot token is a secret from the environment (rule R-9). It is part of
  every Bot API URL, so it must never reach a log: errors here carry only an
  exception class or Telegram's own description, and a logging filter redacts
  ``/bot<token>/`` from httpx's request log in case it is ever enabled.
- Linking uses a one-time token in a ``t.me/<bot>?start=<token>`` deep link,
  minted for a signed-in user and stored only as a SHA-256 hash with a short
  TTL (``AuthTokenStore``). The chat id arrives from Telegram's side, so a user
  can only ever bind a chat they control.
- A private Hugging Face Space cannot receive webhooks (it requires an HF
  token Telegram cannot send), so updates are read with ``getUpdates`` long
  polling. ``deleteWebhook`` runs first because the two modes exclude each other.
- Messages carry job data only, never resume content, and every posting
  string is HTML-escaped for ``parse_mode=HTML``.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
from typing import Any, Dict, List, Optional

import httpx


logger = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org"
#: Telegram's limit is 4,096 characters after entity parsing.
MAX_MESSAGE_CHARACTERS = 3_900
JOBS_PER_MESSAGE = 10
MAX_JOBS_PER_DIGEST = 30
POLL_TIMEOUT_SECONDS = 50
_START_PAYLOAD = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class NotifierError(RuntimeError):
    """A send that failed. ``code``: blocked, chat_not_found, rate_limited, failed."""

    def __init__(self, message: str, code: str, retry_after: Optional[float] = None) -> None:
        self.code = code
        self.retry_after = retry_after
        super().__init__(message)


class _RedactBotToken(logging.Filter):
    """Strip the token from any log record that quotes a Bot API URL."""

    _PATTERN = re.compile(r"/bot[0-9]+:[A-Za-z0-9_-]+")

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        if "/bot" in message:
            record.msg = self._PATTERN.sub("/bot<redacted>", message)
            record.args = ()
        return True


class Notifier:
    """Transport interface; ``configured`` False means nothing is delivered."""

    configured = False
    bot_username = ""

    async def send(self, chat_id: int, text: str) -> None:
        raise NotImplementedError

    async def get_updates(self, offset: int, timeout: int) -> List[Dict[str, Any]]:
        return []

    async def delete_webhook(self) -> None:
        return None

    async def close(self) -> None:
        return None


class ConsoleNotifier(Notifier):
    """Development driver: digests go to the server log instead of Telegram."""

    configured = False

    async def send(self, chat_id: int, text: str) -> None:
        logger.warning("[console notifier] no TELEGRAM_BOT_TOKEN; digest not sent:\n%s", text)


class TelegramNotifier(Notifier):
    configured = True

    def __init__(self, token: str, bot_username: str, http_client: Optional[httpx.AsyncClient] = None) -> None:
        self._token = token
        self.bot_username = bot_username
        self._client = http_client or httpx.AsyncClient(
            timeout=httpx.Timeout(POLL_TIMEOUT_SECONDS + 15), trust_env=False
        )
        logging.getLogger("httpx").addFilter(_RedactBotToken())

    async def close(self) -> None:
        await self._client.aclose()

    async def _call(self, method: str, payload: Dict[str, Any], timeout: float = 20.0) -> Any:
        url = "{0}/bot{1}/{2}".format(API_BASE, self._token, method)
        try:
            response = await self._client.post(url, json=payload, timeout=timeout)
        except httpx.HTTPError as exc:
            raise NotifierError("Telegram could not be reached ({0})".format(type(exc).__name__), "failed") from exc
        try:
            data = response.json()
        except ValueError:
            data = {}
        if response.status_code == 200 and isinstance(data, dict) and data.get("ok"):
            return data.get("result")
        description = str((data or {}).get("description", ""))[:200] if isinstance(data, dict) else ""
        parameters = (data or {}).get("parameters") if isinstance(data, dict) else None
        if response.status_code == 429:
            retry_after = None
            if isinstance(parameters, dict):
                try:
                    retry_after = float(parameters.get("retry_after"))
                except (TypeError, ValueError):
                    retry_after = None
            raise NotifierError("Telegram rate limit", "rate_limited", retry_after)
        if response.status_code == 403:
            raise NotifierError("The user blocked the bot", "blocked")
        if response.status_code == 400 and "chat not found" in description.lower():
            raise NotifierError("Telegram chat not found", "chat_not_found")
        raise NotifierError(
            "Telegram rejected the request (HTTP {0}): {1}".format(response.status_code, description),
            "failed",
        )

    async def send(self, chat_id: int, text: str) -> None:
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "link_preview_options": {"is_disabled": True},
        }
        for attempt in range(2):
            try:
                await self._call("sendMessage", payload)
                return
            except NotifierError as exc:
                if exc.code == "rate_limited" and attempt == 0:
                    await asyncio.sleep(min(30.0, exc.retry_after or 5.0))
                    continue
                raise

    async def get_updates(self, offset: int, timeout: int) -> List[Dict[str, Any]]:
        result = await self._call(
            "getUpdates",
            {"offset": offset, "timeout": timeout, "allowed_updates": ["message"]},
            timeout=timeout + 15,
        )
        return [item for item in result or [] if isinstance(item, dict)]

    async def delete_webhook(self) -> None:
        await self._call("deleteWebhook", {"drop_pending_updates": False})


def notifier_from_config(config: Any) -> Notifier:
    token = (getattr(config, "telegram_bot_token", "") or "").strip()
    username = (getattr(config, "telegram_bot_username", "") or "").strip()
    if not token or not username:
        return ConsoleNotifier()
    return TelegramNotifier(token, username)


def optional_notifier(notifier: Optional[Notifier], config: Any) -> Notifier:
    """Resolve an injected notifier or build one from config (rule C-3)."""

    return notifier if notifier is not None else notifier_from_config(config)


def deep_link(bot_username: str, token: str) -> str:
    return "https://t.me/{0}?start={1}".format(bot_username, token)


def start_payload(text: str) -> Optional[str]:
    """The token in ``/start <token>``; None for a bare or malformed /start."""

    parts = (text or "").strip().split()
    if len(parts) != 2 or parts[0].split("@", 1)[0] != "/start":
        return None
    return parts[1] if _START_PAYLOAD.match(parts[1]) else None


def command(text: str) -> str:
    first = (text or "").strip().split(" ", 1)[0]
    return first.split("@", 1)[0].lower()


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

LINKED_MESSAGE = (
    "Connected to RoleTeX. New job matches will arrive here after each crawl.\n"
    "Send /stop to disconnect."
)
EXPIRED_MESSAGE = (
    "That link has expired or was already used. In RoleTeX open Settings → "
    "Telegram and press Connect again."
)
HELP_MESSAGE = "To get job alerts here, open RoleTeX → Settings → Telegram and press Connect."
STOPPED_MESSAGE = "Disconnected. You will not get job alerts here any more."


def _escape(value: str) -> str:
    return html.escape(value or "", quote=False)


def format_digest(
    items: List[Dict[str, str]],
    total_new: int,
    backlog: int,
    jobs_url: str,
) -> List[str]:
    """Digest messages for one user.

    ``items`` are ``{company, title, location, experience, label, url}`` for the
    newest matches (at most ``MAX_JOBS_PER_DIGEST``); ``total_new`` counts all
    new ones; ``backlog`` counts matches from newly added companies, which are
    summarized in one line instead of listed.
    """

    blocks: List[str] = []
    for item in items[:MAX_JOBS_PER_DIGEST]:
        details = " · ".join(
            part for part in (item.get("location", ""), item.get("experience", ""), item.get("label", "")) if part
        )
        url = item.get("url", "")
        line = "<b>{0} — {1}</b>".format(_escape(item.get("company", "")), _escape(item.get("title", "")))
        if details:
            line += "\n" + _escape(details)
        if url:
            line += '\n<a href="{0}">Open posting</a>'.format(html.escape(url, quote=True))
        blocks.append(line)

    footer: List[str] = []
    remaining = total_new - min(len(items), MAX_JOBS_PER_DIGEST)
    if remaining > 0:
        footer.append("…and {0} more.".format(remaining))
    if backlog > 0:
        footer.append(
            "{0} matching opening{1} at newly added companies.".format(backlog, "" if backlog == 1 else "s")
        )
    if jobs_url:
        footer.append('<a href="{0}">All matches in RoleTeX</a>'.format(html.escape(jobs_url, quote=True)))

    if total_new > 0:
        header = "<b>{0} new opening{1} for you</b>".format(total_new, "" if total_new == 1 else "s")
    else:
        header = "<b>Job watch</b>"

    messages: List[str] = []
    current = header
    count = 0
    for block in blocks:
        candidate = current + "\n\n" + block
        if count >= JOBS_PER_MESSAGE or len(candidate) > MAX_MESSAGE_CHARACTERS:
            messages.append(current)
            current = block
            count = 0
        else:
            current = candidate
        count += 1
    tail = "\n\n".join(footer)
    if tail:
        if len(current) + len(tail) + 2 > MAX_MESSAGE_CHARACTERS:
            messages.append(current)
            current = tail
        else:
            current = current + "\n\n" + tail
    messages.append(current)
    return messages
