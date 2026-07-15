"""FastAPI application for JD-based, locked-template resume tailoring.

Two runtime modes (decided once at app creation):
- Multi-user mode (``MONGODB_URI`` set / a ``Database`` injected): accounts,
  per-user resume/JD libraries, encrypted per-user provider keys, and tailor
  history. Tailoring requires an authenticated session and an owned resume.
- Demo mode (no database): only the seed-resume tailor flow works, exactly as
  in the single-user app; every DB-backed route returns a structured 503.

Middleware defends in depth: declared body-size limits per route family, a
CSRF origin check for cookie-carrying state changes, and sliding-window rate
limits (a strict bucket for LLM/compiler work, a general bucket for the rest).
"""

from __future__ import annotations

import asyncio
import base64
import logging
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from pymongo.errors import PyMongoError

from . import __version__, pdftext, security
from .auth import (
    _api_error,
    register_auth_routes,
    require_user,
    resolve_llm_selection,
    resolve_session,
)
from .compiler import CompileService
from .config import AppConfig, load_config
from .db import Database
from .llm import (
    LLMClient,
    LLMConfigurationError,
    LLMProviderError,
    LLMResponseError,
    LLMResult,
)
from .resume import (
    PROJECT_ROOT,
    ProposalValidationError,
    ResumeError,
    ResumeRepository,
    build_change_list,
    build_unified_diff,
    flattened_skills,
    redact_identity,
    render_template_text,
    validate_proposal,
)
from .routes_jds import register_jds_routes
from .routes_keys import register_keys_routes
from .routes_resumes import register_resumes_routes
from .routes_runs import (
    compile_report as _compile_report,
    compiler_failure as _compiler_failure,
    register_runs_routes,
)
from .schemas import (
    CompilerReport,
    HealthResponse,
    ResumeData,
    TailorProposal,
    TailorRequest,
    TailorResponse,
    dump_model,
    validate_model,
)


logger = logging.getLogger(__name__)


MAX_HTTP_BODY_BYTES = 64_000
# Importing a full pasted LaTeX resume needs a larger ceiling than tailoring.
MAX_IMPORT_BODY_BYTES = 260_000
# Multipart overhead allowance on top of the raw PDF size cap.
MULTIPART_OVERHEAD_BYTES = 65_536

# Stored-run size caps (spec: latex 200KB, diff 100KB, JD excerpt 300 chars).
MAX_RUN_LATEX_CHARACTERS = 200_000
MAX_RUN_DIFF_CHARACTERS = 100_000
RUN_JD_EXCERPT_CHARACTERS = 300

_PDF_UPLOAD_PATH = re.compile(r"^/api/resumes(?:/[^/]+/versions)?/pdf$")
_LATEX_IMPORT_PATH = re.compile(r"^/api/resumes(?:/[^/]+/versions)?$")
_LLM_BUCKET_PATH = re.compile(
    r"^/api/(?:tailor|resumes(?:/pdf|/[^/]+/versions(?:/pdf)?)?|runs/[^/]+/compile)$"
)
_STATE_CHANGING_METHODS = ("POST", "PUT", "PATCH", "DELETE")


@dataclass
class ApplicationServices:
    repository: ResumeRepository
    llm: LLMClient
    compiler: CompileService
    database: Optional[Database]
    config: AppConfig
    rate_limiter_llm: security.RateLimiter
    rate_limiter_general: security.RateLimiter
    login_throttle: security.LoginThrottle
    pdf_extractor: Callable[[bytes], str]


def _validation_issue(exc: Exception) -> str:
    if isinstance(exc, ProposalValidationError):
        return "; ".join(exc.errors)[:4_000]
    return str(exc)[:4_000]


