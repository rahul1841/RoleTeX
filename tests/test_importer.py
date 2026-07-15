"""Tests for LaTeX-extraction normalization, style clamping, and assembly."""

from __future__ import annotations

import pytest

from app.importer import (
    ALLOWED_FONT_SIZE,
    assemble_template,
    build_resume_data,
    clamp_headline,
    normalize_extracted_resume,
    sanitize_style,
)
from app.resume import (
    REQUIRED_TEMPLATE_TOKENS,
    ResumeError,
    all_bullets,
    flattened_skills,
    render_template_text,
    validate_template,
)
from app.schemas import TailorProposal


def _minimal_extraction() -> dict:
    return {
        "identity": {
            "name": "Jane Doe",
            "email": "jane@example.com",
            "phone": "+1 555 000 1111",
            "location": "Berlin",
            "links": [
                {"label": "GitHub", "url": "https://github.com/jane"},
                {"label": "Bad", "url": "javascript:alert(1)"},
            ],
        },
        "summary": "  Backend   engineer building reliable data services at scale ",
        "experience": [
            {
                "company": "Acme",
                "role": "Engineer",
                "location": "Remote",
                "start": "2021",
                "end": "Present",
                "bullets": ["Built services", {"text": "Cut latency"}, "  "],
            }
        ],
        "projects": [],
        "education": [
            {
                "institution": "Uni",
                "degree": "BSc CS",
                "location": "Berlin",
                "start": "2017",
                "end": "2021",
                "details": [],
            }
        ],
        "skills": [{"category": "Programming", "items": ["Python", "Go", ""]}],
        "achievements": ["Won hackathon"],
    }


def test_clamp_headline_enforces_word_and_char_limits() -> None:
    assert clamp_headline("one two three four five six seven eight nine ten eleven twelve thirteen").split() == [
        "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"
    ]
    assert clamp_headline("   ") == "Professional summary"
    assert len(clamp_headline("x" * 400)) <= 120


@pytest.mark.parametrize(
    ("raw", "expected_paper", "expected_font", "expected_accent"),
    [
        ({"paper": "letterpaper", "font_size": "12pt", "accent_hex": "#1a2B3c"}, "letterpaper", "12pt", "1A2B3C"),
        ({"paper": "junk", "font_size": "99pt", "accent_hex": "nothex"}, "a4paper", "10pt", None),
        ({}, "a4paper", "10pt", None),
    ],
)
def test_sanitize_style_whitelists_every_value(raw, expected_paper, expected_font, expected_accent) -> None:
    style = sanitize_style(raw)
    assert style.paper == expected_paper
    assert style.font_size == expected_font
    assert style.font_size in ALLOWED_FONT_SIZE
    assert style.accent_hex == expected_accent


def test_sanitize_style_clamps_margin_to_safe_range() -> None:
    assert sanitize_style({"margin_cm": 99}).margin_cm == 3.0
    assert sanitize_style({"margin_cm": 0}).margin_cm == 1.0
    assert sanitize_style({"margin_cm": "not-a-number"}).margin_cm == 2.0


def test_normalize_assigns_unique_ids_and_drops_bad_data() -> None:
    normalized = normalize_extracted_resume(_minimal_extraction())

    # Unsafe link dropped, blank bullet/skill removed.
    assert [link["label"] for link in normalized["identity"]["links"]] == ["GitHub"]
    assert [b["text"] for b in normalized["experience"][0]["bullets"]] == ["Built services", "Cut latency"]
    assert normalized["skills"][0]["items"] == ["Python", "Go"]

    resume = build_resume_data(_minimal_extraction())
    section_ids = [e.id for e in resume.experience] + [e.id for e in resume.education]
    bullet_ids = list(all_bullets(resume))
    assert len(section_ids) == len(set(section_ids))
    assert len(bullet_ids) == len(set(bullet_ids))
    assert set(section_ids).isdisjoint(bullet_ids)


def test_build_resume_data_condenses_summary_into_headline() -> None:
    resume = build_resume_data(_minimal_extraction())
    assert resume.summary == "Backend engineer building reliable data services at scale"
    assert len(resume.summary.split()) <= 12


def test_assembled_template_is_valid_and_reflects_style() -> None:
    template = assemble_template(sanitize_style({"paper": "letterpaper", "font_size": "12pt", "accent_hex": "112233"}))
    validate_template(template)
    for token in REQUIRED_TEMPLATE_TOKENS:
        assert template.count(token) == 1
    assert r"\documentclass[letterpaper,12pt]{article}" in template
    assert r"\definecolor{ResumeAccentColor}{HTML}{112233}" in template


def test_sectioned_render_collapses_absent_sections() -> None:
    extraction = _minimal_extraction()
    extraction["projects"] = []
    extraction["achievements"] = []
    resume = build_resume_data(extraction)
    template = assemble_template(sanitize_style({}))
    proposal = TailorProposal(
        summary=resume.summary, bullet_rewrites=[], skills_order=flattened_skills(resume)
    )

    rendered = render_template_text(template, resume, proposal, sectioned=True)

    assert not any(token in rendered for token in REQUIRED_TEMPLATE_TOKENS)
    assert r"\header{Education}" in rendered
    assert r"\header{Experience}" in rendered
    assert r"\header{Skills}" in rendered
    # Empty sections leave no header behind.
    assert r"\header{Projects}" not in rendered
    assert r"\header{Achievements}" not in rendered
    assert resume.identity.email in rendered


def test_import_rejects_resume_missing_required_identity() -> None:
    broken = _minimal_extraction()
    broken["identity"]["email"] = ""

    with pytest.raises(Exception):
        # Missing email violates the schema (min_length 3).
        build_resume_data(broken)
