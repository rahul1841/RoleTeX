"""Auth API tests: register/login/logout/me, throttling, and demo-mode 503s."""

from __future__ import annotations

import pytest


async def test_register_sets_session_cookie_and_returns_user(make_app, make_client) -> None:
    app = make_app()
    async with make_client(app) as client:
        response = await client.post(
            "/api/auth/register",
            json={"email": "Alice@Example.com", "password": "password123", "name": "Alice"},
        )

        assert response.status_code == 201, response.text
        user = response.json()["user"]
        assert user["email"] == "alice@example.com"
        assert user["name"] == "Alice"
        assert user["providers_with_keys"] == []
        assert "password" not in response.text
        assert client.cookies.get("rt_session")

        me = await client.get("/api/me")
        assert me.status_code == 200
        assert me.json()["user"]["email"] == "alice@example.com"


async def test_register_duplicate_email_conflicts(make_app, make_client, register_user) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="dup@example.com")
        again = await client.post(
            "/api/auth/register",
            json={"email": "dup@example.com", "password": "password123"},
        )

        assert again.status_code == 409
        assert again.json()["detail"]["code"] == "email_taken"


async def test_register_rejects_weak_password_and_bad_email(make_app, make_client) -> None:
    app = make_app()
    async with make_client(app) as client:
        weak = await client.post(
            "/api/auth/register", json={"email": "a@b.com", "password": "short"}
        )
        assert weak.status_code == 400
        assert weak.json()["detail"]["code"] == "weak_password"

        bad_email = await client.post(
            "/api/auth/register", json={"email": "not-an-email", "password": "password123"}
        )
        assert bad_email.status_code == 422
        assert bad_email.json()["detail"]["code"] == "invalid_email"