async def _generate_valid_proposal(
    services: ApplicationServices,
    resume: Any,
    job_description: str,
    llm_kwargs: Dict[str, Any],
) -> Tuple[LLMResult, bool]:
    """Generate a proposal and spend at most one semantic repair attempt."""

    first_raw = ""
    try:
        result = await services.llm.generate(resume, job_description, **llm_kwargs)
        first_raw = result.raw_content
        validate_proposal(resume, result.proposal)
        return result, False
    except (LLMResponseError, ProposalValidationError) as first_error:
        if isinstance(first_error, LLMResponseError):
            first_raw = first_error.raw_content
        issue = _validation_issue(first_error)

    try:
        repaired = await services.llm.repair(
            resume,
            job_description,
            issue=issue,
            previous_output=first_raw,
            **llm_kwargs,
        )
        validate_proposal(resume, repaired.proposal)
        return repaired, True
    except (LLMResponseError, ProposalValidationError) as repair_error:
        raise _api_error(
            422,
            "invalid_llm_proposal",
            "The AI response did not satisfy the resume safety contract after one repair attempt.",
            errors=(
                repair_error.errors
                if isinstance(repair_error, ProposalValidationError)
                else [str(repair_error)]
            ),
        ) from repair_error


def _body_size_limit(path: str, config: AppConfig) -> int:
    if _PDF_UPLOAD_PATH.match(path):
        return config.max_pdf_upload_bytes + MULTIPART_OVERHEAD_BYTES
    if _LATEX_IMPORT_PATH.match(path):
        return MAX_IMPORT_BODY_BYTES
    return MAX_HTTP_BODY_BYTES


def _database_unavailable_response() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "detail": {
                "code": "database_unavailable",
                "message": "The database is temporarily unreachable; try again shortly.",
            }
        },
    )


INDEX_RETRY_DELAY_SECONDS = 15.0


async def _ensure_indexes_with_retry(
    database: Database, delay_seconds: float = INDEX_RETRY_DELAY_SECONDS
) -> None:
    """Create indexes once Mongo is reachable, retrying in the background.

    Runs as a startup task so an unreachable database can never delay uvicorn
    from accepting connections, and so indexes are still created when Mongo
    only becomes reachable after boot.
    """

    while True:
        if await database.ping():
            try:
                await database.ensure_indexes()
                return
            except Exception as exc:  # keep retrying; indexes matter
                logger.warning("Could not ensure database indexes: %s", exc)
        await asyncio.sleep(delay_seconds)


def _rate_limited_response(retry_after: float) -> JSONResponse:
    seconds = max(1, int(math.ceil(retry_after)))
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": str(seconds)},
        content={
            "detail": {
                "code": "rate_limited",
                "message": "Too many requests; slow down and retry shortly.",
                "retry_after": seconds,
            }
        },
    )


