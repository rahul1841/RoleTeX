"""Per-user resume library routes: import (LaTeX paste or PDF upload), versions.

Security rationale:
- Import is the one sanctioned flow where a user's full document (identity
  included) is sent to an LLM — it is the user's own resume (rule R-2). The
  extraction result is normalized by the importer trust boundary (server IDs,
  clamped style) and re-rendered into the locked template before anything is
  stored, so raw model output can never reach the compiler (rules R-3/R-5).
- Uploaded PDFs are never parsed in-process: magic/size checks happen here and
  text extraction runs through the injected ``pdf_extractor`` (a sandboxed
  ``pdftotext`` subprocess in production).
- Every store call is scoped by the authenticated user id; missing and
  non-owned resumes are indistinguishable (404 ``resume_not_found``).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, File, Form, Request, UploadFile
from pydantic import ValidationError

from .auth import _api_error, require_user, resolve_llm_selection
from .importer import assemble_template, build_resume_data, sanitize_style
from .llm import (
    LLMConfigurationError,
    LLMExtractResult,
    LLMProviderError,
    LLMResponseError,
)
from .pdftext import PdfExtractionError
from .resume import (
    ProposalValidationError,
    ResumeError,
    flattened_skills,
    render_template_text,
)
from .schemas import (
    OkResponse,
    ResumeCreateRequest,
    ResumeCreateResponse,
    ResumeData,
    ResumeDetail,
    ResumeListResponse,
    ResumeRenameRequest,
    ResumeResponse,
    ResumeSummary,
    ResumeVersionSourceResponse,
    ResumeVersionSummary,
    ResumeVersionsResponse,
    TailorProposal,
    dump_model,
    validate_model,
)


IMPORT_REVIEW_WARNING = (
    "Review the imported fields; the AI extraction may have missed or "
    "misread details from your document."
)

_PDF_ERROR_STATUS = {
    "invalid_pdf": (422, "invalid_pdf"),
    "pdf_too_large": (413, "pdf_too_large"),
    "pdf_no_text": (422, "pdf_no_text"),
    "pdftotext_missing": (503, "pdf_support_unavailable"),
    "pdf_extract_timeout": (504, "pdf_extract_timeout"),
    "pdf_extract_failed": (422, "pdf_extract_failed"),
}


def _resume_not_found() -> Exception:
    return _api_error(404, "resume_not_found", "No resume with this id in your library.")


def _validation_issue(exc: Exception) -> str:
    if isinstance(exc, ProposalValidationError):
        return "; ".join(exc.errors)[:4_000]
    return str(exc)[:4_000]


def _resume_summary(doc: Dict[str, Any]) -> ResumeSummary:
    return ResumeSummary(
        id=doc["_id"],
        name=doc.get("name", ""),
        source_type=doc.get("source_type", ""),
        version=int(doc.get("current_version", 1)),
        provider=doc.get("provider", "") or "",
        model=doc.get("model", "") or "",
        created_at=doc.get("created_at"),
        updated_at=doc.get("updated_at"),
    )


def _default_resume_name(resume: ResumeData) -> str:
    today = datetime.now(timezone.utc).date().isoformat()
    return "{0} — {1}".format(resume.identity.name, today)[:120]


def register_resumes_routes(app: FastAPI, services: Any) -> None:
    async def _resume_detail(
        user_id: str, doc: Dict[str, Any]
    ) -> ResumeDetail:
        version = await services.database.resumes.get_version(
            user_id, doc["_id"], int(doc.get("current_version", 1))
        )
        if version is None:
            raise _api_error(
                500, "resume_configuration_error", "The stored resume is incomplete."
            )
        try:
            data = validate_model(ResumeData, version.get("data"))
        except ValidationError as exc:
            raise _api_error(
                500, "resume_configuration_error", "The stored resume is invalid."
            ) from exc
        summary = _resume_summary(doc)
        return ResumeDetail(
            style=sanitize_style(doc.get("style")),
            data=data,
            **dump_model(summary),
        )

    async def _extract_validated_import(
        user: Dict[str, Any],
        source_text: str,
        source_kind: str,
        requested_provider: Optional[str],
        requested_model: Optional[str],
    ) -> Tuple[ResumeData, Any, str, LLMExtractResult, List[str]]:
        """Shared import pipeline: LLM extraction -> importer -> render check."""

        provider, model, api_key, warnings = await resolve_llm_selection(
            services, user, requested_provider, requested_model
        )
        llm_kwargs: Dict[str, Any] = {"provider": provider, "model": model}
        if api_key:
            llm_kwargs["api_key"] = api_key
        if source_kind != "latex":
            llm_kwargs["source_kind"] = source_kind
        try:
            extraction = await services.llm.extract_resume(source_text, **llm_kwargs)
        except LLMConfigurationError as exc:
            raise _api_error(503, "llm_not_configured", str(exc)) from exc
        except LLMProviderError as exc:
            status_code = 429 if exc.status_code == 429 else 502
            raise _api_error(status_code, "llm_provider_error", str(exc)) from exc
        except LLMResponseError as exc:
            raise _api_error(
                422,
                "invalid_extraction",
                "The AI could not extract a structured resume from that document.",
            ) from exc

        try:
            resume = build_resume_data(extraction.resume)
            style = sanitize_style(extraction.style)
            template = assemble_template(style)
            # Confirm the extraction actually renders into the locked template
            # before anything is stored.
            baseline = TailorProposal(
                summary=resume.summary,
                bullet_rewrites=[],
                skills_order=flattened_skills(resume),
            )
            render_template_text(template, resume, baseline, sectioned=True)
        except (ResumeError, ProposalValidationError, ValidationError) as exc:
            raise _api_error(
                422,
                "invalid_extraction",
                "The extracted resume did not satisfy the resume safety contract. "
                "The document may be missing required fields (name, email, phone, location).",
                errors=(
                    exc.errors
                    if isinstance(exc, ProposalValidationError)
                    else [_validation_issue(exc)]
                ),
            ) from exc

        warnings = warnings + [IMPORT_REVIEW_WARNING]
        return resume, style, template, extraction, warnings

    async def _read_pdf_upload(file: UploadFile) -> str:
        data = await file.read()
        if len(data) > services.config.max_pdf_upload_bytes:
            raise _api_error(
                413,
                "pdf_too_large",
                "The uploaded PDF exceeds the {0} MB limit.".format(
                    services.config.max_pdf_upload_bytes // 1_000_000
                ),
            )
        if data[:5] != b"%PDF-":
            raise _api_error(
                422, "invalid_pdf", "The uploaded file is not a PDF document."
            )
        loop = asyncio.get_running_loop()
        try:
            return await loop.run_in_executor(None, services.pdf_extractor, data)
        except PdfExtractionError as exc:
            status_code, code = _PDF_ERROR_STATUS.get(
                exc.code, (422, "pdf_extract_failed")
            )
            raise _api_error(status_code, code, str(exc)) from exc

    async def _create_resume(
        user: Dict[str, Any],
        source_text: str,
        source_kind: str,
        name: Optional[str],
        provider: Optional[str],
        model: Optional[str],
    ) -> ResumeCreateResponse:
        count = await services.database.resumes.count_for_user(user["_id"])
        if count >= services.config.max_resumes_per_user:
            raise _api_error(
                409,
                "resume_quota_exceeded",
                "You already have {0} resumes; delete one to import another.".format(count),
            )
        resume, style, template, extraction, warnings = await _extract_validated_import(
            user, source_text, source_kind, provider, model
        )
        source_type = "pdf" if source_kind == "text" else "latex"
        doc = await services.database.resumes.create(
            user["_id"],
            (name or "").strip() or _default_resume_name(resume),
            source_type,
            dump_model(resume),
            template,
            source_text,
            dump_model(style),
            extraction.provider,
            extraction.model,
        )
        return ResumeCreateResponse(
            resume=await _resume_detail(user["_id"], doc), warnings=warnings
        )

    async def _add_resume_version(
        user: Dict[str, Any],
        resume_id: str,
        source_text: str,
        source_kind: str,
        provider: Optional[str],
        model: Optional[str],
    ) -> ResumeCreateResponse:
        existing = await services.database.resumes.get(user["_id"], resume_id)
        if existing is None:
            raise _resume_not_found()
        if int(existing.get("current_version", 1)) >= services.config.max_versions_per_resume:
            raise _api_error(
                409,
                "version_quota_exceeded",
                "This resume already has {0} versions.".format(
                    existing.get("current_version")
                ),
            )
        resume, style, template, extraction, warnings = await _extract_validated_import(
            user, source_text, source_kind, provider, model
        )
        source_type = "pdf" if source_kind == "text" else "latex"
        doc = await services.database.resumes.add_version(
            user["_id"],
            resume_id,
            source_type,
            dump_model(resume),
            template,
            source_text,
            dump_model(style),
            extraction.provider,
            extraction.model,
        )
        if doc is None:
            raise _resume_not_found()
        return ResumeCreateResponse(
            resume=await _resume_detail(user["_id"], doc), warnings=warnings
        )

    @app.get("/api/resumes", response_model=ResumeListResponse)
    async def list_resumes(request: Request) -> ResumeListResponse:
        user = await require_user(request, services)
        docs = await services.database.resumes.list_for_user(user["_id"])
        return ResumeListResponse(resumes=[_resume_summary(doc) for doc in docs])

    @app.post(
        "/api/resumes", response_model=ResumeCreateResponse, status_code=201
    )
    async def create_resume(
        payload: ResumeCreateRequest, request: Request
    ) -> ResumeCreateResponse:
        user = await require_user(request, services)
        return await _create_resume(
            user, payload.latex, "latex", payload.name, payload.provider, payload.model
        )

    @app.post(
        "/api/resumes/pdf", response_model=ResumeCreateResponse, status_code=201
    )
    async def create_resume_from_pdf(
        request: Request,
        file: UploadFile = File(...),
        name: Optional[str] = Form(default=None),
        provider: Optional[str] = Form(default=None),
        model: Optional[str] = Form(default=None),
    ) -> ResumeCreateResponse:
        user = await require_user(request, services)
        text = await _read_pdf_upload(file)
        return await _create_resume(user, text, "text", name, provider, model)

    @app.get("/api/resumes/{resume_id}", response_model=ResumeResponse)
    async def get_resume(resume_id: str, request: Request) -> ResumeResponse:
        user = await require_user(request, services)
        doc = await services.database.resumes.get(user["_id"], resume_id)
        if doc is None:
            raise _resume_not_found()
        return ResumeResponse(resume=await _resume_detail(user["_id"], doc))

    @app.patch("/api/resumes/{resume_id}", response_model=ResumeResponse)
    async def rename_resume(
        resume_id: str, payload: ResumeRenameRequest, request: Request
    ) -> ResumeResponse:
        user = await require_user(request, services)
        renamed = await services.database.resumes.rename(
            user["_id"], resume_id, payload.name.strip()
        )
        if not renamed:
            raise _resume_not_found()
        doc = await services.database.resumes.get(user["_id"], resume_id)
        if doc is None:
            raise _resume_not_found()
        return ResumeResponse(resume=await _resume_detail(user["_id"], doc))

    @app.delete("/api/resumes/{resume_id}", response_model=OkResponse)
    async def delete_resume(resume_id: str, request: Request) -> OkResponse:
        user = await require_user(request, services)
        deleted = await services.database.resumes.delete(user["_id"], resume_id)
        if not deleted:
            raise _resume_not_found()
        return OkResponse()

    @app.post(
        "/api/resumes/{resume_id}/versions",
        response_model=ResumeCreateResponse,
        status_code=201,
    )
    async def add_version(
        resume_id: str, payload: ResumeCreateRequest, request: Request
    ) -> ResumeCreateResponse:
        user = await require_user(request, services)
        return await _add_resume_version(
            user, resume_id, payload.latex, "latex", payload.provider, payload.model
        )

    @app.post(
        "/api/resumes/{resume_id}/versions/pdf",
        response_model=ResumeCreateResponse,
        status_code=201,
    )
    async def add_version_from_pdf(
        resume_id: str,
        request: Request,
        file: UploadFile = File(...),
        provider: Optional[str] = Form(default=None),
        model: Optional[str] = Form(default=None),
    ) -> ResumeCreateResponse:
        user = await require_user(request, services)
        text = await _read_pdf_upload(file)
        return await _add_resume_version(user, resume_id, text, "text", provider, model)

    @app.get(
        "/api/resumes/{resume_id}/versions", response_model=ResumeVersionsResponse
    )
    async def list_versions(resume_id: str, request: Request) -> ResumeVersionsResponse:
        user = await require_user(request, services)
        doc = await services.database.resumes.get(user["_id"], resume_id)
        if doc is None:
            raise _resume_not_found()
        versions = await services.database.resumes.list_versions(user["_id"], resume_id)
        return ResumeVersionsResponse(
            versions=[
                ResumeVersionSummary(
                    version=int(item.get("version", 0)),
                    source_type=item.get("source_type", ""),
                    provider=item.get("provider", "") or "",
                    model=item.get("model", "") or "",
                    created_at=item.get("created_at"),
                )
                for item in versions
            ]
        )

    @app.get(
        "/api/resumes/{resume_id}/versions/{version}/source",
        response_model=ResumeVersionSourceResponse,
    )
    async def get_version_source(
        resume_id: str, version: int, request: Request
    ) -> ResumeVersionSourceResponse:
        user = await require_user(request, services)
        doc = await services.database.resumes.get_version(
            user["_id"], resume_id, version
        )
        if doc is None:
            raise _resume_not_found()
        return ResumeVersionSourceResponse(
            version=int(doc.get("version", version)),
            source_type=doc.get("source_type", ""),
            source_text=doc.get("source_text", "") or "",
            template_tex=doc.get("template_tex", "") or "",
        )
