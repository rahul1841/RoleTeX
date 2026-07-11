"""Tests for authoritative resume data, proposal safety, and rendering."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict

import pytest

from app.resume import (
    MAX_BULLET_CHARACTERS,
    MAX_BULLET_WORDS,
    MAX_SUMMARY_CHARACTERS,
    MAX_SUMMARY_WORDS,
    REQUIRED_TEMPLATE_TOKENS,
    ProposalValidationError,
    ResumeError,
    all_bullets,
    build_change_list,
    build_llm_resume_payload,
    build_unified_diff,
    escape_latex,
    flattened_skills,
    load_resume_data,
    ordered_skill_categories,
    redact_identity,
    render_template_text,
    validate_proposal,
    validate_template,
)
from app.schemas import BulletRewrite, ResumeData, TailorProposal, validate_model


def _write_json(path: Path, value: Dict[str, Any]) -> Path:
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def _unsafe_construct(model_class, **values: Any):
    constructor = getattr(model_class, "model_construct", None)
    if constructor is not None:
        return constructor(**values)
    return model_class.construct(**values)


def test_repository_loads_canonical_data_with_globally_unique_stable_ids(repository) -> None:
    resume, template = repository.load()

    section_ids = [item.id for item in resume.experience]
    section_ids += [item.id for item in resume.projects]
    section_ids += [item.id for item in resume.education]
    bullet_ids = list(all_bullets(resume))

    assert section_ids
    assert bullet_ids
    assert len(section_ids) == len(set(section_ids))
    assert len(bullet_ids) == len(set(bullet_ids))
    assert set(section_ids).isdisjoint(bullet_ids)
    assert template.startswith("% This template is immutable application code.")


@pytest.mark.parametrize(
    ("mutation", "expected_message"),
    [
        ("duplicate_section", "duplicate section IDs"),
        ("duplicate_bullet", "duplicate bullet IDs"),
        ("section_bullet_overlap", "IDs reused by sections and bullets"),
    ],
)
def test_resume_loader_rejects_non_unique_ids(
    tmp_path: Path,
    raw_resume_data: Dict[str, Any],
    mutation: str,
    expected_message: str,
) -> None:
    if mutation == "duplicate_section":
        raw_resume_data["projects"][0]["id"] = raw_resume_data["experience"][0]["id"]
    elif mutation == "duplicate_bullet":
        raw_resume_data["projects"][0]["bullets"][0]["id"] = (
            raw_resume_data["experience"][0]["bullets"][0]["id"]
        )
    else:
        raw_resume_data["projects"][0]["id"] = (
            raw_resume_data["experience"][0]["bullets"][0]["id"]
        )

    with pytest.raises(ResumeError, match=expected_message):
        load_resume_data(_write_json(tmp_path / "resume.json", raw_resume_data))


def test_resume_loader_wraps_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / "resume.json"
    path.write_text("{not-json", encoding="utf-8")

    with pytest.raises(ResumeError, match="not valid JSON"):
        load_resume_data(path)


def test_resume_loader_rejects_unknown_schema_fields(
    tmp_path: Path, raw_resume_data: Dict[str, Any]
) -> None:
    raw_resume_data["identity"]["secret"] = "must not be accepted"

    with pytest.raises(ResumeError, match="required schema"):
        load_resume_data(_write_json(tmp_path / "resume.json", raw_resume_data))


def test_template_requires_each_locked_token_exactly_once(template: str) -> None:
    validate_template(template)

    for token in REQUIRED_TEMPLATE_TOKENS:
        assert template.count(token) == 1

    with pytest.raises(ResumeError, match="must appear exactly once"):
        validate_template(template.replace("@@SUMMARY@@", ""))
    with pytest.raises(ResumeError, match="must appear exactly once"):
        validate_template(template.replace("@@SUMMARY@@", "@@SUMMARY@@@@SUMMARY@@"))


def test_template_rejects_unknown_locked_tokens(template: str) -> None:
    with pytest.raises(ResumeError, match="unknown locked-template tokens"):
        validate_template(template + "\n@@UNAPPROVED_SLOT@@\n")


def test_llm_payload_omits_the_entire_identity_block(raw_resume_data: Dict[str, Any]) -> None:
    raw_resume_data["identity"] = {
        "name": "PII-NAME-9f24",
        "email": "pii-email-9f24@example.invalid",
        "phone": "+99-PII-PHONE-9f24",
        "location": "PII-LOCATION-9f24",
        "links": [{"label": "PII-LABEL-9f24", "url": "https://pii-link-9f24.invalid"}],
    }
    resume = validate_model(ResumeData, raw_resume_data)

    payload = build_llm_resume_payload(resume)
    serialized = json.dumps(payload, sort_keys=True)

    assert "identity" not in payload
    for marker in (
        "PII-NAME-9f24",
        "pii-email-9f24",
        "PII-PHONE-9f24",
        "PII-LOCATION-9f24",
        "PII-LABEL-9f24",
        "pii-link-9f24",
    ):
        assert marker not in serialized


def test_identity_redaction_covers_raw_case_variants_and_latex_forms(resume) -> None:
    identity = resume.identity
    raw_values = [
        identity.name,
        identity.email,
        identity.phone,
        identity.location,
        identity.links[0].label,
        identity.links[0].url,
        "mailto:" + identity.email,
        "tel:" + "".join(character for character in identity.phone if character.isdigit() or character == "+"),
    ]
    diagnostic = "\n".join(raw_values + [escape_latex(value) for value in raw_values])
    diagnostic += "\n" + identity.name.swapcase()

    redacted = redact_identity(diagnostic, resume)

    assert "[REDACTED_IDENTITY]" in redacted
    lowered = redacted.casefold()
    for value in raw_values:
        assert value.casefold() not in lowered
        assert escape_latex(value).casefold() not in lowered


def test_valid_proposal_allows_reordering_and_reusing_existing_metrics(
    resume, proposal_factory
) -> None:
    bullet_id = resume.experience[0].bullets[1].id
    proposal = proposal_factory(
        summary="Python engineer experienced with reliable backend delivery.",
        bullet_rewrites=[
            {
                "id": bullet_id,
                "text": "Built a secure MCP layer supporting 100+ MCP connectors.",
            }
        ],
        skills_order=list(reversed(flattened_skills(resume))),
    )

    assert validate_proposal(resume, proposal) is proposal


def test_education_details_and_linked_achievements_are_preserved(
    resume, template, baseline_proposal
) -> None:
    rendered = render_template_text(template, resume, baseline_proposal)
    llm_payload = json.dumps(build_llm_resume_payload(resume), sort_keys=True)

    assert r"CGPA: 8.0" in rendered
    assert "achievement_neuro_nest_winner" in all_bullets(resume)
    assert r"1XkO\_gSIDdYulrDEsYwnQ3lQfy07AEG0K" in rendered
    assert r"drive\_link" in rendered
    assert "GL Bajaj Institute of Technology and Management" in rendered
    assert "achievement_neuro_nest_winner" in llm_payload
    assert "drive.google.com" not in llm_payload


def test_proposal_rejects_unknown_and_duplicate_bullet_ids(resume, proposal_factory) -> None:
    known_id = resume.experience[0].bullets[0].id
    proposal = proposal_factory(
        bullet_rewrites=[
            {"id": known_id, "text": "Built Python services."},
            {"id": known_id, "text": "Maintained Python services."},
            {"id": "unknown_bullet", "text": "Invented work."},
        ]
    )

    with pytest.raises(ProposalValidationError) as captured:
        validate_proposal(resume, proposal)

    assert any("duplicate bullet rewrite IDs" in error for error in captured.value.errors)
    assert any("unknown bullet IDs" in error for error in captured.value.errors)


@pytest.mark.parametrize(
    "skills_order",
    [
        lambda values: values[:-1],
        lambda values: values[:-1] + ["Invented Framework"],
        lambda values: values[:-1] + [values[0]],
    ],
)
def test_proposal_rejects_any_non_permutation_of_skills(
    resume, proposal_factory, skills_order
) -> None:
    original = flattened_skills(resume)
    proposal = proposal_factory(skills_order=skills_order(original))

    with pytest.raises(ProposalValidationError) as captured:
        validate_proposal(resume, proposal)

    assert any("skills_order" in error for error in captured.value.errors)


def test_ordered_skills_preserve_category_membership(resume) -> None:
    proposed_order = list(reversed(flattened_skills(resume)))
    result = ordered_skill_categories(resume.skills, proposed_order)

    original_membership = {
        item: category.category for category in resume.skills for item in category.items
    }
    rendered_membership = {
        item: category for category, items in result for item in items
    }
    assert rendered_membership == original_membership
    assert Counter(item for _, items in result for item in items) == Counter(proposed_order)


def test_proposal_rejects_new_numeric_claims_in_summary_and_bullets(
    resume, proposal_factory
) -> None:
    bullet_id = resume.experience[0].bullets[0].id
    proposal = proposal_factory(
        summary="Delivered 999 new systems.",
        bullet_rewrites=[
            {"id": bullet_id, "text": "Built services for 600,000 application events per day."}
        ],
    )

    with pytest.raises(ProposalValidationError) as captured:
        validate_proposal(resume, proposal)

    assert any("summary introduces numeric claims" in error for error in captured.value.errors)
    assert any("introduces numeric claims absent from its source" in error for error in captured.value.errors)


def test_proposal_enforces_summary_and_bullet_word_limits(resume, proposal_factory) -> None:
    bullet_id = resume.experience[0].bullets[0].id
    proposal = proposal_factory(
        summary="word " * (MAX_SUMMARY_WORDS + 1),
        bullet_rewrites=[
            {"id": bullet_id, "text": "word " * (MAX_BULLET_WORDS + 1)}
        ],
    )

    with pytest.raises(ProposalValidationError) as captured:
        validate_proposal(resume, proposal)

    assert any("summary exceeds" in error for error in captured.value.errors)
    assert any("bullet {0} exceeds {1} words".format(bullet_id, MAX_BULLET_WORDS) in error for error in captured.value.errors)


def test_proposal_keeps_headline_single_line_and_prevents_bullet_growth(
    resume, proposal_factory
) -> None:
    bullet = resume.experience[0].bullets[0]
    proposal = proposal_factory(
        summary="x" * (MAX_SUMMARY_CHARACTERS + 1),
        bullet_rewrites=[
            {
                "id": bullet.id,
                "text": bullet.text
                + " Added unsupported padding that makes this rewrite substantially too long.",
            }
        ],
    )

    with pytest.raises(ProposalValidationError) as captured:
        validate_proposal(resume, proposal)

    assert any("summary exceeds" in error and "characters" in error for error in captured.value.errors)
    assert any("source-length allowance" in error for error in captured.value.errors)


def test_proposal_domain_validation_enforces_bullet_character_limit(
    resume, baseline_proposal
) -> None:
    bullet_id = resume.experience[0].bullets[0].id
    rewrite = _unsafe_construct(
        BulletRewrite, id=bullet_id, text="x" * (MAX_BULLET_CHARACTERS + 1)
    )
    proposal = _unsafe_construct(
        TailorProposal,
        summary=resume.summary,
        bullet_rewrites=[rewrite],
        skills_order=flattened_skills(resume),
    )

    with pytest.raises(ProposalValidationError) as captured:
        validate_proposal(resume, proposal)

    assert any("exceeds {0} characters".format(MAX_BULLET_CHARACTERS) in error for error in captured.value.errors)


def test_latex_escaping_covers_metacharacters_and_normalizes_controls() -> None:
    escaped = escape_latex("A\\B {C} $5 & 10% #1_under~roof^power\n next\x00")

    for fragment in (
        r"\textbackslash{}",
        r"\{C\}",
        r"\$5",
        r"\&",
        r"10\%",
        r"\#1\_under",
        r"\textasciitilde{}",
        r"\textasciicircum{}",
    ):
        assert fragment in escaped
    assert "\n" not in escaped
    assert "\x00" not in escaped


def test_rendering_is_deterministic_escapes_edits_and_leaves_no_tokens(
    resume, template, proposal_factory
) -> None:
    bullet = resume.projects[0].bullets[0]
    proposal = proposal_factory(
        summary="Backend engineer focused on Python & platform_reliability.",
        bullet_rewrites=[
            {"id": bullet.id, "text": "Built safe schema validation & locked_template merging."}
        ],
        skills_order=list(reversed(flattened_skills(resume))),
    )

    first = render_template_text(template, resume, proposal)
    second = render_template_text(template, resume, proposal)

    assert first == second
    assert not any(token in first for token in REQUIRED_TEMPLATE_TOKENS)
    assert "@@" not in first
    assert r"Python \& platform\_reliability" in first
    assert r"validation \& locked\_template" in first
    assert resume.identity.email in first
    assert "% PROTECTED_PREAMBLE_START" in first
    assert "% PROTECTED_PREAMBLE_END" in first


def test_rendering_rejects_placeholder_shaped_text_in_editable_content(
    resume, template, proposal_factory
) -> None:
    proposal = proposal_factory(summary="Backend engineer @@UNRESOLVED@@")

    with pytest.raises(ResumeError, match="unresolved template tokens"):
        render_template_text(template, resume, proposal)


def test_change_list_and_diff_only_include_material_changes(resume, proposal_factory) -> None:
    bullet = resume.projects[0].bullets[0]
    proposal = proposal_factory(
        summary="Backend engineer specializing in reliable Python services.",
        bullet_rewrites=[{"id": bullet.id, "text": "Built a safe resume tailoring workflow."}],
    )

    changes = build_change_list(resume, proposal)
    unified = build_unified_diff(changes)

    assert [change.field_id for change in changes] == ["summary", bullet.id]
    assert "--- original" in unified
    assert "+++ tailored" in unified
    assert "[summary]" in unified
    assert "[{0}]".format(bullet.id) in unified
