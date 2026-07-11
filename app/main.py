"""FastAPI application for JD-based, locked-template resume tailoring."""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .compiler import CompileResult, CompileService
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
from .schemas import (
    CompilerReport,
    HealthResponse,
    TailorProposal,
    TailorRequest,
    TailorResponse,
)


MAX_HTTP_BODY_BYTES = 64_000


@dataclass
class ApplicationServices:
    repository: ResumeRepository
    llm: LLMClient
    compiler: CompileService


def _api_error(status_code: int, code: str, message: str, **details: Any) -> HTTPException:
    payload: Dict[str, Any] = {"code": code, "message": message}
    payload.update(details)
    return HTTPException(status_code=status_code, detail=payload)


def _validation_issue(exc: Exception) -> str:
    if isinstance(exc, ProposalValidationError):
        return "; ".join(exc.errors)[:4_000]
    return str(exc)[:4_000]


async def _generate_valid_proposal(
    services: ApplicationServices,
    resume: Any,
    payload: TailorRequest,
) -> Tuple[LLMResult, bool]:
    """Generate a proposal and spend at most one semantic repair attempt."""

    first_raw = ""
    try:
        result = await services.llm.generate(
            resume,
            payload.job_description,
            provider=payload.provider,
            model=payload.model,
        )
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
            payload.job_description,
            issue=issue,
            previous_output=first_raw,
            provider=payload.provider,
            model=payload.model,
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


def _compile_error_status(result: CompileResult) -> int:
    if result.error_code in ("compiler_not_found", "compiler_start_failed"):
        return 503
    if result.error_code == "compile_timeout":
        return 504
    if result.error_code == "latex_compile_failed":
        return 422
    return 500


def _compiler_failure(result: CompileResult) -> HTTPException:
    return _api_error(
        _compile_error_status(result),
        result.error_code or "compile_failed",
        "The tailored resume could not be compiled safely.",
        compiler_log=result.log[-8_000:],
    )


def _compile_report(result: CompileResult, attempted: bool = True) -> CompilerReport:
    return CompilerReport(
        attempted=attempted,
        success=result.success,
        page_count=result.page_count,
        text_preview=result.extracted_text[:2_000],
        warnings=list(result.warnings),
        # Success logs contain filesystem/compiler noise and are unnecessary in
        # the browser. Failure logs are returned through the structured error.
        log=None if result.success else result.log[-8_000:],
    )


def create_app(
    repository: Optional[ResumeRepository] = None,
    llm_client: Optional[LLMClient] = None,
    compiler: Optional[CompileService] = None,
    static_dir: Optional[Path] = None,
) -> FastAPI:
    """Create an app with injectable filesystem, LLM, and compiler dependencies."""

    application = FastAPI(
        title="JD Resume Builder",
        description="Tailor validated plain-text resume fields and compile a locked LaTeX template.",
        version=__version__,
    )
    services = ApplicationServices(
        repository=repository or ResumeRepository(),
        llm=llm_client or LLMClient(),
        compiler=compiler or CompileService(),
    )
    application.state.services = services

    chosen_static_dir = Path(static_dir or (PROJECT_ROOT / "static"))

    @application.middleware("http")
    async def reject_oversized_api_requests(request: Request, call_next: Any) -> Any:
        if request.url.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH"):
            content_length = request.headers.get("content-length")
            if content_length:
                try:
                    too_large = int(content_length) > MAX_HTTP_BODY_BYTES
                except ValueError:
                    too_large = True
                if too_large:
                    return JSONResponse(
                        status_code=413,
                        content={
                            "detail": {
                                "code": "request_too_large",
                                "message": "Request body exceeds the 64 KB safety limit.",
                            }
                        },
                    )
        return await call_next(request)

    @application.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        checks: Dict[str, Any] = {}
        resume_valid = False
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
        if resolver is not None:
            try:
                config = resolver()
                provider = config.provider
                model = config.model
                checks["llm"] = "ok"
            except LLMConfigurationError as exc:
                llm_configured = False
                checks["llm"] = "error: {0}".format(str(exc)[:300])
        else:
            checks["llm"] = "injected"
            model = model or "injected"

        status = (
            "ok" if resume_valid and compiler_available and llm_configured else "degraded"
        )
        return HealthResponse(
            status=status,
            version=__version__,
            provider=provider,
            model=model or "not-configured",
            resume_valid=resume_valid,
            compiler_available=compiler_available,
            checks=checks,
        )

    @application.post("/api/tailor", response_model=TailorResponse)
    async def tailor(payload: TailorRequest) -> TailorResponse:
        try:
            resume, template = services.repository.load()
        except ResumeError as exc:
            raise _api_error(
                500,
                "resume_configuration_error",
                "The locked resume source is invalid. Check the server configuration.",
            ) from exc

        try:
            result, repair_used = await _generate_valid_proposal(
                services, resume, payload
            )
        except LLMConfigurationError as exc:
            raise _api_error(503, "llm_not_configured", str(exc)) from exc
        except LLMProviderError as exc:
            status_code = 429 if exc.status_code == 429 else 502
            raise _api_error(status_code, "llm_provider_error", str(exc)) from exc

        try:
            latex_source = render_template_text(template, resume, result.proposal)
            changes = build_change_list(resume, result.proposal)
            unified_diff = build_unified_diff(changes)
        except (ResumeError, ProposalValidationError) as exc:
            raise _api_error(
                500,
                "render_failed",
                "The server could not render the validated proposal into the locked template.",
            ) from exc

        warnings = []
        if not changes:
            warnings.append("The provider returned no material resume changes for this JD.")

        if not payload.compile:
            report = CompilerReport(
                attempted=False,
                success=True,
                warnings=["Compilation was skipped by request."],
            )
            warnings.extend(report.warnings)
            return TailorResponse(
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
                    payload.job_description,
                    issue=issue,
                    previous_output=result.raw_content,
                    provider=payload.provider,
                    model=payload.model,
                )
                validate_proposal(resume, repaired_result.proposal)
                repaired_latex = render_template_text(
                    template, resume, repaired_result.proposal
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
        return TailorResponse(
            proposal=result.proposal,
            changes=changes,
            unified_diff=unified_diff,
            latex_source=latex_source,
            pdf_base64=encoded_pdf,
            # Avoid duplicating a large base64 payload; browsers can prepend the
            # data URL prefix to pdf_base64 when desired.
            pdf_data_url=None,
            page_count=compile_result.page_count,
            filename="tailored-resume.pdf",
            provider=result.provider,
            model=result.model,
            repaired=repair_used,
            warnings=warnings,
            compiler=report,
        )

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
