"""JD library API tests: CRUD, evolve-with-history, ownership, quotas."""

from __future__ import annotations

import pytest


JD_CONTENT = (
    "We are hiring a backend engineer to build reliable Python and FastAPI "
    "services, improve PostgreSQL performance, and maintain Docker delivery workflows."
)


async def _create_jd(client, title: str = "Backend Engineer", content: str = JD_CONTENT):
    response = await client.post("/api/jds", json={"title": title, "content": content})
    assert response.status_code == 201, response.text
    return response.json()["jd"]


async def test_jds_require_auth_and_database(make_app, make_client) -> None:
    multi = make_app()
    async with make_client(multi) as client:
        assert (await client.get("/api/jds")).status_code == 401

    demo = make_app(multi_user=False)
    async with make_client(demo) as client:
        response = await client.get("/api/jds")
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "database_not_configured"


async def test_create_list_and_get_jd(make_app, make_client, register_user) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        jd = await _create_jd(client)

        assert jd["title"] == "Backend Engineer"
        assert jd["version"] == 1
        assert jd["content"] == JD_CONTENT

        listing = await client.get("/api/jds")
        assert listing.status_code == 200
        summaries = listing.json()["jds"]
        assert len(summaries) == 1
        assert summaries[0]["id"] == jd["id"]
        assert summaries[0]["excerpt"] == JD_CONTENT[:160]
        assert "content" not in summaries[0]

        fetched = await client.get("/api/jds/{0}".format(jd["id"]))
        assert fetched.status_code == 200
        assert fetched.json()["jd"]["content"] == JD_CONTENT


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "", "content": JD_CONTENT},
        {"title": "Role", "content": "too short"},
        {"title": "Role", "content": JD_CONTENT, "unexpected": True},
        {"title": "x" * 161, "content": JD_CONTENT},
    ],
)
async def test_create_jd_validates_payload(
    make_app, make_client, register_user, payload
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        response = await client.post("/api/jds", json=payload)
        assert response.status_code == 422


async def test_update_jd_bumps_version_and_archives_history(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        jd = await _create_jd(client)

        updated = await client.put(
            "/api/jds/{0}".format(jd["id"]),
            json={"content": JD_CONTENT + " Kubernetes experience is a plus."},
        )
        assert updated.status_code == 200
        body = updated.json()["jd"]
        assert body["version"] == 2
        assert "Kubernetes" in body["content"]
        assert body["title"] == "Backend Engineer"

        versions = await client.get("/api/jds/{0}/versions".format(jd["id"]))
        assert versions.status_code == 200
        listed = versions.json()["versions"]
        assert len(listed) == 1
        assert listed[0]["version"] == 1
        assert listed[0]["excerpt"] == JD_CONTENT[:160]

        empty = await client.put("/api/jds/{0}".format(jd["id"]), json={})
        assert empty.status_code == 422
        assert empty.json()["detail"]["code"] == "nothing_to_update"


async def test_jd_version_history_is_capped(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MAX_VERSIONS_PER_JD", "2")
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        jd = await _create_jd(client)

        for index in range(5):
            updated = await client.put(
                "/api/jds/{0}".format(jd["id"]),
                json={"content": JD_CONTENT + " Revision {0}.".format(index)},
            )
            assert updated.status_code == 200

        versions = await client.get("/api/jds/{0}/versions".format(jd["id"]))
        assert versions.status_code == 200
        listed = versions.json()["versions"]
        # Archived history is pruned to the cap; the newest survive.
        assert [item["version"] for item in listed] == [5, 4]


async def test_jds_are_isolated_between_users(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as owner, make_client(app) as intruder:
        await register_user(owner, email="owner@example.com")
        await register_user(intruder, email="intruder@example.com")
        jd = await _create_jd(owner)

        assert (await intruder.get("/api/jds")).json()["jds"] == []
        for method, path, body in [
            ("GET", "/api/jds/{0}".format(jd["id"]), None),
            ("PUT", "/api/jds/{0}".format(jd["id"]), {"title": "stolen"}),
            ("GET", "/api/jds/{0}/versions".format(jd["id"]), None),
            ("DELETE", "/api/jds/{0}".format(jd["id"]), None),
        ]:
            response = await intruder.request(method, path, json=body)
            assert response.status_code == 404, path
            assert response.json()["detail"]["code"] == "jd_not_found"


async def test_delete_jd(make_app, make_client, register_user) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        jd = await _create_jd(client)

        deleted = await client.delete("/api/jds/{0}".format(jd["id"]))
        assert deleted.status_code == 200
        assert deleted.json() == {"ok": True}
        assert (await client.get("/api/jds/{0}".format(jd["id"]))).status_code == 404


async def test_jd_quota_is_enforced(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MAX_JDS_PER_USER", "1")
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        await _create_jd(client)

        blocked = await client.post(
            "/api/jds", json={"title": "Another", "content": JD_CONTENT}
        )
        assert blocked.status_code == 409
        assert blocked.json()["detail"]["code"] == "jd_quota_exceeded"
