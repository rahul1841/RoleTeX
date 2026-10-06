"""Matched jobs: the list, one job, its state, and "save as JD".

Security rationale:
- Job text comes from third-party postings and is untrusted. It is stored as
  plain text only (``crawler.text``), returned as JSON strings, and rendered
  by the UI as text; a posting URL is only ever http(s).
- Saving a posting as a JD stores it like any pasted job description, so it
  reaches a model only through the tailoring prompt, framed as reference data
  (rule R-7).
- Every lookup is scoped by the authenticated user id; missing and non-owned
  matches are indistinguishable (404 ``job_not_found``).
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import FastAPI, Request

from .auth import _api_error, require_user
from .crawler.match import LABEL_RANK, describe_experience
from .crawler.text import MAX_DESCRIPTION_CHARACTERS
from .schemas import (
    JobMatchDetail,
    JobMatchListResponse,
    JobMatchOut,
    JobMatchResponse,
    JobMatchUpdateRequest,
    JobSaveJdResponse,
)


_STATE_FILTERS = {
    "new": ["new"],
    "saved": ["saved"],
    "all": ["new", "seen", "saved"],
}
MIN_JD_CHARACTERS = 50
MAX_JD_TITLE_CHARACTERS = 160


def _job_not_found() -> Exception:
    return _api_error(404, "job_not_found", "No matched job with this id.")


def _fields(match: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": match["_id"],
        "company": match.get("company_name", ""),
        "title": job.get("title", ""),
        "location": job.get("location", ""),
        "remote": job.get("remote"),
        "url": job.get("url", ""),
        "label": match.get("label", "unstated"),
        "experience": describe_experience(job.get("exp_min_months"), job.get("exp_max_months")),
        "experience_basis": job.get("exp_basis", "none"),
        "categories": list(job.get("categories") or []),
        "posted_at": job.get("posted_at"),
        "first_seen_at": job.get("first_seen_at"),
        "state": match.get("state", "new"),
        "closed": job.get("closed_at") is not None,
    }


def register_jobs_routes(app: FastAPI, services: Any) -> None:
    database = services.database

    async def _owned(user_id: str, match_id: str) -> Dict[str, Any]:
        match = await database.job_matches.get(user_id, match_id)
        if match is None:
            raise _job_not_found()
        return match

    @app.get("/api/jobs", response_model=JobMatchListResponse)
    async def list_jobs(request: Request, state: str = "new") -> JobMatchListResponse:
        user = await require_user(request, services)
        states = _STATE_FILTERS.get(state)
        if states is None:
            raise _api_error(422, "invalid_state", "state must be new, saved or all.")
        matches = await database.job_matches.list_for_user(user["_id"], states)
        jobs = await database.jobs.get_many([match["job_id"] for match in matches])
        rows: List[JobMatchOut] = []
        for match in matches:
            job = jobs.get(match["job_id"])
            if job is None:
                continue
            # A closed posting stays visible only where the user saved it.
            if job.get("closed_at") is not None and match.get("state") != "saved":
                continue
            rows.append(JobMatchOut(**_fields(match, job)))
        rows.sort(key=lambda row: LABEL_RANK.get(row.label, 9))
        return JobMatchListResponse(jobs=rows)

    @app.get("/api/jobs/{match_id}", response_model=JobMatchResponse)
    async def get_job(match_id: str, request: Request) -> JobMatchResponse:
        user = await require_user(request, services)
        match = await _owned(user["_id"], match_id)
        job = await database.jobs.get(match["job_id"])
        if job is None:
            raise _job_not_found()
        return JobMatchResponse(
            job=JobMatchDetail(description=job.get("description", ""), **_fields(match, job))
        )

    @app.patch("/api/jobs/{match_id}", response_model=JobMatchResponse)
    async def update_job(
        match_id: str, payload: JobMatchUpdateRequest, request: Request
    ) -> JobMatchResponse:
        user = await require_user(request, services)
        match = await database.job_matches.set_state(user["_id"], match_id, payload.state)
        if match is None:
            raise _job_not_found()
        job = await database.jobs.get(match["job_id"])
        if job is None:
            raise _job_not_found()
        return JobMatchResponse(
            job=JobMatchDetail(description=job.get("description", ""), **_fields(match, job))
        )

    @app.post("/api/jobs/{match_id}/jd", response_model=JobSaveJdResponse, status_code=201)
    async def save_job_as_jd(match_id: str, request: Request) -> JobSaveJdResponse:
        user = await require_user(request, services)
        match = await _owned(user["_id"], match_id)
        job = await database.jobs.get(match["job_id"])
        if job is None:
            raise _job_not_found()
        count = await database.jds.count_for_user(user["_id"])
        if count >= services.config.max_jds_per_user:
            raise _api_error(
                409,
                "jd_quota_exceeded",
                "You already have {0} saved job descriptions.".format(count),
            )
        company = match.get("company_name", "")
        title = job.get("title", "")
        header = "\n".join(
            line
            for line in (
                title,
                " · ".join(part for part in (company, job.get("location", "")) if part),
                job.get("url", ""),
            )
            if line
        )
        content = (header + "\n\n" + (job.get("description") or "")).strip()[:MAX_DESCRIPTION_CHARACTERS]
        if len(content) < MIN_JD_CHARACTERS:
            raise _api_error(
                422,
                "job_description_too_short",
                "This posting has too little text to save as a job description.",
            )
        jd_title = (" — ".join(part for part in (company, title) if part) or "Job")[:MAX_JD_TITLE_CHARACTERS]
        doc = await database.jds.create(user["_id"], jd_title, content)
        return JobSaveJdResponse(jd_id=doc["_id"])
