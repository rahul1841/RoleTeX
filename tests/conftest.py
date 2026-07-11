"""Shared fixtures for the resume builder test suite."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Dict

import pytest

from app.resume import ResumeRepository, flattened_skills
from app.schemas import TailorProposal


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def repository() -> ResumeRepository:
    return ResumeRepository(
        data_path=PROJECT_ROOT / "resume" / "data.json",
        template_path=PROJECT_ROOT / "resume" / "template.tex",
        assets_dir=PROJECT_ROOT / "resume" / "assets",
    )


@pytest.fixture
def resume(repository: ResumeRepository):
    return repository.load_data()


@pytest.fixture
def template(repository: ResumeRepository) -> str:
    return repository.load_template()


@pytest.fixture
def raw_resume_data() -> Dict[str, Any]:
    return json.loads((PROJECT_ROOT / "resume" / "data.json").read_text(encoding="utf-8"))


@pytest.fixture
def baseline_proposal(resume) -> TailorProposal:
    return TailorProposal(
        summary=resume.summary,
        bullet_rewrites=[],
        skills_order=flattened_skills(resume),
    )


@pytest.fixture
def proposal_factory(resume) -> Callable[..., TailorProposal]:
    def factory(**overrides: Any) -> TailorProposal:
        values: Dict[str, Any] = {
            "summary": resume.summary,
            "bullet_rewrites": [],
            "skills_order": flattened_skills(resume),
        }
        values.update(overrides)
        return TailorProposal(**values)

    return factory


@pytest.fixture
def valid_job_description() -> str:
    return (
        "We are hiring a backend engineer to build reliable Python and FastAPI "
        "services, improve PostgreSQL performance, and maintain Docker delivery workflows."
    )