async def test_registration_can_be_disabled(
    make_app, make_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ALLOW_REGISTRATION", "false")
    app = make_app()
    async with make_client(app) as client:
        response = await client.post(
            "/api/auth/register", json={"email": "a@b.com", "password": "password123"}
        )

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "registration_disabled"


async def test_login_success_and_invalid_credentials(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="login@example.com", password="password123")
        await client.post("/api/auth/logout")

        wrong = await client.post(
            "/api/auth/login",
            json={"email": "login@example.com", "password": "wrong-password"},
        )
        assert wrong.status_code == 401
        assert wrong.json()["detail"]["code"] == "invalid_credentials"

        unknown = await client.post(
            "/api/auth/login",
            json={"email": "nobody@example.com", "password": "password123"},
        )
        assert unknown.status_code == 401
        assert unknown.json()["detail"]["code"] == "invalid_credentials"
        # Same code and message for unknown email: no account enumeration.
        assert unknown.json()["detail"] == wrong.json()["detail"]

        ok = await client.post(
            "/api/auth/login",
            json={"email": "Login@example.com", "password": "password123"},
        )
        assert ok.status_code == 200
        assert ok.json()["user"]["email"] == "login@example.com"
        assert (await client.get("/api/me")).status_code == 200


async def test_login_unknown_email_still_runs_password_verification(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No timing oracle: unknown emails verify against a dummy hash."""

    from app import security

    real_verify = security.verify_password
    verified_hashes = []

    def recording_verify(password: str, stored: str) -> bool:
        verified_hashes.append(stored)
        return real_verify(password, stored)

    monkeypatch.setattr(security, "verify_password", recording_verify)
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="present@example.com")
        await client.post("/api/auth/logout")

        response = await client.post(
            "/api/auth/login",
            json={"email": "absent@example.com", "password": "password123"},
        )

        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "invalid_credentials"
        # The dummy verification performed the same PBKDF2 work as a real one.
        assert verified_hashes == [security.dummy_password_hash()]
        assert verified_hashes[0].startswith("pbkdf2_sha256$")


async def test_password_hashing_runs_off_the_event_loop(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PBKDF2 work must run in a worker thread, never on the event loop."""

    import threading

    from app import security

    real_hash = security.hash_password
    real_verify = security.verify_password
    threads = []

    def recording_hash(password: str) -> str:
        threads.append(threading.current_thread())
        return real_hash(password)

    def recording_verify(password: str, stored: str) -> bool:
        threads.append(threading.current_thread())
        return real_verify(password, stored)

    monkeypatch.setattr(security, "hash_password", recording_hash)
    monkeypatch.setattr(security, "verify_password", recording_verify)
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="offloop@example.com")
        await client.post("/api/auth/logout")
        login = await client.post(
            "/api/auth/login",
            json={"email": "offloop@example.com", "password": "password123"},
        )
        assert login.status_code == 200

    assert threads  # register hashed, login verified
    main_thread = threading.main_thread()
    assert all(thread is not main_thread for thread in threads)


async def test_login_throttle_returns_429_with_retry_after(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LOGIN_MAX_ATTEMPTS", "1")
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="throttle@example.com")
        await client.post("/api/auth/logout")

        first = await client.post(
            "/api/auth/login",
            json={"email": "throttle@example.com", "password": "bad-password"},
        )
        assert first.status_code == 401

        second = await client.post(
            "/api/auth/login",
            json={"email": "throttle@example.com", "password": "password123"},
        )
        assert second.status_code == 429
        assert second.json()["detail"]["code"] == "too_many_attempts"
        assert int(second.headers["retry-after"]) >= 1


async def test_me_requires_session_and_accepts_bearer_token(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        anonymous = await client.get("/api/me")
        assert anonymous.status_code == 401
        assert anonymous.json()["detail"]["code"] == "not_authenticated"

        await register_user(client, email="bearer@example.com")
        token = client.cookies.get("rt_session")
        assert token

    async with make_client(app) as bare_client:
        bearer = await bare_client.get(
            "/api/me", headers={"authorization": "Bearer {0}".format(token)}
        )
        assert bearer.status_code == 200
        assert bearer.json()["user"]["email"] == "bearer@example.com"

        garbage = await bare_client.get(
            "/api/me", headers={"authorization": "Bearer not-a-real-token"}
        )
        assert garbage.status_code == 401


async def test_logout_clears_session_and_is_idempotent(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        first = await client.post("/api/auth/logout")
        assert first.status_code == 200
        assert first.json() == {"ok": True}
        assert (await client.get("/api/me")).status_code == 401

        second = await client.post("/api/auth/logout")
        assert second.status_code == 200


async def test_patch_me_updates_profile_and_validates_provider(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)

        bad = await client.patch("/api/me", json={"default_provider": "made-up"})
        assert bad.status_code == 422
        assert bad.json()["detail"]["code"] == "unknown_provider"

        ok = await client.patch(
            "/api/me",
            json={"name": "Renamed", "default_provider": "groq", "default_model": "llama-x"},
        )
        assert ok.status_code == 200
        user = ok.json()["user"]
        assert user["name"] == "Renamed"
        assert user["default_provider"] == "groq"
        assert user["default_model"] == "llama-x"

        # An explicit null clears a default; omitted fields stay unchanged.
        cleared = await client.patch("/api/me", json={"default_provider": None})
        assert cleared.status_code == 200
        assert cleared.json()["user"]["default_provider"] is None
        assert cleared.json()["user"]["default_model"] == "llama-x"


async def test_delete_me_requires_password_and_wipes_account(
    make_app, make_client, register_user, database
) -> None:
    app = make_app()
    async with make_client(app) as client:
        user = await register_user(client, email="gone@example.com")
        await client.post(
            "/api/jds",
            json={"title": "Role", "content": "x" * 80},
        )

        wrong = await client.request(
            "DELETE", "/api/me", json={"password": "not-the-password"}
        )
        assert wrong.status_code == 403
        assert wrong.json()["detail"]["code"] == "invalid_credentials"

        ok = await client.request("DELETE", "/api/me", json={"password": "password123"})
        assert ok.status_code == 200
        assert (await client.get("/api/me")).status_code == 401

        login = await client.post(
            "/api/auth/login",
            json={"email": "gone@example.com", "password": "password123"},
        )
        assert login.status_code == 401
        assert await database.jds.count_for_user(user["id"]) == 0


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("POST", "/api/auth/register", {"email": "a@b.com", "password": "password123"}),
        ("POST", "/api/auth/login", {"email": "a@b.com", "password": "password123"}),
        ("GET", "/api/me", None),
        ("POST", "/api/auth/logout", None),
    ],
)
async def test_auth_routes_return_503_in_demo_mode(
    make_app, make_client, method: str, path: str, body
) -> None:
    app = make_app(multi_user=False)
    async with make_client(app) as client:
        response = await client.request(method, path, json=body)

        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "database_not_configured"
