"""Outbound email transport for the account-lifecycle flows.

Security rationale:
- The transport is deliberately dumb: it receives a fully-formed subject and
  body and knows nothing about tokens. One-time tokens are minted, hashed, and
  stored by :mod:`app.routes_account`; only the SHA-256 hash reaches the
  database, and the plaintext link exists solely inside the outbound message.
- SMTP credentials come from the environment (rule R-9), are never echoed to a
  client, and are never included in an exception message — a failed send raises
  :class:`MailDeliveryError` carrying only the driver name.
- ``smtplib`` is blocking, so every send runs in a worker thread; a hung or
  unreachable mail server can never stall the event loop past its timeout.
- :class:`ConsoleMailer` is the default so a developer instance works with no
  mail server at all. It writes the message to the log, which is why the reset
  link may only be derived from the request's own ``Host`` header while this
  driver is active — see ``routes_account._link_base`` for the host-header
  poisoning argument.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import smtplib
from email.message import EmailMessage
from typing import Any, Optional


logger = logging.getLogger(__name__)

# Dedicated thread pool for blocking SMTP sends.  The default executor is
# shared with PBKDF2 hashing (login, registration, password-change); a slow
# or unreachable SMTP server would consume all its threads and stall every
# auth operation.  A separate pool with a modest cap keeps the two workloads
# isolated.
_SMTP_POOL = concurrent.futures.ThreadPoolExecutor(
    max_workers=4, thread_name_prefix="smtp"
)


class MailDeliveryError(RuntimeError):
    """Raised when a message could not be handed to the transport."""


class Mailer:
    """Transport interface: deliver one message to one address.

    ``body`` is the plain-text fallback; ``html_body`` (when given) is the
    HTML alternative attached as multipart/alternative.
    """

    driver = "none"
    #: True when the driver actually delivers mail to a recipient's inbox.
    delivers = False

    async def send(
        self, to: str, subject: str, body: str, html_body: Optional[str] = None
    ) -> None:
        raise NotImplementedError


class ConsoleMailer(Mailer):
    """Development driver: log the message instead of delivering it.

    Chosen automatically when ``SMTP_HOST`` is unset so password reset and email
    verification remain exercisable locally. The operator reads the link out of
    the application log.
    """

    driver = "console"
    delivers = False

    async def send(
        self, to: str, subject: str, body: str, html_body: Optional[str] = None
    ) -> None:
        logger.warning(
            "[console mailer] no SMTP_HOST configured; message not delivered.\n"
            "To: %s\nSubject: %s\n%s",
            to,
            subject,
            body,
        )


class SmtpMailer(Mailer):
    """Deliver via SMTP using the standard library (no extra dependency)."""

    driver = "smtp"
    delivers = True

    def __init__(
        self,
        host: str,
        port: int,
        username: str = "",
        password: str = "",
        use_starttls: bool = True,
        timeout_seconds: int = 15,
        mail_from: str = "",
    ) -> None:
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.use_starttls = use_starttls
        self.timeout_seconds = timeout_seconds
        self.mail_from = mail_from or "roletex@localhost"

    def _build(
        self, to: str, subject: str, body: str, html_body: Optional[str] = None
    ) -> EmailMessage:
        message = EmailMessage()
        message["From"] = self.mail_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)
        if html_body:
            message.add_alternative(html_body, subtype="html")
        return message

    def _send_blocking(self, message: EmailMessage) -> None:
        with smtplib.SMTP(
            self.host, self.port, timeout=self.timeout_seconds
        ) as client:
            if self.use_starttls:
                client.starttls()
            if self.username:
                client.login(self.username, self.password)
            client.send_message(message)

    async def send(
        self, to: str, subject: str, body: str, html_body: Optional[str] = None
    ) -> None:
        message = self._build(to, subject, body, html_body)
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(_SMTP_POOL, self._send_blocking, message)
        except Exception as exc:
            # Log the class only: an SMTP exception can quote the server banner
            # and, on an auth failure, the username that was attempted.
            logger.error(
                "SMTP delivery failed via %s:%s (%s)",
                self.host,
                self.port,
                type(exc).__name__,
            )
            raise MailDeliveryError("Message could not be delivered") from exc


def mailer_from_config(config: Any) -> Mailer:
    """Pick a transport: SMTP when ``SMTP_HOST`` is set, console otherwise."""

    host = (getattr(config, "smtp_host", "") or "").strip()
    if not host:
        return ConsoleMailer()
    return SmtpMailer(
        host=host,
        port=int(getattr(config, "smtp_port", 587)),
        username=getattr(config, "smtp_username", "") or "",
        password=getattr(config, "smtp_password", "") or "",
        use_starttls=bool(getattr(config, "smtp_starttls", True)),
        timeout_seconds=int(getattr(config, "smtp_timeout_seconds", 15)),
        mail_from=getattr(config, "mail_from", "") or "",
    )


def optional_mailer(mailer: Optional[Mailer], config: Any) -> Mailer:
    """Resolve an injected mailer or build one from config (rule C-3)."""

    return mailer if mailer is not None else mailer_from_config(config)
