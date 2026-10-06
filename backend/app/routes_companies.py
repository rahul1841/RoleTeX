"""Job-watch setup routes: preferences and the company list.

Security rationale:
- Links are user input that the server will later fetch. They are validated
  here (``sources.normalize_link``: http(s), no credentials, standard ports,
  no job aggregators) and every fetch goes through the SSRF-safe crawler
  fetcher, which re-checks the address at connect time.
- Uploaded lists are parsed with bounded readers (``crawler.company_list``):
  a size cap before reading, a zip-size check before openpyxl, defusedxml for
  Excel XML, and the sandboxed poppler helpers for PDFs.
- Limits are enforced here, not in the UI: ``MAX_COMPANIES_PER_USER`` and the
  upload byte cap; "Refresh now" has its own per-user rate limit.
- Every store call is scoped by the authenticated user id; missing and
  non-owned companies are indistinguishable (404 ``company_not_found``).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, File, Request, UploadFile

from .auth import _api_error, require_user
from .crawler.classify import CATEGORIES, CATEGORY_IDS
from .crawler.company_list import CompanyListError, parse_file
from .crawler.match import unique_places, validate_preferences
from .crawler.sources import KIND_LABELS, LinkError, normalize_link, source_for_link
from .pdftext import PdfExtractionError
from .schemas import (
    CompanyCreateRequest,
    CompanyImportResponse,
    CompanyImportSkip,
    CompanyListResponse,
    CompanyOut,
    CompanyRefreshResponse,
    CompanyResponse,
    CompanyUpdateRequest,
    JobCategory,
    JobPrefs,
    JobPrefsResponse,
    OkResponse,
    validate_model,
)


logger = logging.getLogger(__name__)

_PDF_LIST_ERRORS = {
    "pdf_too_many_pages": "That PDF has too many pages for a company list.",
    "pdf_no_text": "That PDF has no readable text; it may be a scan. Use CSV or Excel instead.",
    "pdf_too_large": "That PDF is too large.",
    "invalid_pdf": "That file is not a PDF.",
}


def _company_not_found() -> Exception:
    return _api_error(404, "company_not_found", "No company with this id in your list.")


def _status(source: Optional[Dict[str, Any]]) -> str:
    if source is None:
        return "error"
    status = source.get("status", "ready")
    return status if status in ("checking", "ready", "unsupported", "error") else "ready"


def _company_out(row: Dict[str, Any], source: Optional[Dict[str, Any]]) -> CompanyOut:
    kind = (source or {}).get("kind", "")
    return CompanyOut(
        id=row["_id"],
        name=row.get("company_name", ""),
        link=row.get("link", ""),
        status=_status(source),
        source=KIND_LABELS.get(kind, "") if source else "",
        open_jobs=int((source or {}).get("open_jobs") or 0),
        last_crawled_at=(source or {}).get("last_crawled_at"),
        created_at=row.get("created_at"),
    )


def _prefs_response(user: Dict[str, Any]) -> JobPrefsResponse:
    stored = user.get("job_prefs")
    prefs = None
    if isinstance(stored, dict):
        try:
            prefs = validate_model(
                JobPrefs,
                {key: stored[key] for key in JobPrefs.model_fields if key in stored},
            )
        except Exception:  # an unreadable stored value reads as "not set"
            prefs = None
    return JobPrefsResponse(
        prefs=prefs,
        categories=[JobCategory(id=category, label=label) for category, label in CATEGORIES],
    )


def register_companies_routes(app: FastAPI, services: Any) -> None:
    database = services.database

    async def _add_links(
        user: Dict[str, Any], candidates: List[Tuple[int, str, str]]
    ) -> Tuple[int, int, List[Tuple[int, str]]]:
        """Validate, dedupe and store rows; returns (added, duplicates, skipped)."""

        user_id = user["_id"]
        remaining = services.config.max_companies_per_user - await database.watchlist.count_for_user(user_id)
        existing = set(await database.watchlist.keys_for_user(user_id))
        duplicates = 0
        skipped: List[Tuple[int, str]] = []
        rows: List[Dict[str, Any]] = []
        for row_number, name, raw_link in candidates:
            try:
                link = normalize_link(raw_link)
            except LinkError as exc:
                skipped.append((row_number, str(exc)))
                continue
            spec = source_for_link(link)
            if spec.key in existing:
                duplicates += 1
                continue
            if len(rows) >= remaining:
                skipped.append((row_number, "company limit reached"))
                continue
            existing.add(spec.key)
            source = await database.career_sources.get_or_create(
                spec.key, spec.kind, spec.params, spec.url, spec.label
            )
            rows.append(
                {
                    "company_name": " ".join((name or "").split())[:120] or spec.label,
                    "link": link,
                    "link_key": spec.key,
                    # A page already resolved to a board points straight at it.
                    "source_id": source.get("alias_of") or source["_id"],
                }
            )
        added = await database.watchlist.insert_many(user_id, rows)
        if rows:
            source_ids = sorted({row["source_id"] for row in rows})
            await services.crawler.after_companies_added(user_id, source_ids)
        return added, duplicates, skipped

    async def _detail(user_id: str, row: Dict[str, Any]) -> CompanyOut:
        source = await database.career_sources.get(row.get("source_id", ""))
        return _company_out(row, source)

    async def _drop_source_matches(user_id: str, source_id: str) -> None:
        if not await database.watchlist.user_watches_source(user_id, source_id):
            await database.job_matches.delete_for_user_source(user_id, source_id)

    @app.get("/api/job-prefs", response_model=JobPrefsResponse)
    async def get_job_prefs(request: Request) -> JobPrefsResponse:
        user = await require_user(request, services)
        return _prefs_response(user)

    @app.put("/api/job-prefs", response_model=JobPrefsResponse)
    async def put_job_prefs(payload: JobPrefs, request: Request) -> JobPrefsResponse:
        user = await require_user(request, services)
        locations = unique_places(payload.locations)
        problems = validate_preferences(
            payload.categories,
            payload.exp_from_years,
            payload.exp_to_years,
            payload.margin_months,
            locations,
        )
        if problems:
            raise _api_error(
                422, "invalid_job_prefs", "Some job preferences need attention.", errors=problems
            )
        chosen = set(payload.categories)
        stored = {
            "categories": [category for category in CATEGORY_IDS if category in chosen],
            "exp_from_years": round(payload.exp_from_years * 2) / 2.0,
            "exp_to_years": round(payload.exp_to_years * 2) / 2.0,
            "margin_months": payload.margin_months,
            "locations": locations,
            "include_remote": payload.include_remote,
        }
        await database.users.update(user["_id"], {"job_prefs": stored})
        await services.crawler.recompute_user(user["_id"])
        return _prefs_response({**user, "job_prefs": stored})

    @app.get("/api/companies", response_model=CompanyListResponse)
    async def list_companies(request: Request) -> CompanyListResponse:
        user = await require_user(request, services)
        rows = await database.watchlist.list_for_user(user["_id"])
        sources = await database.career_sources.get_many(
            sorted({row.get("source_id", "") for row in rows})
        )
        companies = [_company_out(row, sources.get(row.get("source_id", ""))) for row in rows]
        companies.sort(key=lambda company: company.name.lower())
        return CompanyListResponse(companies=companies)

    @app.post("/api/companies", response_model=CompanyResponse, status_code=201)
    async def create_company(payload: CompanyCreateRequest, request: Request) -> CompanyResponse:
        user = await require_user(request, services)
        try:
            link = normalize_link(payload.link)
        except LinkError as exc:
            raise _api_error(422, "invalid_link", "That link can't be used: {0}.".format(exc)) from exc
        key = source_for_link(link).key
        if key in set(await database.watchlist.keys_for_user(user["_id"])):
            raise _api_error(409, "company_exists", "That careers link is already in your list.")
        if await database.watchlist.count_for_user(user["_id"]) >= services.config.max_companies_per_user:
            raise _api_error(
                409,
                "company_quota_exceeded",
                "You already follow {0} companies; remove one to add another.".format(
                    services.config.max_companies_per_user
                ),
            )
        added, _duplicates, skipped = await _add_links(user, [(1, payload.name or "", link)])
        if not added:
            raise _api_error(409, "company_exists", "That careers link is already in your list.")
        rows = await database.watchlist.list_for_user(user["_id"])
        row = next((item for item in rows if item.get("link_key") == key), None)
        if row is None:  # pragma: no cover - just inserted
            raise _company_not_found()
        return CompanyResponse(company=await _detail(user["_id"], row))

    @app.post("/api/companies/import", response_model=CompanyImportResponse)
    async def import_companies(request: Request, file: UploadFile = File(...)) -> CompanyImportResponse:
        user = await require_user(request, services)
        cap = services.config.max_company_import_bytes
        data = await file.read(cap + 1)
        if len(data) > cap:
            raise _api_error(
                413,
                "file_too_large",
                "The file is larger than {0} KB.".format(cap // 1_000),
            )
        if not data.strip():
            raise _api_error(422, "invalid_company_file", "The file is empty.")
        loop = asyncio.get_running_loop()
        try:
            parsed = await loop.run_in_executor(
                None, parse_file, file.filename or "", data, services.company_pdf_reader
            )
        except CompanyListError as exc:
            raise _api_error(422, "invalid_company_file", str(exc)) from exc
        except PdfExtractionError as exc:
            message = _PDF_LIST_ERRORS.get(exc.code, "That PDF could not be read.")
            raise _api_error(422, "invalid_company_file", message) from exc
        if not parsed.rows and not parsed.skipped:
            raise _api_error(
                422,
                "invalid_company_file",
                "No careers links were found in that file.",
            )
        added, duplicates, skipped = await _add_links(
            user, [(row.row, row.name, row.link) for row in parsed.rows]
        )
        all_skipped = sorted(parsed.skipped + skipped, key=lambda item: item[0])
        return CompanyImportResponse(
            added=added,
            duplicates=duplicates,
            skipped=[CompanyImportSkip(row=row, reason=reason) for row, reason in all_skipped[:200]],
        )

    @app.patch("/api/companies/{company_id}", response_model=CompanyResponse)
    async def update_company(
        company_id: str, payload: CompanyUpdateRequest, request: Request
    ) -> CompanyResponse:
        user = await require_user(request, services)
        user_id = user["_id"]
        row = await database.watchlist.get(user_id, company_id)
        if row is None:
            raise _company_not_found()
        if payload.name is None and payload.link is None:
            raise _api_error(422, "nothing_to_update", "Provide a new name and/or link.")
        updates: Dict[str, Any] = {}
        if payload.name is not None:
            name = " ".join(payload.name.split())
            if not name:
                raise _api_error(422, "invalid_name", "The company name can't be empty.")
            updates["company_name"] = name
        new_source_id = None
        if payload.link is not None:
            try:
                link = normalize_link(payload.link)
            except LinkError as exc:
                raise _api_error(422, "invalid_link", "That link can't be used: {0}.".format(exc)) from exc
            spec = source_for_link(link)
            if spec.key != row.get("link_key"):
                if spec.key in set(await database.watchlist.keys_for_user(user_id)):
                    raise _api_error(409, "company_exists", "That careers link is already in your list.")
                source = await database.career_sources.get_or_create(
                    spec.key, spec.kind, spec.params, spec.url, spec.label
                )
                new_source_id = source.get("alias_of") or source["_id"]
                updates.update({"link_key": spec.key, "source_id": new_source_id})
            updates["link"] = link
        updated = await database.watchlist.update(user_id, company_id, updates)
        if updated is None:
            raise _company_not_found()
        old_source_id = row.get("source_id", "")
        if new_source_id is not None and new_source_id != old_source_id:
            await _drop_source_matches(user_id, old_source_id)
            await services.crawler.after_companies_added(user_id, [new_source_id])
        elif "company_name" in updates:
            await database.job_matches.rename_company(user_id, old_source_id, updates["company_name"])
        return CompanyResponse(company=await _detail(user_id, updated))

    @app.delete("/api/companies/{company_id}", response_model=OkResponse)
    async def delete_company(company_id: str, request: Request) -> OkResponse:
        user = await require_user(request, services)
        row = await database.watchlist.delete(user["_id"], company_id)
        if row is None:
            raise _company_not_found()
        await _drop_source_matches(user["_id"], row.get("source_id", ""))
        return OkResponse()

    @app.post("/api/companies/refresh", response_model=CompanyRefreshResponse)
    async def refresh_companies(request: Request) -> CompanyRefreshResponse:
        user = await require_user(request, services)
        retry_after = services.refresh_limiter.check("refresh:" + user["_id"])
        if retry_after is not None:
            minutes = max(1, int(retry_after // 60) + 1)
            raise _api_error(
                429,
                "refresh_too_soon",
                "A refresh is already recent; try again in {0} minute{1}.".format(
                    minutes, "" if minutes == 1 else "s"
                ),
                headers={"Retry-After": str(int(retry_after) + 1)},
            )
        queued = await services.crawler.refresh_user(user["_id"])
        return CompanyRefreshResponse(queued=queued)
