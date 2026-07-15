"""Mongo-outage behavior: structured 503s (rule C-4) and non-blocking startup.

mongomock can never raise real connection errors, so these tests inject
``pymongo`` failures into the store layer to prove every path — the session
lookup in the rate-limit middleware and route bodies alike — translates a
driver failure into the ``{code, message}`` error contract instead of an
unstructured plain-text 500.
"""

from __future__ import annotations

import asyncio

import pytest
from pymongo.errors import ServerSelectionTimeoutError

from app.main import _ensure_indexes_with_retry


async def test_middleware_session_lookup_maps_mongo_outage_to_503(
    make_app, make_client, register_user, database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A cookie-bearing request during an outage gets a structured 503."""

    app = make_app()
    async with make_client(app) as client:
        await register_user(client)

        async def broken_get(token_hash: str):
            raise ServerSelectionTimeoutError("No servers available")

        monkeypatch.setattr(database.sessions, "get", broken_get)
        response = await client.get("/api/resumes")

        assert response.status_code == 503
        assert response.headers["content-type"].startswith("application/json")
        assert response.json()["detail"]["code"] == "database_unavailable"


async def test_route_body_maps_mongo_outage_to_503(
    make_app, make_client, database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Login (no cookie, so past the middleware) still returns the contract."""

    app = make_app()
    async with make_client(app) as client:

        async def broken_get_by_email(email: str):
            raise ServerSelectionTimeoutError("No servers available")

        monkeypatch.setattr(database.users, "get_by_email", broken_get_by_email)
        response = await client.post(
            "/api/auth/login",
            json={"email": "user@example.com", "password": "password123"},
        )

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "database_unavailable"


async def test_register_maps_mongo_outage_to_503(
    make_app, make_client, database, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = make_app()
    async with make_client(app) as client:

        async def broken_create(email: str, password_hash: str, name: str = ""):
            raise ServerSelectionTimeoutError("No servers available")

        monkeypatch.setattr(database.users, "create", broken_create)
        response = await client.post(
            "/api/auth/register",
            json={"email": "user@example.com", "password": "password123"},
        )

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "database_unavailable"


# ---------------------------------------------------------------------------
# Startup index creation must never block the server from accepting requests
# ---------------------------------------------------------------------------


class _FlakyDatabase:
    """Ping fails a few times before the database becomes reachable."""

    def __init__(self, failures: int) -> None:
        self.remaining_failures = failures
        self.ping_calls = 0
        self.ensure_calls = 0

    async def ping(self) -> bool:
        self.ping_calls += 1
        if self.remaining_failures > 0:
            self.remaining_failures -= 1
            return False
        return True

    async def ensure_indexes(self) -> None:
        self.ensure_calls += 1


async def test_ensure_indexes_retries_until_database_is_reachable() -> None:
    fake = _FlakyDatabase(failures=2)
    await asyncio.wait_for(
        _ensure_indexes_with_retry(fake, delay_seconds=0.01), timeout=2.0
    )
    assert fake.ping_calls == 3
    assert fake.ensure_calls == 1


async def test_startup_schedules_index_creation_in_background(make_app) -> None:
    """The startup hook returns immediately; index work runs as a task."""

    app = make_app()
    await app.router.startup()
    try:
        task = getattr(app.state, "index_task", None)
        assert isinstance(task, asyncio.Task)
        # mongomock pings successfully, so the task completes on its own.
        await asyncio.wait_for(task, timeout=2.0)
    finally:
        await app.router.shutdown()
