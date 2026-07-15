"""Middleware hardening tests: rate limits, origin check, body-size limits."""

from __future__ import annotations

import pytest


JD_CONTENT = (
    "We are hiring a backend engineer to build reliable Python and FastAPI "
    "services, improve PostgreSQL performance, and maintain Docker delivery workflows."
)


async def test_llm_bucket_limits_tailor_calls_with_retry_after(
    make_app, make_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RATE_LIMIT_LLM_CALLS", "1")
    app = make_app(multi_user=False)
    async with make_client(app) as client:
        first = await client.post("/api/tailor", json={})
        assert first.status_code == 422  # consumed the single LLM slot

        second = await client.post("/api/tailor", json={})
        assert second.status_code == 429
        body = second.json()["detail"]
        assert body["code"] == "rate_limited"
        assert int(second.headers["retry-after"]) >= 1

        # The general bucket is independent of the LLM bucket.
        assert (await client.get("/api/providers")).status_code == 200


async def test_llm_bucket_covers_resume_import_and_run_recompile_paths(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RATE_LIMIT_LLM_CALLS", "1")
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)

        first = await client.post("/api/resumes", json={"latex": "x" * 50})
        assert first.status_code != 429

        second = await client.post("/api/runs/{0}/compile".format("a" * 32))
        assert second.status_code == 429
        assert second.json()["detail"]["code"] == "rate_limited"


async def test_general_bucket_limits_other_api_calls_but_not_health(
    make_app, make_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RATE_LIMIT_GENERAL_CALLS", "10")  # the clamped minimum
    app = make_app(multi_user=False)
    async with make_client(app) as client:
        for _ in range(10):
            assert (await client.get("/api/providers")).status_code == 200

        limited = await client.get("/api/providers")
        assert limited.status_code == 429
        assert limited.json()["detail"]["code"] == "rate_limited"
        assert "retry-after" in limited.headers

        # Health stays reachable for monitoring probes.
        assert (await client.get("/api/health")).status_code == 200


async def test_rate_limits_are_keyed_per_user(
    make_app, make_client, register_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RATE_LIMIT_LLM_CALLS", "1")
    app = make_app()
    async with make_client(app) as first_user, make_client(app) as second_user:
        await register_user(first_user, email="first@example.com")
        await register_user(second_user, email="second@example.com")

        assert (await first_user.post("/api/tailor", json={})).status_code == 422
        assert (await first_user.post("/api/tailor", json={})).status_code == 429
        # A different authenticated user has their own bucket.
        assert (await second_user.post("/api/tailor", json={})).status_code == 422


async def test_origin_check_blocks_cross_origin_cookie_requests(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)

        evil = await client.post(
            "/api/jds",
            json={"title": "Role", "content": JD_CONTENT},
            headers={"origin": "https://evil.example"},
        )
        assert evil.status_code == 403
        assert evil.json()["detail"]["code"] == "bad_origin"

        null_origin = await client.post(
            "/api/jds",
            json={"title": "Role", "content": JD_CONTENT},
            headers={"origin": "null"},
        )
        assert null_origin.status_code == 403

        same_origin = await client.post(
            "/api/jds",
            json={"title": "Role", "content": JD_CONTENT},
            headers={"origin": "http://testserver"},
        )
        assert same_origin.status_code == 201

        no_origin = await client.post(
            "/api/jds", json={"title": "Role two", "content": JD_CONTENT}
        )
        assert no_origin.status_code == 201

        # Reads are not state-changing and stay allowed.
        read = await client.get(
            "/api/jds", headers={"origin": "https://evil.example"}
        )
        assert read.status_code == 200


async def test_origin_check_ignores_bearer_only_requests(
    make_app, make_client, register_user
) -> None:
    app = make_app()
    async with make_client(app) as client:
        await register_user(client)
        token = client.cookies.get("rt_session")

    async with make_client(app) as bearer_client:
        # No ambient cookie is involved, so CSRF does not apply.
        response = await bearer_client.post(
            "/api/jds",
            json={"title": "Role", "content": JD_CONTENT},
            headers={
                "authorization": "Bearer {0}".format(token),
                "origin": "https://elsewhere.example",
            },
        )
        assert response.status_code == 201


@pytest.mark.parametrize(
    "path,declared_size",
    [
        ("/api/tailor", 64_001),
        ("/api/resumes", 260_001),
        ("/api/resumes/pdf", 12_000_000),
        ("/api/resumes/abc123/versions", 260_001),
        ("/api/resumes/abc123/versions/pdf", 12_000_000),
    ],
)
async def test_declared_body_size_limits_per_route_family(
    make_app, make_client, path: str, declared_size: int
) -> None:
    app = make_app()
    async with make_client(app) as client:
        response = await client.post(
            path,
            content=b"{}",
            headers={
                "content-type": "application/json",
                "content-length": str(declared_size),
            },
        )

        assert response.status_code == 413, path
        assert response.json()["detail"]["code"] == "request_too_large"


async def test_delete_requests_with_bodies_are_size_limited(
    make_app, make_client
) -> None:
    """DELETE /api/me parses a JSON body, so it must respect the 64KB cap."""

    app = make_app()
    async with make_client(app) as client:
        response = await client.request(
            "DELETE",
            "/api/me",
            content=b"{}",
            headers={
                "content-type": "application/json",
                "content-length": "64001",
            },
        )

        assert response.status_code == 413
        assert response.json()["detail"]["code"] == "request_too_large"


async def test_latex_import_body_under_limit_is_not_rejected_by_middleware(
    make_app, make_client, register_user
) -> None:
    app = make_app(llm=None)
    async with make_client(app) as client:
        await register_user(client)
        big_latex = "x" * 100_000  # over the 64KB default, under the import cap
        response = await client.post(
            "/api/resumes", json={"latex": big_latex, "provider": "mock"}
        )
        # Middleware lets it through; the pipeline decides from here.
        assert response.status_code != 413
