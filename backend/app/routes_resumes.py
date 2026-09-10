"""Per-user resume library routes: import, manual authoring, versions, preview.

Security rationale:
- Import is the one sanctioned flow where a user's full document (identity
  included) is sent to an LLM — it is the user's own resume (rule R-2). The
  extraction result is normalized by the importer trust boundary (server IDs,
  clamped style) and re-rendered into the locked template before anything is
  stored, so raw model output can never reach the compiler (rules R-3/R-5).
- Uploaded PDFs are never parsed in-process: magic/size checks happen here and
  extraction runs through the injected ``pdf_extractor`` (a sandboxed
  ``pdftotext`` subprocess in production, page-gated by ``pdfinfo``). A scan
  with no text layer falls back to ``pdf_renderer`` (``pdftoppm``) and a
  multimodal model; the rendered pages are the LLM payload, and the resume is
  stored as ``pdf_scanned`` with a warning that the facts were read from
  pixels.
- Manually authored resumes (``/api/resumes/manual``, ``PUT .../content``)
  reach the same storage through ``backend/app/builder.py``, which is the import
  boundary's twin for a human author: the server still assigns every stable ID
  and still assembles the template, so no LLM and no provider key is involved
  in owning a resume here.
- Every store call is scoped by the authenticated user id; missing and
  non-owned resumes are indistinguishable (404 ``resume_not_found``).
"""

from __future__ import annotations

import asyncio
import base64
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, File, Form, Request, UploadFile
from pydantic import ValidationError

from .auth import _api_error, require_user, resolve_llm_selection
from .builder import (
    ResumeDraftError,
    baseline_proposal,
    build_manual_artifacts,
    render_baseline,
)
from .importer import assemble_template, build_resume_data, sanitize_style
from .llm import (
    provider_supports_vision,
    LLMConfigurationError,
    LLMExtractResult,
    LLMProviderError,
    LLMResponseError,
)
from .pdftext import PdfExtractionError
from .resume import ProposalValidationError, ResumeError, render_template_text
from .routes_runs import compile_report, compiler_failure
from .schemas import (
    OkResponse,
    ResumeContentUpdateRequest,
    ResumeCreateRequest,
    ResumeCreateResponse,
    ResumeData,
    ResumeDetail,
    ResumeListResponse,
    ResumeManualCreateRequest,
    ResumePreviewRequest,
    ResumePreviewResponse,
    ResumeRenameRequest,
    ResumeResponse,
    ResumeSummary,
    ResumeVersionSourceResponse,
    ResumeVersionSummary,
    ResumeVersionsResponse,
    dump_model,
    validate_model,
)


logger = logging.getLogger(__name__)

#: ``source_type`` for a resume typed into the editor rather than imported.
MANUAL_SOURCE_TYPE = "manual"

IMPORT_REVIEW_WARNING = (
    "Review the imported fields; the AI extraction may have missed or "
    "misread details from your document."
)

_PDF_ERROR_STATUS = {
    "invalid_pdf": (422, "invalid_pdf"),
    "pdf_too_large": (413, "pdf_too_large"),
    "pdf_too_many_pages": (422, "pdf_too_many_pages"),
    "pdf_no_text": (422, "pdf_no_text"),
    "pdftotext_missing": (503, "pdf_support_unavailable"),
    "pdf_extract_timeout": (504, "pdf_extract_timeout"),
    "pdf_extract_failed": (422, "pdf_extract_failed"),
    "pdftoppm_missing": (503, "pdf_support_unavailable"),
    "pdf_render_failed": (422, "pdf_extract_failed"),
    "pdf_render_timeout": (504, "pdf_extract_timeout"),
}


def _import_source_type(source_kind: str) -> str:
    """Map an extraction kind to the stored ``source_type``.

    A scanned import keeps its own label: it has no stored source text to fall
    back on, and the UI is clearer for saying where the facts came from.
    """

    if source_kind in ("text", "text_and_image"):
        return "pdf"
    if source_kind == "image":
        return "pdf_scanned"
    return "latex"


def _pdf_error(exc: PdfExtractionError) -> Exception:
    status_code, code = _PDF_ERROR_STATUS.get(exc.code, (422, "pdf_extract_failed"))
    return _api_error(status_code, code, str(exc))


