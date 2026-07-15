"""Pydantic models shared by the API, resume renderer, and LLM adapter.

The project is developed on Python 3.9 while the production image uses a newer
Python release, so this module deliberately avoids newer union/type syntax.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    """Base model that rejects unexpected fields."""

    model_config = ConfigDict(extra="forbid")


def validate_model(model_class: Any, value: Any) -> Any:
    """Validate a value with either Pydantic 1 or Pydantic 2."""

    validator = getattr(model_class, "model_validate", None)
    if validator is not None:
        return validator(value)
    return model_class.parse_obj(value)


def dump_model(model: BaseModel, **kwargs: Any) -> Dict[str, Any]:
    """Serialize a model with either Pydantic 1 or Pydantic 2."""

    dumper = getattr(model, "model_dump", None)
    if dumper is not None:
        return dumper(**kwargs)
    return model.dict(**kwargs)


class ResumeLink(StrictModel):
    label: str = Field(..., min_length=1, max_length=100)
    url: str = Field(..., min_length=1, max_length=500)


class ResumeIdentity(StrictModel):
    name: str = Field(..., min_length=1, max_length=160)
    email: str = Field(..., min_length=3, max_length=254)
    phone: str = Field(..., min_length=3, max_length=80)
    location: str = Field(..., min_length=1, max_length=180)
    links: List[ResumeLink] = Field(default_factory=list, max_length=12)


class ResumeBullet(StrictModel):
    id: str = Field(..., min_length=1, max_length=120)
    text: str = Field(..., min_length=1, max_length=1000)
    # Optional evidence or project link owned by the locked resume data. The
    # model may rewrite ``text`` but can never add or modify this URL.
    link: Optional[ResumeLink] = None


class ResumeExperience(StrictModel):
    id: str = Field(..., min_length=1, max_length=120)
    company: str = Field(..., min_length=1, max_length=200)
    role: str = Field(..., min_length=1, max_length=200)
    location: str = Field(..., min_length=1, max_length=180)
    start: str = Field(..., min_length=1, max_length=80)
    end: str = Field(..., min_length=1, max_length=80)
    bullets: List[ResumeBullet] = Field(default_factory=list, max_length=30)


class ResumeProject(StrictModel):
    id: str = Field(..., min_length=1, max_length=120)
    name: str = Field(..., min_length=1, max_length=200)
    url: str = Field(default="", max_length=500)
    technologies: List[str] = Field(default_factory=list, max_length=40)
    bullets: List[ResumeBullet] = Field(default_factory=list, max_length=30)


class ResumeEducation(StrictModel):
    id: str = Field(..., min_length=1, max_length=120)
    institution: str = Field(..., min_length=1, max_length=250)
    degree: str = Field(..., min_length=1, max_length=250)
    location: str = Field(..., min_length=1, max_length=180)
    start: str = Field(..., min_length=1, max_length=80)
    end: str = Field(..., min_length=1, max_length=80)
    details: List[str] = Field(default_factory=list, max_length=20)


class ResumeSkillCategory(StrictModel):
    category: str = Field(..., min_length=1, max_length=120)
    items: List[str] = Field(..., min_length=1, max_length=100)


class ResumeData(StrictModel):
    identity: ResumeIdentity
    summary: str = Field(..., min_length=1, max_length=2000)
    experience: List[ResumeExperience] = Field(default_factory=list, max_length=30)
    projects: List[ResumeProject] = Field(default_factory=list, max_length=30)
    education: List[ResumeEducation] = Field(default_factory=list, max_length=20)
    skills: List[ResumeSkillCategory] = Field(default_factory=list, max_length=30)
    achievements: List[ResumeBullet] = Field(default_factory=list, max_length=50)


class BulletRewrite(StrictModel):
    id: str = Field(..., min_length=1, max_length=120)
    text: str = Field(..., min_length=1, max_length=600)


class TailorProposal(StrictModel):
    """Only plain text is accepted from the model; never LaTeX."""

    summary: str = Field(..., min_length=1, max_length=1000)
    bullet_rewrites: List[BulletRewrite] = Field(..., max_length=6)
    skills_order: List[str] = Field(..., max_length=300)


class TailorRequest(StrictModel):
    # Exactly one of job_description / jd_id must be provided; the route
    # enforces that pairing because model-level XOR would hide the error code.
    job_description: Optional[str] = Field(default=None, min_length=50, max_length=20_000)
    jd_id: Optional[str] = Field(default=None, min_length=1, max_length=64)
    provider: Optional[str] = Field(default=None, min_length=1, max_length=40)
    model: Optional[str] = Field(default=None, min_length=1, max_length=200)
    compile: bool = True
    require_one_page: bool = True
    # Per-user resume id. Required in multi-user mode; omitted in demo mode,
    # where the server falls back to the canonical seed resume.
    resume_id: Optional[str] = Field(default=None, min_length=1, max_length=64)
    # Multi-user mode: persist the run into tailor history (default on).
    save_run: bool = True


class ResumeStyle(StrictModel):
    """Bounded, server-validated layout hints extracted from a pasted resume.

    Only these safe parameters influence the compiled preamble; the rest of the
    template stays server-controlled so the locked-template safety model holds.
    """

    paper: str = Field(default="a4paper", max_length=20)
    font_size: str = Field(default="10pt", max_length=8)
    margin_cm: float = Field(default=2.0, ge=0.5, le=4.0)
    accent_hex: Optional[str] = Field(default=None, min_length=6, max_length=6)


class ImportRequest(StrictModel):
    latex: str = Field(..., min_length=40, max_length=200_000)
    provider: Optional[str] = Field(default=None, min_length=1, max_length=40)
    model: Optional[str] = Field(default=None, min_length=1, max_length=200)


class ImportResponse(StrictModel):
    id: str
    provider: str
    model: str
    style: ResumeStyle
    resume: ResumeData
    warnings: List[str] = Field(default_factory=list)


class ResumeChange(StrictModel):
    field_id: str
    before: str
    after: str


class CompilerReport(StrictModel):
    attempted: bool = True
    success: bool
    page_count: Optional[int] = None
    text_preview: str = ""
    warnings: List[str] = Field(default_factory=list)
    log: Optional[str] = None


class TailorResponse(StrictModel):
    proposal: TailorProposal
    changes: List[ResumeChange]
    unified_diff: str
    latex_source: str
    pdf_base64: Optional[str] = None
    pdf_data_url: Optional[str] = None
    page_count: Optional[int] = None
    filename: str = "tailored-resume.pdf"
    provider: str
    model: str
    repaired: bool = False
    warnings: List[str] = Field(default_factory=list)
    compiler: CompilerReport
    # Multi-user mode: id of the persisted tailor-history entry, when saved.
    run_id: Optional[str] = None


class HealthResponse(StrictModel):
    status: str
    version: str
    mode: str = "demo"
    provider: str
    model: str
    resume_valid: bool
    compiler_available: bool
    checks: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Multi-user API models (auth, keys, resumes, JDs, runs)
# ---------------------------------------------------------------------------


class UserOut(StrictModel):
    """Public account shape; never includes password material or key values."""

    id: str
    email: str
    name: str = ""
    default_provider: Optional[str] = None
    default_model: Optional[str] = None
    created_at: Optional[datetime] = None
    providers_with_keys: List[str] = Field(default_factory=list)


class RegisterRequest(StrictModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=1_000)
    name: str = Field(default="", max_length=160)


class LoginRequest(StrictModel):
    email: str = Field(..., min_length=1, max_length=254)
    password: str = Field(..., min_length=1, max_length=1_000)


class UpdateMeRequest(StrictModel):
    name: Optional[str] = Field(default=None, max_length=160)
    default_provider: Optional[str] = Field(default=None, max_length=40)
    default_model: Optional[str] = Field(default=None, max_length=200)


class DeleteMeRequest(StrictModel):
    password: str = Field(..., min_length=1, max_length=1_000)


class UserResponse(StrictModel):
    user: UserOut


class OkResponse(StrictModel):
    ok: bool = True


class ProviderInfo(StrictModel):
    id: str
    label: str
    default_model: str = ""
    needs_key: bool = True


class ProvidersResponse(StrictModel):
    providers: List[ProviderInfo] = Field(default_factory=list)


class KeyInfo(StrictModel):
    provider: str
    hint: str
    updated_at: Optional[datetime] = None


class KeysResponse(StrictModel):
    keys: List[KeyInfo] = Field(default_factory=list)


class PutKeyRequest(StrictModel):
    api_key: str = Field(..., min_length=8, max_length=400)


class PutKeyResponse(StrictModel):
    provider: str
    hint: str


class ResumeSummary(StrictModel):
    id: str
    name: str
    source_type: str
    version: int
    provider: str = ""
    model: str = ""
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ResumeDetail(ResumeSummary):
    style: ResumeStyle
    data: ResumeData


class ResumeListResponse(StrictModel):
    resumes: List[ResumeSummary] = Field(default_factory=list)


class ResumeCreateRequest(StrictModel):
    latex: str = Field(..., min_length=40, max_length=200_000)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    provider: Optional[str] = Field(default=None, min_length=1, max_length=40)
    model: Optional[str] = Field(default=None, min_length=1, max_length=200)


class ResumeCreateResponse(StrictModel):
    resume: ResumeDetail
    warnings: List[str] = Field(default_factory=list)


class ResumeResponse(StrictModel):
    resume: ResumeDetail


class ResumeRenameRequest(StrictModel):
    name: str = Field(..., min_length=1, max_length=120)


class ResumeVersionSummary(StrictModel):
    version: int
    source_type: str
    provider: str = ""
    model: str = ""
    created_at: Optional[datetime] = None


class ResumeVersionsResponse(StrictModel):
    versions: List[ResumeVersionSummary] = Field(default_factory=list)


class ResumeVersionSourceResponse(StrictModel):
    version: int
    source_type: str
    source_text: str = ""
    template_tex: str = ""


class JdSummary(StrictModel):
    id: str
    title: str
    version: int
    excerpt: str = ""
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class JdDetail(StrictModel):
    id: str
    title: str
    content: str
    version: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class JdListResponse(StrictModel):
    jds: List[JdSummary] = Field(default_factory=list)


class JdResponse(StrictModel):
    jd: JdDetail


class JdCreateRequest(StrictModel):
    title: str = Field(..., min_length=1, max_length=160)
    content: str = Field(..., min_length=50, max_length=20_000)


class JdUpdateRequest(StrictModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=160)
    content: Optional[str] = Field(default=None, min_length=50, max_length=20_000)


class JdVersionSummary(StrictModel):
    version: int
    title: str = ""
    excerpt: str = ""
    created_at: Optional[datetime] = None


class JdVersionsResponse(StrictModel):
    versions: List[JdVersionSummary] = Field(default_factory=list)


class RunSummary(StrictModel):
    id: str
    created_at: Optional[datetime] = None
    resume_id: str = ""
    resume_name: str = ""
    resume_version: int = 0
    jd_id: Optional[str] = None
    jd_title: Optional[str] = None
    jd_excerpt: str = ""
    provider: str = ""
    model: str = ""
    page_count: Optional[int] = None
    repaired: bool = False


class RunDetail(RunSummary):
    proposal: Optional[TailorProposal] = None
    changes: List[ResumeChange] = Field(default_factory=list)
    unified_diff: str = ""
    latex_source: str = ""
    warnings: List[str] = Field(default_factory=list)


class RunListResponse(StrictModel):
    runs: List[RunSummary] = Field(default_factory=list)


class RunResponse(StrictModel):
    run: RunDetail


class RunCompileResponse(StrictModel):
    pdf_base64: str
    page_count: Optional[int] = None
    filename: str = "tailored-resume.pdf"
    compiler: CompilerReport
