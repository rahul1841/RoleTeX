"""Deterministic offline LLM for local development without a provider key.

The real client (:class:`app.llm.OpenAICompatibleLLM`) needs a provider key and
spends tokens on every call, which makes two of the product's flows — resume
import and tailoring — impossible to iterate on locally. This module restores
the offline path that ``LLM_PROVIDER=mock`` used to provide, without putting
fixture data back into the production client.

Selected by ``LLM_PROVIDER=stub``. It is wired in :func:`app.main.create_app`,
so nothing here runs unless that value is set explicitly.

Every method is deterministic: the same input always yields the same output, so
a developer sees a stable UI between reloads. No network, no filesystem, no
clock.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from app.llm import LLMExtractResult, LLMResult
from app.resume import flattened_skills
from app.schemas import BulletRewrite, ResumeData, TailorProposal, dump_model

# Marks generated copy as stub output. Visible in the UI on purpose: a developer
# must never mistake offline fixture text for a real model's tailoring.
STUB_MARKER = "[stub]"

STUB_MODEL = "stub-model"
STUB_PROVIDER = "stub"

# Bounded by TailorProposal.bullet_rewrites (max_length=6).
MAX_STUB_REWRITES = 2


def mock_extraction(source: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Deterministic import extraction so the PDF/LaTeX flow works offline.

    Returns raw dicts, matching the real ``extract_resume`` contract: the
    importer owns ID assignment, style clamping, and schema validation.
    """

    resume = {
        "identity": {
            "name": "Imported User",
            "email": "imported.user@example.com",
            "phone": "+1 000 000 0000",
            "location": "Remote",
            "links": [],
        },
        "summary": "Engineer imported in deterministic stub mode",
        "experience": [
            {
                "company": "Example Corp",
                "role": "Software Engineer",
                "location": "Remote",
                "start": "2022",
                "end": "Present",
                "bullets": [
                    "Built and shipped backend services in Python.",
                    "Improved reliability of production systems.",
                ],
            }
        ],
        "projects": [],
        "education": [
            {
                "institution": "Example University",
                "degree": "B.Tech, Computer Science",
                "location": "Remote",
                "start": "2018",
                "end": "2022",
                "details": [],
            }
        ],
        "skills": [{"category": "Programming", "items": ["Python", "SQL"]}],
        "achievements": [],
    }
    style = {
        "paper": "a4paper",
        "font_size": "10pt",
        "margin_cm": 2.0,
        "accent_hex": None,
    }
    return resume, style


def _first_bullet_ids(resume: ResumeData, limit: int) -> List[Tuple[str, str]]:
    """The first ``limit`` (id, text) bullet pairs in document order.

    Experience is walked before projects because a tailored resume's leading
    bullets are the ones a reviewer reads first.
    """

    pairs: List[Tuple[str, str]] = []
    for entry in resume.experience:
        for bullet in entry.bullets:
            if len(pairs) >= limit:
                return pairs
            pairs.append((bullet.id, bullet.text))
    for project in resume.projects:
        for bullet in project.bullets:
            if len(pairs) >= limit:
                return pairs
            pairs.append((bullet.id, bullet.text))
    return pairs


def _stub_proposal(resume: ResumeData, job_description: str) -> TailorProposal:
    """A proposal that visibly differs from the input so the diff UI has content.

    The change list and unified diff are a product requirement (rules.md R-14),
    so an identity proposal would leave the review step untestable.
    """

    # Deterministic, bounded, and never echoed into LaTeX unescaped — the
    # renderer escapes proposal text exactly as it does model output.
    keyword = " ".join(job_description.split()[:4]).strip() or "the role"

    summary = f"{STUB_MARKER} Tailored for {keyword}. {resume.summary}".strip()
    # TailorProposal.summary caps at 1000 characters.
    summary = summary[:1000]

    rewrites = [
        BulletRewrite(id=bullet_id, text=f"{STUB_MARKER} {text}"[:600])
        for bullet_id, text in _first_bullet_ids(resume, MAX_STUB_REWRITES)
    ]

    # Rank by how often the skill is named in the job description, most-cited
    # first. Deterministic (no RNG), and it reorders for the *right* reason —
    # a plain reversal produces an order with no relationship to the JD, which
    # makes the tailoring and diff UI impossible to evaluate locally.
    # Python's sort is stable, so equally-cited skills keep resume order.
    haystack = job_description.lower()
    skills = sorted(
        flattened_skills(resume), key=lambda skill: -haystack.count(skill.lower())
    )

    return TailorProposal(
        summary=summary, bullet_rewrites=rewrites, skills_order=skills
    )


class StubLLM:
    """Offline stand-in for :class:`app.llm.OpenAICompatibleLLM`.

    Implements the three methods the routes call. Provider/model overrides are
    accepted and echoed back so per-user provider selection stays observable,
    but no key is ever required or validated.
    """

    def __init__(self) -> None:
        # Mirrors the real client's constructor arity so create_app can swap
        # one for the other without a special case.
        pass

    @property
    def configured_provider(self) -> str:
        return STUB_PROVIDER

    async def generate(
        self,
        resume: ResumeData,
        job_description: str,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> LLMResult:
        proposal = _stub_proposal(resume, job_description)
        raw = json.dumps(dump_model(proposal))
        return LLMResult(
            proposal, provider or STUB_PROVIDER, model or STUB_MODEL, raw
        )

    async def repair(
        self,
        resume: ResumeData,
        job_description: str,
        issue: str,
        previous_output: str,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> LLMResult:
        # The repair path exists to shorten an overlong resume. Dropping the
        # rewrites is the smallest deterministic response that shrinks output.
        base = _stub_proposal(resume, job_description)
        proposal = TailorProposal(
            summary=base.summary,
            bullet_rewrites=[],
            skills_order=base.skills_order,
        )
        raw = json.dumps(dump_model(proposal))
        return LLMResult(
            proposal, provider or STUB_PROVIDER, model or STUB_MODEL, raw
        )

    async def extract_resume(
        self,
        source: str,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        source_kind: str = "latex",
        images: Optional[Sequence[bytes]] = None,
        links: Optional[Sequence[Mapping[str, str]]] = None,
    ) -> LLMExtractResult:
        # ``images``/``links`` are accepted and ignored: the extraction is a
        # fixture, so there is nothing to read them for. They must still be in
        # the signature — backend/app/routes_resumes.py passes them for every non-LaTeX
        # import, and a vision-capable provider upgrades "text" to
        # "text_and_image", so omitting them 500s the whole PDF import path.
        resume, style = mock_extraction(source)
        return LLMExtractResult(
            resume, style, provider or STUB_PROVIDER, model or STUB_MODEL, "{}"
        )
