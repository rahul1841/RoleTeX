"""Tests for UUID-keyed per-user resume storage."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.importer import assemble_template, build_resume_data, sanitize_style
from app.storage import ResumeStoreError, UserResumeStore


def _sample_resume():
    return build_resume_data(
        {
            "identity": {
                "name": "Jane Doe",
                "email": "jane@example.com",
                "phone": "+1 555 000 1111",
                "location": "Berlin",
                "links": [],
            },
            "summary": "Backend engineer building reliable services",
            "experience": [
                {
                    "company": "Acme",
                    "role": "Engineer",
                    "location": "Remote",
                    "start": "2021",
                    "end": "Present",
                    "bullets": ["Built services in Python."],
                }
            ],
            "projects": [],
            "education": [],
            "skills": [{"category": "Programming", "items": ["Python"]}],
            "achievements": [],
        }
    )


def test_create_then_load_round_trips(tmp_path: Path) -> None:
    store = UserResumeStore(base_dir=tmp_path)
    resume = _sample_resume()
    style = sanitize_style({"font_size": "11pt"})
    template = assemble_template(style)

    resume_id = store.create(resume, template, r"\documentclass{article}...", style, "mock", "local")

    assert store.exists(resume_id)
    loaded_resume, loaded_template = store.load(resume_id)
    assert loaded_resume.identity.email == "jane@example.com"
    assert loaded_template == template

    meta = store.load_meta(resume_id)
    assert meta["provider"] == "mock"
    assert meta["style"]["font_size"] == "11pt"

    files = {p.name for p in (tmp_path / resume_id).iterdir()}
    assert files == {"data.json", "template.tex", "source.tex", "meta.json"}


@pytest.mark.parametrize("bad_id", ["../etc/passwd", "not-a-uuid", "", "a/b", "..", "x" * 40])
def test_invalid_ids_are_rejected_without_touching_the_filesystem(tmp_path: Path, bad_id: str) -> None:
    store = UserResumeStore(base_dir=tmp_path)
    assert store.exists(bad_id) is False
    with pytest.raises(ResumeStoreError):
        store.load(bad_id)


def test_load_missing_profile_raises(tmp_path: Path) -> None:
    import uuid

    store = UserResumeStore(base_dir=tmp_path)
    with pytest.raises(ResumeStoreError):
        store.load(uuid.uuid4().hex)


def test_create_rejects_oversized_source(tmp_path: Path) -> None:
    store = UserResumeStore(base_dir=tmp_path)
    resume = _sample_resume()
    style = sanitize_style({})
    template = assemble_template(style)

    with pytest.raises(ResumeStoreError, match="source exceeds"):
        store.create(resume, template, "x" * 500_000, style, "mock", "local")
