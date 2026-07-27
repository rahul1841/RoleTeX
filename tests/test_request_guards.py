"""Regression tests for the request-guard fixes (code review findings 1-4).

Every pre-existing 413 test declares ``content-length`` explicitly, so the
branch that mattered — a chunked request, which carries no length at all — had
no coverage and could have been deleted silently. These tests drive real
chunked bodies through the ASGI stack instead.
"""

from __future__ import annotations

from typing import AsyncIterator, Optional

import httpx
import pytest


PDF_BOUNDARY = "----roletexboundary"
MULTIPART_HEADERS = {
    "content-type": "multipart/form-data; boundary={0}".format(PDF_BOUNDARY)
}
JD_CONTENT = (
    "We are hiring a backend engineer to build reliable Python and FastAPI "
    "services, improve PostgreSQL performance, and maintain Docker delivery workflows."
)


async def chunked(total_bytes: int, chunk_size: int = 16_384) -> AsyncIterator[bytes]:
    """Body stream with no Content-Length, i.e. Transfer-Encoding: chunked."""

    sent = 0
    while sent < total_bytes:
        size = min(chunk_size, total_bytes - sent)
        yield b"x" * size
        sent += size


async def chunked_pdf_upload(
    payload_bytes: int, chunk_size: int = 100_000
) -> AsyncIterator[bytes]:
    """Multipart file part streamed without a Content-Length."""

    yield (
        '--{0}\r\n'
        'Content-Disposition: form-data; name="file"; filename="resume.pdf"\r\n'
        "Content-Type: application/pdf\r\n\r\n".format(PDF_BOUNDARY)
    ).encode() + b"%PDF-1.7\n"
    sent = 0
    while sent < payload_bytes:
        size = min(chunk_size, payload_bytes - sent)
        yield b"A" * size
        sent += size
    yield "\r\n--{0}--\r\n".format(PDF_BOUNDARY).encode()


# ---------------------------------------------------------------------------
# Finding 1: the body-size cap must not depend on Content-Length
# ---------------------------------------------------------------------------


async def test_chunked_body_over_limit_is_rejected_without_content_length(
    make_app, make_client
) -> None:
    app = make_app()
    async with make_client(app) as client:
        response = await client.post(
            "/api/tailor",
            content=chunked(200_000),  # over the 64KB default
            headers={"content-type": "application/json"},
        )

        assert "content-length" not in response.request.headers
        assert response.request.headers.get("transfer-encoding") == "chunked"
        assert response.status_code == 413
        assert response.json()["detail"]["code"] == "request_too_large"


async def test_chunked_pdf_upload_is_capped_before_authentication(
    make_app, make_client
) -> None:
    """The decisive case: no session, and the cap still binds.

    FastAPI resolves ``file: UploadFile = File(...)`` as a dependency before the
    handler body runs ``require_user``, so an unauthenticated caller reaches the
    multipart parser. Without a byte ceiling it can spool an arbitrary amount to
    disk and only then be told 401.
    """

    app = make_app()
    async with make_client(app) as client:
        response = await client.post(
            "/api/resumes/pdf",
            content=chunked_pdf_upload(60_000_000),
            headers=MULTIPART_HEADERS,
        )

        assert response.status_code == 413
        assert response.json()["detail"]["code"] == "request_too_large"


async def test_chunked_body_under_limit_still_reaches_the_route(
    make_app, make_client, register_user
) -> None:
    """The cap must not break legitimate streamed requests."""

    app = make_app()
    async with make_client(app) as client:
        await register_user(client)

        async def body() -> AsyncIterator[bytes]:
            yield b'{"title": "Backend Engineer", "content": "'
            yield JD_CONTENT.encode()
            yield b'"}'

        response = await client.post(
            "/api/jds", content=body(), headers={"content-type": "application/json"}
        )
        assert response.status_code == 201, response.text


