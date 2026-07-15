"""Tailor-history routes plus the shared compiler-report helpers.

Security rationale:
- Runs store only server-produced artifacts (validated proposal, change list,
  diff, server-rendered LaTeX) with hard size caps — never PDF bytes and never
  another user's data (all queries are user-scoped; 404 ``run_not_found``).
- Re-compilation reuses the stored server-assembled LaTeX through the same
  sandboxed ``CompileService`` used by tailoring; no LLM call is involved, but
  the endpoint still counts against the LLM rate bucket because Tectonic time
  is the scarce resource.

The compile-report helpers live here (rather than in ``main``) so both the
tailor route and the recompile route share one error mapping without an import
cycle.
"""

from __future__ import annotations

import base64
from typing import Any, Dict

from fastapi import FastAPI, Request
from pydantic import ValidationError

from .auth import _api_error, require_user
from .compiler import CompileResult
from .schemas import (
    CompilerReport,
    OkResponse,
    ResumeChange,
    RunCompileResponse,
    RunDetail,
    RunListResponse,
    RunResponse,
    RunSummary,
    TailorProposal,
    validate_model,
)


def compile_error_status(result: CompileResult) -> int:
    if result.error_code in ("compiler_not_found", "compiler_start_failed"):
        return 503
    if result.error_code == "compile_timeout":
        return 504
    if result.error_code == "latex_compile_failed":
        return 422
    return 500


def compiler_failure(result: CompileResult) -> Exception:
    return _api_error(
        compile_error_status(result),
        result.error_code or "compile_failed",
        "The tailored resume could not be compiled safely.",
        compiler_log=result.log[-8_000:],
    )


def compile_report(result: CompileResult, attempted: bool = True) -> CompilerReport:
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


def _run_not_found() -> Exception:
    return _api_error(404, "run_not_found", "No tailor run with this id in your history.")


def _run_summary(doc: Dict[str, Any]) -> RunSummary:
    return RunSummary(
        id=doc["_id"],
        created_at=doc.get("created_at"),
        resume_id=doc.get("resume_id", "") or "",
        resume_name=doc.get("resume_name", "") or "",
        resume_version=int(doc.get("resume_version", 0) or 0),
        jd_id=doc.get("jd_id"),
        jd_title=doc.get("jd_title"),
        jd_excerpt=doc.get("jd_excerpt", "") or "",
        provider=doc.get("provider", "") or "",
        model=doc.get("model", "") or "",
        page_count=doc.get("page_count"),
        repaired=bool(doc.get("repaired", False)),
    )


def _run_detail(doc: Dict[str, Any]) -> RunDetail:
    summary = _run_summary(doc)
    proposal = None
    raw_proposal = doc.get("proposal")
    if isinstance(raw_proposal, dict):
        try:
            proposal = validate_model(TailorProposal, raw_proposal)
        except ValidationError:
            proposal = None
    changes = []
    for item in doc.get("changes") or []:
        if isinstance(item, dict):
            try:
                changes.append(validate_model(ResumeChange, item))
            except ValidationError:
                continue
    values = {
        "proposal": proposal,
        "changes": changes,
        "unified_diff": doc.get("unified_diff", "") or "",
        "latex_source": doc.get("latex_source", "") or "",
        "warnings": [str(item) for item in (doc.get("warnings") or [])],
    }
    dumper = getattr(summary, "model_dump", None)
    base = dumper() if dumper is not None else summary.dict()
    base.update(values)
    return RunDetail(**base)


def register_runs_routes(app: FastAPI, services: Any) -> None:
    @app.get("/api/runs", response_model=RunListResponse)
    async def list_runs(request: Request) -> RunListResponse:
        user = await require_user(request, services)
        docs = await services.database.runs.list_for_user(user["_id"])
        return RunListResponse(runs=[_run_summary(doc) for doc in docs])

    @app.get("/api/runs/{run_id}", response_model=RunResponse)
    async def get_run(run_id: str, request: Request) -> RunResponse:
        user = await require_user(request, services)
        doc = await services.database.runs.get(user["_id"], run_id)
        if doc is None:
            raise _run_not_found()
        return RunResponse(run=_run_detail(doc))

    @app.post("/api/runs/{run_id}/compile", response_model=RunCompileResponse)
    async def recompile_run(run_id: str, request: Request) -> RunCompileResponse:
        user = await require_user(request, services)
        doc = await services.database.runs.get(user["_id"], run_id)
        if doc is None:
            raise _run_not_found()
        latex_source = doc.get("latex_source", "") or ""
        if not latex_source.strip():
            raise _api_error(
                422,
                "run_has_no_latex",
                "This run has no stored LaTeX source to compile.",
            )
        result = await services.compiler.compile(
            latex_source, services.repository.assets_dir
        )
        if not result.success:
            raise compiler_failure(result)
        pdf_bytes = result.pdf_bytes or b""
        return RunCompileResponse(
            pdf_base64=base64.b64encode(pdf_bytes).decode("ascii"),
            page_count=result.page_count,
            filename="tailored-resume.pdf",
            compiler=compile_report(result),
        )

    @app.delete("/api/runs/{run_id}", response_model=OkResponse)
    async def delete_run(run_id: str, request: Request) -> OkResponse:
        user = await require_user(request, services)
        deleted = await services.database.runs.delete(user["_id"], run_id)
        if not deleted:
            raise _run_not_found()
        return OkResponse()
