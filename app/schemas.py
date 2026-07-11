"""Pydantic models shared by the API, resume renderer, and LLM adapter.

The project is developed on Python 3.9 while the production image uses a newer
Python release, so this module deliberately avoids newer union/type syntax.
"""

from __future__ import annotations

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
    job_description: str = Field(..., min_length=50, max_length=20_000)
    provider: Optional[str] = Field(default=None, min_length=1, max_length=40)
    model: Optional[str] = Field(default=None, min_length=1, max_length=200)
    compile: bool = True
    require_one_page: bool = True


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


class HealthResponse(StrictModel):
    status: str
    version: str
    provider: str
    model: str
    resume_valid: bool
    compiler_available: bool
    checks: Dict[str, Any] = Field(default_factory=dict)
