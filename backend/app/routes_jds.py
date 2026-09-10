"""Per-user job-description library routes with archive-on-update versioning.

Security rationale:
- JD content is untrusted data (rule R-7); it is stored verbatim but only ever
  re-enters the system through the tailoring prompt, which frames it as
  reference data. Nothing here is rendered into LaTeX or executed.
- All store calls are scoped by the authenticated user id; missing and
  non-owned JDs are indistinguishable (404 ``jd_not_found``).
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import FastAPI, Request

from .auth import _api_error, require_user
from .schemas import (
    JdCreateRequest,
    JdDetail,
    JdListResponse,
    JdResponse,
    JdSummary,
    JdUpdateRequest,
    JdVersionSummary,
    JdVersionsResponse,
    OkResponse,
)


EXCERPT_LENGTH = 160


def _excerpt(content: str) -> str:
    return " ".join((content or "").split())[:EXCERPT_LENGTH]


def _jd_not_found() -> Exception:
    return _api_error(404, "jd_not_found", "No job description with this id in your library.")


def _jd_summary(doc: Dict[str, Any]) -> JdSummary:
    return JdSummary(
        id=doc["_id"],
        title=doc.get("title", ""),
        version=int(doc.get("version", 1)),
        excerpt=_excerpt(doc.get("content", "")),
        created_at=doc.get("created_at"),
        updated_at=doc.get("updated_at"),
    )


def _jd_detail(doc: Dict[str, Any]) -> JdDetail:
    return JdDetail(
        id=doc["_id"],
        title=doc.get("title", ""),
        content=doc.get("content", ""),
        version=int(doc.get("version", 1)),
        created_at=doc.get("created_at"),
        updated_at=doc.get("updated_at"),
    )


def register_jds_routes(app: FastAPI, services: Any) -> None:
    @app.get("/api/jds", response_model=JdListResponse)
    async def list_jds(request: Request) -> JdListResponse:
        user = await require_user(request, services)
        docs = await services.database.jds.list_for_user(user["_id"])
        return JdListResponse(jds=[_jd_summary(doc) for doc in docs])

    @app.post("/api/jds", response_model=JdResponse, status_code=201)
    async def create_jd(payload: JdCreateRequest, request: Request) -> JdResponse:
        user = await require_user(request, services)
        count = await services.database.jds.count_for_user(user["_id"])
        if count >= services.config.max_jds_per_user:
            raise _api_error(
                409,
                "jd_quota_exceeded",
                "You already have {0} saved job descriptions.".format(count),
            )
        doc = await services.database.jds.create(
            user["_id"], payload.title.strip(), payload.content
        )
        return JdResponse(jd=_jd_detail(doc))

    @app.get("/api/jds/{jd_id}", response_model=JdResponse)
    async def get_jd(jd_id: str, request: Request) -> JdResponse:
        user = await require_user(request, services)
        doc = await services.database.jds.get(user["_id"], jd_id)
        if doc is None:
            raise _jd_not_found()
        return JdResponse(jd=_jd_detail(doc))

    @app.put("/api/jds/{jd_id}", response_model=JdResponse)
    async def update_jd(
        jd_id: str, payload: JdUpdateRequest, request: Request
    ) -> JdResponse:
        user = await require_user(request, services)
        if payload.title is None and payload.content is None:
            raise _api_error(
                422,
                "nothing_to_update",
                "Provide a new title and/or content to update this job description.",
            )
        doc = await services.database.jds.update(
            user["_id"],
            jd_id,
            payload.title.strip() if payload.title is not None else None,
            payload.content,
            max_versions=services.config.max_versions_per_jd,
        )
        if doc is None:
            raise _jd_not_found()
        return JdResponse(jd=_jd_detail(doc))

    @app.get("/api/jds/{jd_id}/versions", response_model=JdVersionsResponse)
    async def list_jd_versions(jd_id: str, request: Request) -> JdVersionsResponse:
        user = await require_user(request, services)
        doc = await services.database.jds.get(user["_id"], jd_id)
        if doc is None:
            raise _jd_not_found()
        versions = await services.database.jds.list_versions(user["_id"], jd_id)
        return JdVersionsResponse(
            versions=[
                JdVersionSummary(
                    version=int(item.get("version", 0)),
                    title=item.get("title", ""),
                    excerpt=_excerpt(item.get("content", "")),
                    created_at=item.get("created_at"),
                )
                for item in versions
            ]
        )

    @app.delete("/api/jds/{jd_id}", response_model=OkResponse)
    async def delete_jd(jd_id: str, request: Request) -> OkResponse:
        user = await require_user(request, services)
        deleted = await services.database.jds.delete(user["_id"], jd_id)
        if not deleted:
            raise _jd_not_found()
        return OkResponse()