async def test_unparseable_content_length_is_rejected(make_app, make_client) -> None:
    app = make_app()
    async with make_client(app) as client:
        response = await client.post(
            "/api/tailor",
            content=b"{}",
            headers={"content-type": "application/json", "content-length": "not-a-number"},
        )
        assert response.status_code == 413
        assert response.json()["detail"]["code"] == "request_too_large"


async def test_oversized_pdf_between_route_cap_and_multipart_allowance(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The route-level check owns the multipart-overhead gap.

    The middleware ceiling is ``max_pdf_upload_bytes + MULTIPART_OVERHEAD_BYTES``
    so real boundary/header bytes are not counted against the user's PDF budget.
    A file landing inside that slack passes the middleware, so ``_read_pdf_upload``
    is what must reject it — and it has to do so without reading it all first.
    """

    from starlette.datastructures import UploadFile

    requested = []
    unpatched_read = UploadFile.read

    async def spy(self, size: int = -1) -> bytes:
        requested.append(size)
        return await unpatched_read(self, size)

    monkeypatch.setattr(UploadFile, "read", spy)
    monkeypatch.setenv("MAX_PDF_UPLOAD_BYTES", "1000000")  # the clamped minimum
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        response = await client.post(
            "/api/resumes/pdf",
            content=chunked_pdf_upload(1_030_000),  # > 1MB cap, < 1MB + 64KB
            headers=MULTIPART_HEADERS,
        )

        assert response.status_code == 413
        assert response.json()["detail"]["code"] == "pdf_too_large"

    # ...and it must reject from a bounded read, never after slurping the part.
    assert requested, "the route never read the upload"
    assert -1 not in requested
    assert max(requested) <= 1_000_001


# ---------------------------------------------------------------------------
# Finding 4: 422 bodies must not echo what was submitted
# ---------------------------------------------------------------------------


async def test_validation_error_does_not_echo_the_submitted_body(
    make_app, make_client
) -> None:
    app = make_app()
    secret = "SSN 123-45-6789 and a home address"
    async with make_client(app) as client:
        # Unauthenticated on purpose: this body is rejected by schema validation
        # before the route's auth dependency ever runs.
        response = await client.post(
            "/api/resumes", json={"latex": secret, "provider": "mock"}
        )

        assert response.status_code == 422
        raw = response.text
        assert secret not in raw
        assert "123-45-6789" not in raw
        detail = response.json()["detail"]
        assert detail["code"] == "invalid_request"
        assert "latex" in " ".join(detail["errors"])


async def test_validation_error_response_is_bounded(make_app, make_client) -> None:
    """A large rejected body must not come back as a large error body."""

    app = make_app()
    # Over the field's 200_000 max_length, under the 260KB import body cap: the
    # request survives the middleware and dies in schema validation.
    payload = "y" * 200_001
    async with make_client(app) as client:
        response = await client.post("/api/resumes", json={"latex": payload})

        assert response.status_code == 422
        assert payload[:1_000] not in response.text
        assert len(response.content) < 2_000


async def test_validation_error_keeps_the_structured_error_contract(
    make_app, make_client
) -> None:
    app = make_app()
    async with make_client(app) as client:
        response = await client.post("/api/auth/register", json={"email": "nope"})

        assert response.status_code == 422
        detail = response.json()["detail"]
        assert set(("code", "message", "errors")).issubset(detail)
        assert isinstance(detail["errors"], list)
        assert all(isinstance(item, str) for item in detail["errors"])


# ---------------------------------------------------------------------------
# Findings 2 and 3: rate-limit keys
# ---------------------------------------------------------------------------


async def test_llm_ip_ceiling_survives_account_cycling(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Registering fresh accounts must not mint fresh LLM budget.

    The per-user bucket resets per account, so on its own it caps politeness
    rather than cost. The per-IP ceiling is what actually bounds spend.
    """

    monkeypatch.setenv("RATE_LIMIT_LLM_CALLS", "1")
    monkeypatch.setenv("RATE_LIMIT_LLM_IP_CALLS", "2")
    app = make_app()

    accepted = 0
    for index in range(4):
        async with make_client(app) as client:
            await register_user(client, email="cycler{0}@example.com".format(index))
            response = await client.post("/api/tailor", json={})
            if response.status_code != 429:
                accepted += 1

    # Four accounts, but the IP ceiling stops the third and fourth.
    assert accepted == 2


async def test_llm_ip_ceiling_does_not_shrink_a_single_user_budget(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The IP ceiling is a floor under abuse, not a tighter per-user limit."""

    monkeypatch.setenv("RATE_LIMIT_LLM_CALLS", "3")
    monkeypatch.setenv("RATE_LIMIT_LLM_IP_CALLS", "3")
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        for _ in range(3):
            assert (await client.post("/api/tailor", json={})).status_code != 429
        assert (await client.post("/api/tailor", json={})).status_code == 429


async def test_anonymous_llm_requests_are_charged_once(
    make_app, make_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Demo mode keys the per-user bucket on the IP already; do not double-bill."""

    monkeypatch.setenv("RATE_LIMIT_LLM_CALLS", "2")
    monkeypatch.setenv("RATE_LIMIT_LLM_IP_CALLS", "2")
    app = make_app(multi_user=False)
    async with make_client(app) as client:
        assert (await client.post("/api/tailor", json={})).status_code != 429
        assert (await client.post("/api/tailor", json={})).status_code != 429
        assert (await client.post("/api/tailor", json={})).status_code == 429


def _forwarded_client(make_client, app, forwarded_for: str, peer: str = "10.0.0.1"):
    """Client that presents a fixed X-Forwarded-For, as a proxy would."""

    transport = httpx.ASGITransport(app=app, client=(peer, 443))
    return httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
        headers={"x-forwarded-for": forwarded_for},
    )


async def test_login_throttle_separates_callers_behind_a_trusted_proxy(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With every visitor sharing the proxy's socket address, the (email, ip)
    throttle key collapses to per-email — so failed guesses from a stranger
    lock the real owner out. Trusting the declared hop separates them again."""

    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    monkeypatch.setenv("LOGIN_MAX_ATTEMPTS", "2")
    app = make_app()

    async with make_client(app) as owner:
        await register_user(owner, email="owner@example.com", password="password123")

    async with _forwarded_client(make_client, app, "198.51.100.5") as attacker:
        for _ in range(2):
            failed = await attacker.post(
                "/api/auth/login",
                json={"email": "owner@example.com", "password": "wrong-password"},
            )
            assert failed.status_code == 401
        blocked = await attacker.post(
            "/api/auth/login",
            json={"email": "owner@example.com", "password": "wrong-password"},
        )
        assert blocked.status_code == 429

    # Same email, different forwarded address: the real owner still gets in.
    async with _forwarded_client(make_client, app, "203.0.113.9") as victim:
        response = await victim.post(
            "/api/auth/login",
            json={"email": "owner@example.com", "password": "password123"},
        )
        assert response.status_code == 200, response.text


async def test_forwarded_header_is_ignored_unless_trust_is_enabled(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Off by default: otherwise anyone forges a fresh bucket per request."""

    monkeypatch.setenv("LOGIN_MAX_ATTEMPTS", "2")
    app = make_app()
    async with make_client(app) as owner:
        await register_user(owner, email="owner@example.com", password="password123")

    async def attempt(forwarded: Optional[str]) -> int:
        async with _forwarded_client(make_client, app, forwarded or "") as client:
            response = await client.post(
                "/api/auth/login",
                json={"email": "owner@example.com", "password": "wrong-password"},
            )
            return response.status_code

    assert await attempt("198.51.100.1") == 401
    assert await attempt("198.51.100.2") == 401
    # A third forged address must not buy a third attempt.
    assert await attempt("198.51.100.3") == 429