def _resume_not_found() -> Exception:
    return _api_error(404, "resume_not_found", "No resume with this id in your library.")


def _validation_issue(exc: Exception) -> str:
    """Describe a validation failure by field, never by value (rule R-10).

    ``str(ValidationError)`` embeds ``input_value``, which for an import is a
    fragment of somebody's resume. This is surfaced to the browser and written
    to the server log, so the location and the reason are kept and the offending
    value is dropped.
    """

    if isinstance(exc, ProposalValidationError):
        return "; ".join(exc.errors)[:4_000]
    if isinstance(exc, ValidationError):
        parts = []
        for error in exc.errors():
            location = ".".join(str(item) for item in error.get("loc", ())) or "resume"
            parts.append("{0}: {1}".format(location, error.get("msg", "is invalid")))
        if parts:
            return "; ".join(parts)[:4_000]
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


def _pdf_filename(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(label).lower()).strip("-")[:60]
    return (slug or "resume") + ".pdf"


def register_resumes_routes(app: FastAPI, services: Any) -> None:
    async def _current_content(user_id: str, doc: Dict[str, Any]) -> Tuple[ResumeData, str]:
        """Validated facts plus the stored template for a resume's live version."""

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
        return data, version.get("template_tex", "") or ""

    async def _resume_detail(
        user_id: str, doc: Dict[str, Any]
    ) -> ResumeDetail:
        data, _template = await _current_content(user_id, doc)
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
        images: Optional[List[bytes]] = None,
        links: Optional[List[Dict[str, str]]] = None,
    ) -> Tuple[ResumeData, Any, str, LLMExtractResult, List[str]]:
        """Shared import pipeline: LLM extraction -> importer -> render check."""

        provider, model, api_key, warnings = await resolve_llm_selection(
            services, user, requested_provider, requested_model
        )
        llm_kwargs: Dict[str, Any] = {"provider": provider, "model": model}
        if api_key:
            llm_kwargs["api_key"] = api_key
        if source_kind == "text" and images:
            # Sending the pages alongside the text is strictly better when the
            # model can see them: the text layer loses column order and drops
            # anything drawn as a graphic, which the images still show.
            if provider_supports_vision(provider):
                source_kind = "text_and_image"
            else:
                images = []
                warnings.append(
                    "{0} has no vision-capable model configured, so this PDF was "
                    "read from its text layer alone. Multi-column layouts may "
                    "lose fields.".format(provider)
                )
        if source_kind != "latex":
            llm_kwargs["source_kind"] = source_kind
            if links:
                llm_kwargs["links"] = links
        if source_kind in ("image", "text_and_image"):
            llm_kwargs["images"] = images or []
        if source_kind == "image":
            # Transcription from pixels is the one import path that can silently
            # misread a digit, so the user is told to check rather than trust.
            warnings.append(
                "This looked like a scanned PDF, so its pages were read as "
                "images. Double-check your name, email, phone number, and any "
                "figures before sending it anywhere."
            )
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
            render_template_text(
                template, resume, baseline_proposal(resume), sectioned=True
            )
        except (ResumeError, ProposalValidationError, ValidationError) as exc:
            # Extraction quality is the usual cause and the hardest thing to
            # debug from a generic 422, so record which field actually failed.
            # The detail names fields, never their values (rule R-10).
            logger.warning(
                "Import extraction failed validation (provider=%s model=%s kind=%s): %s",
                extraction.provider,
                extraction.model,
                source_kind,
                _validation_issue(exc),
            )
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

    async def _read_pdf_upload(
        file: UploadFile,
    ) -> Tuple[str, str, List[bytes], List[Dict[str, str]]]:
        """Return ``(source_text, source_kind, page_images)`` for an upload.

        Every PDF is rasterized, because the page images are the only faithful
        record of the layout: ``pdftotext`` interleaves columns, repeats running
        headers, and drops text drawn inside a graphic. A text PDF yields
        ``("...", "text", [png, ...])`` so both can be sent; a scan, which has
        no text layer at all, yields ``("", "image", [png, ...])``. Rendering is
        best-effort for a text PDF and required for a scan: when it fails there,
        the original ``pdf_no_text`` error stands.

        Hyperlink targets are recovered separately in every case: a PDF keeps
        them in annotations, so a contact row of linked words ("Portfolio",
        "GitHub") shows only its labels in both the text and the images.

        The caller decides whether the images are actually usable -- that
        depends on the provider the request resolves to.
        """

        cap = services.config.max_pdf_upload_bytes
        # Read one byte past the cap rather than the whole part: an oversized
        # upload must not be materialized in memory just to be rejected.
        data = await file.read(cap + 1)
        if len(data) > cap:
            raise _api_error(
                413,
                "pdf_too_large",
                "The uploaded PDF exceeds the {0} MB limit.".format(
                    cap // 1_000_000
                ),
            )
        if data[:5] != b"%PDF-":
            raise _api_error(
                422, "invalid_pdf", "The uploaded file is not a PDF document."
            )
        loop = asyncio.get_running_loop()
        try:
            links = await loop.run_in_executor(None, services.pdf_link_extractor, data)
        except PdfExtractionError:
            links = []
        try:
            text = await loop.run_in_executor(None, services.pdf_extractor, data)
        except PdfExtractionError as exc:
            if exc.code != "pdf_no_text":
                raise _pdf_error(exc) from exc
            try:
                images = await loop.run_in_executor(
                    None, services.pdf_renderer, data
                )
            except PdfExtractionError:
                # Surface the original diagnosis: the upload is a scan, and this
                # server could not render it either.
                raise _pdf_error(exc) from exc
            return "", "image", images, links

        try:
            images = await loop.run_in_executor(None, services.pdf_renderer, data)
        except PdfExtractionError as exc:
            # The text alone is still a usable import, so a rendering failure
            # here degrades rather than fails.
            logger.warning("Could not rasterize an uploaded PDF: %s", exc)
            images = []
        return text, "text", images, links

    async def _check_resume_quota(user: Dict[str, Any]) -> None:
        count = await services.database.resumes.count_for_user(user["_id"])
        if count >= services.config.max_resumes_per_user:
            raise _api_error(
                409,
                "resume_quota_exceeded",
                "You already have {0} resumes; delete one to add another.".format(count),
            )

    def _check_version_quota(existing: Dict[str, Any]) -> None:
        if int(existing.get("current_version", 1)) >= services.config.max_versions_per_resume:
            raise _api_error(
                409,
                "version_quota_exceeded",
                "This resume already has {0} versions.".format(
                    existing.get("current_version")
                ),
            )

    def _manual_artifacts(
        draft: Any, style: Any, *, require_content: bool = True
    ) -> Tuple[ResumeData, Any, str, str]:
        """Draft -> stored artifacts, with draft problems as field-addressed 422s."""

        try:
            return build_manual_artifacts(
                dump_model(draft),
                dump_model(style) if style is not None else None,
                require_content=require_content,
            )
        except ResumeDraftError as exc:
            raise _api_error(
                422,
                "incomplete_resume",
                "This resume is not ready yet — a few fields still need attention.",
                errors=exc.errors,
            ) from exc

    async def _create_resume(
        user: Dict[str, Any],
        source_text: str,
        source_kind: str,
        name: Optional[str],
        provider: Optional[str],
        model: Optional[str],
        images: Optional[List[bytes]] = None,
        links: Optional[List[Dict[str, str]]] = None,
    ) -> ResumeCreateResponse:
        await _check_resume_quota(user)
        resume, style, template, extraction, warnings = await _extract_validated_import(
            user, source_text, source_kind, provider, model, images, links
        )
        source_type = _import_source_type(source_kind)
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
        images: Optional[List[bytes]] = None,
        links: Optional[List[Dict[str, str]]] = None,
    ) -> ResumeCreateResponse:
        existing = await services.database.resumes.get(user["_id"], resume_id)
        if existing is None:
            raise _resume_not_found()
        _check_version_quota(existing)
        resume, style, template, extraction, warnings = await _extract_validated_import(
            user, source_text, source_kind, provider, model, images, links
        )
        source_type = _import_source_type(source_kind)
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
        text, kind, images, links = await _read_pdf_upload(file)
        return await _create_resume(
            user, text, kind, name, provider, model, images, links
        )

    @app.post(
        "/api/resumes/manual", response_model=ResumeCreateResponse, status_code=201
    )
    async def create_manual_resume(
        payload: ResumeManualCreateRequest, request: Request
    ) -> ResumeCreateResponse:
        """Author a resume in the app: no document to import, no LLM, no key."""

        user = await require_user(request, services)
        await _check_resume_quota(user)
        resume, style, template, latex_source = _manual_artifacts(
            payload.resume, payload.style
        )
        doc = await services.database.resumes.create(
            user["_id"],
            (payload.name or "").strip() or _default_resume_name(resume),
            MANUAL_SOURCE_TYPE,
            dump_model(resume),
            template,
            # Imports keep the document they came from; a resume written here
            # has no such original, so the version stores the LaTeX the server
            # rendered from it — which is what "download the source" should mean.
            latex_source,
            dump_model(style),
            "",
            "",
        )
        return ResumeCreateResponse(resume=await _resume_detail(user["_id"], doc))

    @app.put(
        "/api/resumes/{resume_id}/content", response_model=ResumeCreateResponse
    )
    async def update_resume_content(
        resume_id: str, payload: ResumeContentUpdateRequest, request: Request
    ) -> ResumeCreateResponse:
        """Save edited facts as the resume's next version.

        Editing is version-additive like re-importing, so the previous wording
        survives an experiment. It works on imported resumes too: the first save
        turns that version into a manually authored one.
        """

        user = await require_user(request, services)
        existing = await services.database.resumes.get(user["_id"], resume_id)
        if existing is None:
            raise _resume_not_found()
        _check_version_quota(existing)
        resume, style, template, latex_source = _manual_artifacts(
            payload.resume, payload.style
        )
        doc = await services.database.resumes.add_version(
            user["_id"],
            resume_id,
            MANUAL_SOURCE_TYPE,
            dump_model(resume),
            template,
            latex_source,
            dump_model(style),
            "",
            "",
        )
        if doc is None:
            raise _resume_not_found()
        return ResumeCreateResponse(resume=await _resume_detail(user["_id"], doc))

    @app.post("/api/resumes/preview", response_model=ResumePreviewResponse)
    async def preview_resume(
        payload: ResumePreviewRequest, request: Request
    ) -> ResumePreviewResponse:
        """Compile a resume as written — an unsaved draft, or a stored one.

        No job description and no model: this is the untailored document, so the
        editor can show the real PDF between edits and a user can download their
        base resume without spending an LLM call.
        """

        user = await require_user(request, services)
        if (payload.resume is None) == (payload.resume_id is None):
            raise _api_error(
                422,
                "preview_target_required",
                "Provide exactly one of resume or resume_id.",
            )

        if payload.resume is not None:
            # Preview only: an empty body renders as a blank page under the
            # contact block, which is what a fresh editor should show.
            resume, _style, _template, latex_source = _manual_artifacts(
                payload.resume, payload.style, require_content=False
            )
            filename = _pdf_filename(resume.identity.name)
        else:
            doc = await services.database.resumes.get(user["_id"], payload.resume_id)
            if doc is None:
                raise _resume_not_found()
            resume, template = await _current_content(user["_id"], doc)
            if payload.style is not None:
                # A style override previews a different look without touching
                # what is stored; saving is what makes it permanent.
                template = assemble_template(sanitize_style(dump_model(payload.style)))
            try:
                latex_source = render_baseline(template, resume)
            except ResumeDraftError as exc:
                raise _api_error(
                    500,
                    "resume_configuration_error",
                    "The stored resume could not be rendered.",
                    errors=exc.errors,
                ) from exc
            filename = _pdf_filename(doc.get("name") or resume.identity.name)

        result = await services.compiler.compile(
            latex_source, services.repository.assets_dir
        )
        if not result.success:
            raise compiler_failure(result)
        return ResumePreviewResponse(
            pdf_base64=base64.b64encode(result.pdf_bytes or b"").decode("ascii"),
            page_count=result.page_count,
            filename=filename,
            latex_source=latex_source,
            compiler=compile_report(result),
        )

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
        text, kind, images, links = await _read_pdf_upload(file)
        return await _add_resume_version(
            user, resume_id, text, kind, provider, model, images, links
        )

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
