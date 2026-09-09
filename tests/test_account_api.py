"""Account-lifecycle API tests: password change/reset, verification, sessions.

Covers the failure paths as well as the happy ones (rule T-4): enumeration
safety on ``forgot``, single-use token semantics, session revocation on both
password paths, the reset-link host-header guard, and the disabled-account gate.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.db import AuthTokenStore


BASE_URL_ENV = "PUBLIC_BASE_URL"
PUBLIC_BASE = "https://roletex.example"


@pytest.fixture(autouse=True)
def _public_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """The delivering test mailer requires an explicit link origin."""

    monkeypatch.setenv(BASE_URL_ENV, PUBLIC_BASE)


# ---------------------------------------------------------------------------
# Password change (authenticated)
# ---------------------------------------------------------------------------


async def test_change_password_updates_credential_and_keeps_current_session(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="pw@example.com", password="password123")

        changed = await client.post(
            "/api/auth/password",
            json={"current_password": "password123", "new_password": "newpassword456"},
        )
        assert changed.status_code == 200, changed.text

        # The requesting session survives the change.
        assert (await client.get("/api/me")).status_code == 200

        await client.post("/api/auth/logout")
        stale = await client.post(
            "/api/auth/login",
            json={"email": "pw@example.com", "password": "password123"},
        )
        assert stale.status_code == 401
        fresh = await client.post(
            "/api/auth/login",
            json={"email": "pw@example.com", "password": "newpassword456"},
        )
        assert fresh.status_code == 200, fresh.text


async def test_change_password_revokes_other_sessions(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as first, make_client(app) as second:
        await register_user(first, email="multi@example.com", password="password123")
        signed_in = await second.post(
            "/api/auth/login",
            json={"email": "multi@example.com", "password": "password123"},
        )
        assert signed_in.status_code == 200
        assert (await second.get("/api/me")).status_code == 200

        changed = await first.post(
            "/api/auth/password",
            json={"current_password": "password123", "new_password": "newpassword456"},
        )
        assert changed.status_code == 200

        # The second browser is ejected; the first is untouched.
        assert (await second.get("/api/me")).status_code == 401
        assert (await first.get("/api/me")).status_code == 200


async def test_change_password_rejects_wrong_current_weak_and_unchanged(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="reject@example.com", password="password123")

        wrong = await client.post(
            "/api/auth/password",
            json={"current_password": "nope-wrong", "new_password": "newpassword456"},
        )
        assert wrong.status_code == 403
        assert wrong.json()["detail"]["code"] == "invalid_credentials"

        weak = await client.post(
            "/api/auth/password",
            json={"current_password": "password123", "new_password": "short"},
        )
        assert weak.status_code == 400
        assert weak.json()["detail"]["code"] == "weak_password"

        same = await client.post(
            "/api/auth/password",
            json={"current_password": "password123", "new_password": "password123"},
        )
        assert same.status_code == 400
        assert same.json()["detail"]["code"] == "password_unchanged"


async def test_change_password_requires_authentication(make_app, make_client) -> None:
    app = make_app()
    async with make_client(app) as client:
        response = await client.post(
            "/api/auth/password",
            json={"current_password": "password123", "new_password": "newpassword456"},
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Forgot / reset password
# ---------------------------------------------------------------------------


async def test_forgot_password_emails_a_working_reset_link(
    make_app, make_client, register_user, mailer
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="forgot@example.com", password="password123")
        await client.post("/api/auth/logout")

        asked = await client.post(
            "/api/auth/password/forgot", json={"email": "forgot@example.com"}
        )
        assert asked.status_code == 200, asked.text
        assert asked.json() == {"ok": True, "delivered": True}
        assert len(mailer.sent) == 1
        assert mailer.sent[0]["to"] == "forgot@example.com"
        assert mailer.last_link().startswith(PUBLIC_BASE)

        token = mailer.last_token()
        reset = await client.post(
            "/api/auth/password/reset",
            json={"token": token, "new_password": "brandnewpass"},
        )
        assert reset.status_code == 200, reset.text

        signed_in = await client.post(
            "/api/auth/login",
            json={"email": "forgot@example.com", "password": "brandnewpass"},
        )
        assert signed_in.status_code == 200, signed_in.text


async def test_forgot_password_does_not_reveal_whether_an_account_exists(
    make_app, make_client, register_user, mailer
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="known@example.com")
        await client.post("/api/auth/logout")
        mailer.sent.clear()

        known = await client.post(
            "/api/auth/password/forgot", json={"email": "known@example.com"}
        )
        unknown = await client.post(
            "/api/auth/password/forgot", json={"email": "nobody@example.com"}
        )
        malformed = await client.post(
            "/api/auth/password/forgot", json={"email": "not-an-email"}
        )

        assert known.status_code == unknown.status_code == malformed.status_code == 200
        assert known.json() == unknown.json() == malformed.json()
        # Only the real account actually produced a message.
        assert [message["to"] for message in mailer.sent] == ["known@example.com"]


async def test_reset_token_is_single_use(
    make_app, make_client, register_user, mailer
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="once@example.com")
        await client.post("/api/auth/logout")
        await client.post("/api/auth/password/forgot", json={"email": "once@example.com"})
        token = mailer.last_token()

        first = await client.post(
            "/api/auth/password/reset",
            json={"token": token, "new_password": "firstpassword"},
        )
        assert first.status_code == 200

        replay = await client.post(
            "/api/auth/password/reset",
            json={"token": token, "new_password": "secondpassword"},
        )
        assert replay.status_code == 400
        assert replay.json()["detail"]["code"] == "invalid_token"


async def test_reset_revokes_every_existing_session(
    make_app, make_client, register_user, mailer
) -> None:
    app = make_app()
    async with make_client(app) as victim, make_client(app) as attacker:
        await register_user(victim, email="hijack@example.com", password="password123")
        await attacker.post(
            "/api/auth/login",
            json={"email": "hijack@example.com", "password": "password123"},
        )
        assert (await attacker.get("/api/me")).status_code == 200

        await victim.post("/api/auth/password/forgot", json={"email": "hijack@example.com"})
        reset = await victim.post(
            "/api/auth/password/reset",
            json={"token": mailer.last_token(), "new_password": "recoveredpass"},
        )
        assert reset.status_code == 200

        # A reset proves nothing about the old password, so *both* sessions die.
        assert (await attacker.get("/api/me")).status_code == 401
        assert (await victim.get("/api/me")).status_code == 401


async def test_reset_rejects_unknown_expired_and_weak(
    make_app, make_client, register_user, mailer, database
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="bad@example.com")
        await client.post("/api/auth/logout")

        unknown = await client.post(
            "/api/auth/password/reset",
            json={"token": "not-a-real-token", "new_password": "goodpassword"},
        )
        assert unknown.status_code == 400
        assert unknown.json()["detail"]["code"] == "invalid_token"

        await client.post("/api/auth/password/forgot", json={"email": "bad@example.com"})
        weak = await client.post(
            "/api/auth/password/reset",
            json={"token": mailer.last_token(), "new_password": "short"},
        )
        assert weak.status_code == 400
        assert weak.json()["detail"]["code"] == "weak_password"

        # Age the stored token past its expiry and confirm it is refused.
        await database.auth_tokens._collection.update_many(
            {"purpose": AuthTokenStore.PURPOSE_PASSWORD_RESET},
            {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)}},
        )
        expired = await client.post(
            "/api/auth/password/reset",
            json={"token": mailer.last_token(), "new_password": "goodpassword"},
        )
        assert expired.status_code == 400
        assert expired.json()["detail"]["code"] == "invalid_token"


async def test_forgot_password_ignores_disabled_accounts(
    make_app, make_client, register_user, mailer, database
) -> None:
    app = make_app()
    async with make_client(app) as client:
        user = await register_user(client, email="off@example.com")
        await database.users.update(user["id"], {"disabled": True})
        mailer.sent.clear()

        response = await client.post(
            "/api/auth/password/forgot", json={"email": "off@example.com"}
        )
        assert response.status_code == 200
        assert response.json() == {"ok": True, "delivered": True}
        assert mailer.sent == []


async def test_reset_link_origin_cannot_come_from_the_host_header(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A delivering mailer with no PUBLIC_BASE_URL must refuse, not trust Host."""

    monkeypatch.delenv(BASE_URL_ENV, raising=False)
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="poison@example.com")
        await client.post("/api/auth/logout")

        response = await client.post(
            "/api/auth/password/forgot",
            json={"email": "poison@example.com"},
            headers={"Host": "evil.example"},
        )
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "mail_not_configured"