def create_app(
    repository: Optional[ResumeRepository] = None,
    llm_client: Optional[LLMClient] = None,
    compiler: Optional[CompileService] = None,
    static_dir: Optional[Path] = None,
    database: Optional[Database] = None,
    config: Optional[AppConfig] = None,
    pdf_extractor: Optional[Callable[[bytes], str]] = None,
) -> FastAPI:
    """Create an app with injectable filesystem, LLM, compiler, and DB dependencies."""

    application = FastAPI(
        title="JD Resume Builder",
        description="Tailor validated plain-text resume fields and compile a locked LaTeX template.",
        version=__version__,
    )
    app_config = config or load_config()
    services = ApplicationServices(
        repository=repository or ResumeRepository(),
        llm=llm_client or LLMClient(),
        compiler=compiler or CompileService(),
        database=database if database is not None else Database.from_env(),
        config=app_config,
        rate_limiter_llm=security.RateLimiter(
            app_config.rate_limit_llm_calls, app_config.rate_limit_llm_window_seconds
        ),
        rate_limiter_general=security.RateLimiter(
            app_config.rate_limit_general_calls,
            app_config.rate_limit_general_window_seconds,
        ),
        login_throttle=security.LoginThrottle(
            app_config.login_max_attempts, app_config.login_window_seconds
        ),
        pdf_extractor=pdf_extractor
        or (
            lambda pdf_bytes: pdftext.extract_pdf_text(
                pdf_bytes,
                bin_path=app_config.pdftotext_bin,
                timeout_seconds=app_config.pdf_extract_timeout_seconds,
                max_bytes=app_config.max_pdf_upload_bytes,
            )
        ),
    )
    application.state.services = services

    chosen_static_dir = Path(static_dir or (PROJECT_ROOT / "static"))

    @application.on_event("startup")
    async def ensure_database_indexes() -> None:
        if services.database is None:
            return
        # Never block startup on index creation: an unreachable Mongo would
        # otherwise stall every create_index call for its full server-selection
        # timeout before uvicorn accepts a single connection.
        application.state.index_task = asyncio.create_task(
            _ensure_indexes_with_retry(services.database)
        )

    @application.on_event("shutdown")
    async def cancel_index_task() -> None:
        task = getattr(application.state, "index_task", None)
        if task is not None and not task.done():
            task.cancel()

    @application.exception_handler(PyMongoError)
    async def handle_database_outage(request: Request, exc: PyMongoError) -> JSONResponse:
        # Keep the structured {code, message} error contract (rule C-4) when
        # Mongo is unreachable instead of leaking a plain-text 500.
        logger.error("Database error while handling %s: %s", request.url.path, exc)
        return _database_unavailable_response()

    @application.middleware("http")
    async def api_request_guard(request: Request, call_next: Any) -> Any:
        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)
        method = request.method.upper()

        # 1. Declared body-size limits (cheap rejection before any parsing).
        # DELETE is included because DELETE /api/me parses a JSON body.
        if method in ("POST", "PUT", "PATCH", "DELETE"):
            limit = _body_size_limit(path, services.config)
            content_length = request.headers.get("content-length")
            if content_length:
                try:
                    too_large = int(content_length) > limit
                except ValueError:
                    too_large = True
                if too_large:
                    return JSONResponse(
                        status_code=413,
                        content={
                            "detail": {
                                "code": "request_too_large",
                                "message": "Request body exceeds the {0} KB safety limit.".format(
                                    limit // 1_000
                                ),
                            }
                        },
                    )

        # 2. CSRF origin check for state-changing requests riding the cookie.
        if (
            method in _STATE_CHANGING_METHODS
            and request.cookies.get(security.SESSION_COOKIE_NAME)
            and not security.origin_allowed(request)
        ):
            return JSONResponse(
                status_code=403,
                content={
                    "detail": {
                        "code": "bad_origin",
                        "message": "Cross-origin request rejected.",
                    }
                },
            )

        # 3. Sliding-window rate limits, keyed by user id when a session
        # resolves and by client IP otherwise. Health stays unthrottled for
        # monitoring probes.
        if path != "/api/health":
            bucket_key = ""
            if services.database is not None:
                # This runs before routing, so route-level exception handlers
                # cannot catch a Mongo outage here; translate it in place.
                try:
                    context = await resolve_session(request, services)
                except PyMongoError as exc:
                    logger.error(
                        "Database error resolving session for %s: %s", path, exc
                    )
                    return _database_unavailable_response()
                if context is not None:
                    bucket_key = context[0]["_id"]
            if not bucket_key:
                client = getattr(request, "client", None)
                bucket_key = getattr(client, "host", "") or "anonymous"
            if method == "POST" and _LLM_BUCKET_PATH.match(path):
                retry_after = services.rate_limiter_llm.check("llm:" + bucket_key)
            else:
                retry_after = services.rate_limiter_general.check("gen:" + bucket_key)
            if retry_after is not None:
                return _rate_limited_response(retry_after)

        return await call_next(request)

    @application.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        checks: Dict[str, Any] = {}
        mode = "multi_user" if services.database is not None else "demo"

        # Seed resume: mandatory in demo mode, optional in multi-user mode.
        resume_valid = False
        resume_ok_for_status = False
        data_path = getattr(services.repository, "data_path", None)
        template_path = getattr(services.repository, "template_path", None)
        seed_present = bool(
            data_path
            and template_path
            and Path(data_path).is_file()
            and Path(template_path).is_file()
        )
        if mode == "multi_user" and not seed_present:
            checks["resume"] = "not_configured"
            resume_ok_for_status = True
        else:
            try:
                resume, template = services.repository.load()
                baseline = TailorProposal(
                    summary=resume.summary,
                    bullet_rewrites=[],
                    skills_order=flattened_skills(resume),
                )
                # This validates every token and all deterministic renderer inputs.
                render_template_text(template, resume, baseline)
                resume_valid = True
                resume_ok_for_status = True
                checks["resume"] = "ok"
            except (ResumeError, ProposalValidationError, OSError) as exc:
                checks["resume"] = "error: {0}".format(str(exc)[:300])

        compiler_available = services.compiler.is_available()
        checks["compiler"] = (
            "ok" if compiler_available else "Tectonic executable not found"
        )
        checks["compiler_only_cached"] = services.compiler.only_cached

        provider = getattr(services.llm, "configured_provider", "custom")
        model = os.getenv("LLM_MODEL", "")
        llm_configured = True
        resolver = getattr(services.llm, "resolve_config", None)
        if mode == "multi_user" and not os.getenv("LLM_PROVIDER", "").strip():
            # No operator env provider: users bring their own keys per request.
            checks["llm"] = "user_keys"
            provider = "user_keys"
            model = "per-user"
        elif resolver is not None:
            try:
                resolved = resolver()
                provider = resolved.provider
                model = resolved.model
                checks["llm"] = "ok"
            except LLMConfigurationError as exc:
                llm_configured = False
                checks["llm"] = "error: {0}".format(str(exc)[:300])
        else:
            checks["llm"] = "injected"
            model = model or "injected"

        database_ok = True
        if services.database is None:
            checks["database"] = "not_configured"
        elif await services.database.ping():
            checks["database"] = "ok"
        else:
            database_ok = False
            checks["database"] = "error: database ping failed"

        checks["secret_key"] = (
            "ephemeral" if services.config.secret_key_ephemeral else "ok"
        )
        checks["pdftotext"] = (
            "ok"
            if pdftext.is_pdftotext_available(services.config.pdftotext_bin)
            else "not_found"
        )

        status = (
            "ok"
            if resume_ok_for_status
            and compiler_available
            and llm_configured
            and database_ok
            else "degraded"
        )
        return HealthResponse(
            status=status,
            version=__version__,
            mode=mode,
            provider=provider,
            model=model or "not-configured",
            resume_valid=resume_valid,
            compiler_available=compiler_available,
            checks=checks,
        )

    def _load_seed_resume() -> Tuple[Any, str]:
        try:
            return services.repository.load()
        except ResumeError as exc:
            raise _api_error(
                500,
                "resume_configuration_error",
                "The locked resume source is invalid. Check the server configuration.",
            ) from exc

    async def _load_owned_resume(
        user: Dict[str, Any], resume_id: str
    ) -> Tuple[Any, str, Dict[str, Any]]:
        doc = await services.database.resumes.get(user["_id"], resume_id)
        if doc is None:
            raise _api_error(
                404,
                "resume_not_found",
                "No resume with this id in your library. Import a resume first.",
            )
        version_doc = await services.database.resumes.get_version(
            user["_id"], resume_id, int(doc.get("current_version", 1))
        )
        if version_doc is None:
            raise _api_error(
                500, "resume_configuration_error", "The stored resume is incomplete."
            )
        try:
            resume = validate_model(ResumeData, version_doc.get("data"))
        except ValidationError as exc:
            raise _api_error(
                500, "resume_configuration_error", "The stored resume profile is invalid."
            ) from exc
        template = version_doc.get("template_tex", "") or ""
        return resume, template, doc

    @application.post("/api/tailor", response_model=TailorResponse)
    async def tailor(payload: TailorRequest, request: Request) -> TailorResponse:
        if (payload.job_description is None) == (payload.jd_id is None):
            raise _api_error(
                422,
                "jd_required",
                "Provide exactly one of job_description or jd_id.",
            )

        warnings: List[str] = []
        user: Optional[Dict[str, Any]] = None
        resume_doc: Optional[Dict[str, Any]] = None
        jd_doc: Optional[Dict[str, Any]] = None

        if services.database is None:
            # Demo mode: seed-resume tailoring only, exactly as the
            # single-user app behaved (env LLM config, no auth, no history).
            if payload.jd_id is not None or payload.resume_id:
                raise _api_error(
                    503,
                    "database_not_configured",
                    "Saved resumes and JDs need a database; this deployment runs in demo mode.",
                )
            resume, template = _load_seed_resume()
            sectioned = False
            job_description = payload.job_description or ""
            llm_kwargs: Dict[str, Any] = {
                "provider": payload.provider,
                "model": payload.model,
            }
        else:
            user = await require_user(request, services)
            if not payload.resume_id:
                raise _api_error(
                    400,
                    "resume_required",
                    "Select one of your imported resumes to tailor.",
                )
            resume, template, resume_doc = await _load_owned_resume(
                user, payload.resume_id
            )
            sectioned = True
            if payload.jd_id is not None:
                jd_doc = await services.database.jds.get(user["_id"], payload.jd_id)
                if jd_doc is None:
                    raise _api_error(
                        404,
                        "jd_not_found",
                        "No job description with this id in your library.",
                    )
                job_description = jd_doc.get("content", "")
            else:
                job_description = payload.job_description or ""
            provider, model, api_key, warnings = await resolve_llm_selection(
                services, user, payload.provider, payload.model
            )
            llm_kwargs = {"provider": provider, "model": model}
            if api_key:
                llm_kwargs["api_key"] = api_key

        try:
            result, repair_used = await _generate_valid_proposal(
                services, resume, job_description, llm_kwargs
            )
        except LLMConfigurationError as exc:
            raise _api_error(503, "llm_not_configured", str(exc)) from exc
        except LLMProviderError as exc:
            status_code = 429 if exc.status_code == 429 else 502
            raise _api_error(status_code, "llm_provider_error", str(exc)) from exc

        try:
            latex_source = render_template_text(template, resume, result.proposal, sectioned)
            changes = build_change_list(resume, result.proposal)
            unified_diff = build_unified_diff(changes)
        except (ResumeError, ProposalValidationError) as exc:
            raise _api_error(
                500,
                "render_failed",
                "The server could not render the validated proposal into the locked template.",
            ) from exc

        if not changes:
            warnings.append("The provider returned no material resume changes for this JD.")

        async def _persist_run(
            response: TailorResponse,
        ) -> TailorResponse:
            if user is None or resume_doc is None or not payload.save_run:
                return response
            run_doc = {
                "resume_id": resume_doc["_id"],
                "resume_name": resume_doc.get("name", ""),
                "resume_version": int(resume_doc.get("current_version", 1)),
                "jd_id": jd_doc["_id"] if jd_doc is not None else None,
                "jd_title": jd_doc.get("title") if jd_doc is not None else None,
                "jd_excerpt": " ".join(job_description.split())[
                    :RUN_JD_EXCERPT_CHARACTERS
                ],
                "provider": response.provider,
                "model": response.model,
                "page_count": response.page_count,
                "repaired": response.repaired,
                "proposal": dump_model(response.proposal),
                "changes": [dump_model(change) for change in response.changes],
                "unified_diff": response.unified_diff[:MAX_RUN_DIFF_CHARACTERS],
                "latex_source": response.latex_source[:MAX_RUN_LATEX_CHARACTERS],
                "warnings": list(response.warnings),
            }
            run_id = await services.database.runs.create(
                user["_id"], run_doc, max_runs=services.config.max_runs_per_user
            )
            response.run_id = run_id
            return response

        if not payload.compile:
            report = CompilerReport(
                attempted=False,
                success=True,
                warnings=["Compilation was skipped by request."],
            )
            warnings.extend(report.warnings)
            return await _persist_run(
                TailorResponse(
                    proposal=result.proposal,
                    changes=changes,
                    unified_diff=unified_diff,
                    latex_source=latex_source,
                    provider=result.provider,
                    model=result.model,
                    repaired=repair_used,
                    warnings=warnings,
                    compiler=report,
                )
            )

        compile_result = await services.compiler.compile(
            latex_source, services.repository.assets_dir
        )

        repairable_failure = (
            not compile_result.success
            and compile_result.error_code == "latex_compile_failed"
        )
        needs_shortening = (
            compile_result.success
            and payload.require_one_page
            and compile_result.page_count is not None
            and compile_result.page_count > 1
        )

        # A semantic/schema repair may already have consumed the single repair
        # budget. Environment failures are never sent to an LLM.
        if (repairable_failure or needs_shortening) and not repair_used and result.provider != "mock":
            issue = (
                "The generated PDF has {0} pages. Shorten editable content to fit one page "
                "without removing factual outcomes or changing the schema.".format(
                    compile_result.page_count
                )
                if needs_shortening
                else "Tectonic compilation failed. Correct only editable plain-text fields. "
                "Compiler excerpt:\n{0}".format(compile_result.log[-4_000:])
            )
            if repairable_failure:
                issue = redact_identity(issue, resume)
            original_compile = compile_result
            try:
                repaired_result = await services.llm.repair(
                    resume,
                    job_description,
                    issue=issue,
                    previous_output=result.raw_content,
                    **llm_kwargs,
                )
                validate_proposal(resume, repaired_result.proposal)
                repaired_latex = render_template_text(
                    template, resume, repaired_result.proposal, sectioned
                )
                repaired_compile = await services.compiler.compile(
                    repaired_latex, services.repository.assets_dir
                )
                if repaired_compile.success:
                    result = repaired_result
                    latex_source = repaired_latex
                    compile_result = repaired_compile
                    changes = build_change_list(resume, result.proposal)
                    unified_diff = build_unified_diff(changes)
                    repair_used = True
                elif not original_compile.success:
                    compile_result = repaired_compile
            except (
                LLMConfigurationError,
                LLMProviderError,
                LLMResponseError,
                ProposalValidationError,
                ResumeError,
            ):
                # Preserve a valid multi-page PDF if shortening fails. If the
                # original did not compile, the normal compiler error below is
                # still the most useful and safest response.
                compile_result = original_compile
                if original_compile.success:
                    warnings.append(
                        "The automatic one-page repair was unsuccessful; review the multi-page PDF."
                    )

        if not compile_result.success:
            raise _compiler_failure(compile_result)

        report = _compile_report(compile_result)
        warnings.extend(report.warnings)
        pdf_bytes = compile_result.pdf_bytes or b""
        encoded_pdf = base64.b64encode(pdf_bytes).decode("ascii")
        return await _persist_run(
            TailorResponse(
                proposal=result.proposal,
                changes=changes,
                unified_diff=unified_diff,
                latex_source=latex_source,
                pdf_base64=encoded_pdf,
                # Avoid duplicating a large base64 payload; browsers can prepend
                # the data URL prefix to pdf_base64 when desired.
                pdf_data_url=None,
                page_count=compile_result.page_count,
                filename="tailored-resume.pdf",
                provider=result.provider,
                model=result.model,
                repaired=repair_used,
                warnings=warnings,
                compiler=report,
            )
        )

    register_auth_routes(application, services)
    register_keys_routes(application, services)
    register_resumes_routes(application, services)
    register_jds_routes(application, services)
    register_runs_routes(application, services)

    @application.get("/", include_in_schema=False)
    async def index() -> Any:
        index_path = chosen_static_dir / "index.html"
        if index_path.is_file():
            return FileResponse(str(index_path))
        return HTMLResponse(
            "<h1>JD Resume Builder</h1><p>The API is ready. Static UI files are not installed.</p>"
        )

    application.mount(
        "/static", StaticFiles(directory=str(chosen_static_dir), check_dir=False), name="static"
    )
    return application


# Export one normal ASGI application while keeping all dependencies replaceable
# through create_app for tests.
app = create_app()