async def test_console_mailer_may_derive_the_origin_from_the_request(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The console driver logs the link, so a request-derived origin is safe."""

    from tests.conftest import RecordingMailer

    monkeypatch.delenv(BASE_URL_ENV, raising=False)
    console = RecordingMailer(delivers=False)
    app = make_app(mail=console)
    async with make_client(app) as client:
        await register_user(client, email="console@example.com")
        await client.post("/api/auth/logout")

        response = await client.post(
            "/api/auth/password/forgot", json={"email": "console@example.com"}
        )
        assert response.status_code == 200
        assert response.json() == {"ok": True, "delivered": False}
        assert console.last_link().startswith("http://testserver")


async def test_mail_delivery_failure_does_not_fail_the_request(
    make_app, make_client, register_user
) -> None:
    from tests.conftest import RecordingMailer

    app = make_app(mail=RecordingMailer(fail=True))
    async with make_client(app) as client:
        await register_user(client, email="broken@example.com")
        await client.post("/api/auth/logout")

        response = await client.post(
            "/api/auth/password/forgot", json={"email": "broken@example.com"}
        )
        assert response.status_code == 200
        assert response.json() == {"ok": True, "delivered": True}


async def test_forgot_password_is_rate_limited(
    make_app, make_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RATE_LIMIT_EMAIL_CALLS", "2")
    app = make_app()
    async with make_client(app) as client:
        for _ in range(2):
            allowed = await client.post(
                "/api/auth/password/forgot", json={"email": "flood@example.com"}
            )
            assert allowed.status_code == 200

        blocked = await client.post(
            "/api/auth/password/forgot", json={"email": "flood@example.com"}
        )
        assert blocked.status_code == 429
        assert blocked.json()["detail"]["code"] == "too_many_requests"
        assert int(blocked.headers["Retry-After"]) >= 1


# ---------------------------------------------------------------------------
# Email verification
# ---------------------------------------------------------------------------


async def test_verification_round_trip_marks_the_account_verified(
    make_app, make_client, register_user, mailer
) -> None:
    app = make_app()
    async with make_client(app) as client:
        user = await register_user(client, email="verify@example.com")
        assert user["email_verified"] is False

        asked = await client.post("/api/auth/verify/request")
        assert asked.status_code == 200, asked.text
        assert mailer.sent[-1]["to"] == "verify@example.com"

        confirmed = await client.post(
            "/api/auth/verify/confirm", json={"token": mailer.last_token()}
        )
        assert confirmed.status_code == 200, confirmed.text

        me = await client.get("/api/me")
        assert me.json()["user"]["email_verified"] is True


async def test_verification_token_is_single_use_and_confirm_needs_no_session(
    make_app, make_client, register_user, mailer
) -> None:
    app = make_app()
    async with make_client(app) as owner, make_client(app) as anonymous:
        await register_user(owner, email="link@example.com")
        await owner.post("/api/auth/verify/request")
        token = mailer.last_token()

        # Opened in a different browser with no session at all.
        first = await anonymous.post("/api/auth/verify/confirm", json={"token": token})
        assert first.status_code == 200, first.text

        replay = await anonymous.post("/api/auth/verify/confirm", json={"token": token})
        assert replay.status_code == 400
        assert replay.json()["detail"]["code"] == "invalid_token"


async def test_requesting_verification_twice_conflicts_once_verified(
    make_app, make_client, register_user, mailer
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="twice@example.com")
        await client.post("/api/auth/verify/request")
        await client.post(
            "/api/auth/verify/confirm", json={"token": mailer.last_token()}
        )

        again = await client.post("/api/auth/verify/request")
        assert again.status_code == 409
        assert again.json()["detail"]["code"] == "already_verified"


async def test_verification_gate_blocks_features_but_not_the_profile(
    make_app, make_client, register_user, mailer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("REQUIRE_EMAIL_VERIFICATION", "true")
    app = make_app()
    async with make_client(app) as client:
        await register_user(client, email="gated@example.com")

        blocked = await client.get("/api/resumes")
        assert blocked.status_code == 403
        assert blocked.json()["detail"]["code"] == "email_verification_required"

        # The routes a blocked user still needs stay reachable.
        me = await client.get("/api/me")
        assert me.status_code == 200
        assert me.json()["user"]["verification_required"] is True
        assert (await client.get("/api/sessions")).status_code == 200

        await client.post("/api/auth/verify/request")
        await client.post(
            "/api/auth/verify/confirm", json={"token": mailer.last_token()}
        )

        assert (await client.get("/api/resumes")).status_code == 200


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


async def test_session_list_marks_the_requesting_session(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as first, make_client(app) as second:
        await register_user(first, email="list@example.com", password="password123")
        await second.post(
            "/api/auth/login",
            json={"email": "list@example.com", "password": "password123"},
        )

        listed = await first.get("/api/sessions")
        assert listed.status_code == 200, listed.text
        sessions = listed.json()["sessions"]
        assert len(sessions) == 2
        assert [entry["current"] for entry in sessions].count(True) == 1


async def test_revoking_one_session_signs_that_client_out(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as keeper, make_client(app) as doomed:
        await register_user(keeper, email="revoke@example.com", password="password123")
        await doomed.post(
            "/api/auth/login",
            json={"email": "revoke@example.com", "password": "password123"},
        )

        sessions = (await keeper.get("/api/sessions")).json()["sessions"]
        other = next(entry for entry in sessions if not entry["current"])

        removed = await keeper.delete("/api/sessions/{0}".format(other["id"]))
        assert removed.status_code == 200, removed.text
        assert (await doomed.get("/api/me")).status_code == 401
        assert (await keeper.get("/api/me")).status_code == 200

        gone = await keeper.delete("/api/sessions/{0}".format(other["id"]))
        assert gone.status_code == 404
        assert gone.json()["detail"]["code"] == "session_not_found"


async def test_revoke_all_keeps_only_the_current_session(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as keeper, make_client(app) as a, make_client(app) as b:
        await register_user(keeper, email="all@example.com", password="password123")
        for client in (a, b):
            await client.post(
                "/api/auth/login",
                json={"email": "all@example.com", "password": "password123"},
            )

        response = await keeper.delete("/api/sessions")
        assert response.status_code == 200, response.text
        assert response.json()["revoked"] == 2

        assert (await keeper.get("/api/me")).status_code == 200
        assert (await a.get("/api/me")).status_code == 401
        assert (await b.get("/api/me")).status_code == 401


async def test_sessions_are_scoped_to_their_owner(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as alice, make_client(app) as mallory:
        await register_user(alice, email="alice@example.com")
        await register_user(mallory, email="mallory@example.com")

        alice_session = (await alice.get("/api/sessions")).json()["sessions"][0]
        stolen = await mallory.delete("/api/sessions/{0}".format(alice_session["id"]))

        assert stolen.status_code == 404
        assert (await alice.get("/api/me")).status_code == 200


# ---------------------------------------------------------------------------
# Disabled accounts
# ---------------------------------------------------------------------------


async def test_disabling_an_account_ejects_the_live_session(
    make_app, make_client, register_user, database
) -> None:
    app = make_app()
    async with make_client(app) as client:
        user = await register_user(client, email="banned@example.com")
        assert (await client.get("/api/me")).status_code == 200

        await database.users.update(user["id"], {"disabled": True})

        blocked = await client.get("/api/me")
        assert blocked.status_code == 403
        assert blocked.json()["detail"]["code"] == "account_disabled"
        # The session document is destroyed, not merely refused.
        assert await database.sessions.list_for_user(user["id"]) == []


async def test_disabled_login_is_refused_without_becoming_an_oracle(
    make_app, make_client, register_user, database
) -> None:
    app = make_app()
    async with make_client(app) as client:
        user = await register_user(
            client, email="closed@example.com", password="password123"
        )
        await database.users.update(user["id"], {"disabled": True})
        await client.post("/api/auth/logout")

        wrong = await client.post(
            "/api/auth/login",
            json={"email": "closed@example.com", "password": "wrong-password"},
        )
        # A wrong password looks exactly like any other bad credential.
        assert wrong.status_code == 401
        assert wrong.json()["detail"]["code"] == "invalid_credentials"

        right = await client.post(
            "/api/auth/login",
            json={"email": "closed@example.com", "password": "password123"},
        )
        assert right.status_code == 403
        assert right.json()["detail"]["code"] == "account_disabled"


# ---------------------------------------------------------------------------
# Demo mode
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("post", "/api/auth/password", {"current_password": "a", "new_password": "b"}),
        ("post", "/api/auth/password/forgot", {"email": "a@b.com"}),
        ("post", "/api/auth/password/reset", {"token": "t", "new_password": "goodpassword"}),
        ("post", "/api/auth/verify/request", None),
        ("post", "/api/auth/verify/confirm", {"token": "t"}),
        ("get", "/api/sessions", None),
        ("delete", "/api/sessions", None),
    ],
)
async def test_account_routes_return_503_in_demo_mode(
    make_app, make_client, method, path, payload
) -> None:
    app = make_app(multi_user=False)
    async with make_client(app) as client:
        call = getattr(client, method)
        response = await call(path, json=payload) if payload is not None else await call(path)

        assert response.status_code == 503, response.text
        assert response.json()["detail"]["code"] == "database_not_configured"
