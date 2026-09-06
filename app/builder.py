"""User-authored resume drafts: the manual-entry trust boundary.

``app/importer.py`` turns an LLM's reading of a pasted document into storable
facts. This module does the same job for the other authoring path — a person
filling in the browser editor — and keeps the identical guarantees: the server
assigns every stable ID, the compiled template is assembled from bounded style
values only, and no caller-supplied text reaches LaTeX unescaped. Normalization
is literally the importer's, so both paths converge on one shape.

What differs is the audience for a failure. An extraction that misses a field
is the model's problem, reported as ``invalid_extraction``; a form submitted
with an empty name is a person's problem, so the errors here are field-addressed
sentences a UI can show verbatim. They name the field, never the submitted value
(rule R-10).
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from pydantic import ValidationError

from .importer import assemble_template, normalize_extracted_resume, sanitize_style
from .resume import (
    MAX_SUMMARY_CHARACTERS,
    MAX_SUMMARY_WORDS,
    ProposalValidationError,
    ResumeError,
    flattened_skills,
    render_template_text,
)
from .schemas import ResumeData, ResumeStyle, TailorProposal, validate_model


#: Mirrors ``ResumeBullet.text``; applied to the free-text lists the editor
#: collects as plain strings, which carry no per-item cap of their own.
MAX_TEXT_ITEM_CHARACTERS = 1_000
#: Short list items (technologies, education details, skill names).
MAX_SHORT_ITEM_CHARACTERS = 200
MAX_REPORTED_ERRORS = 20

_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ResumeDraftError(ValueError):
    """Raised when a user-authored draft cannot become a valid resume."""

    def __init__(self, errors: Sequence[str]) -> None:
        self.errors = list(errors)[:MAX_REPORTED_ERRORS]
        super().__init__("; ".join(self.errors) or "The resume draft is incomplete")


# --- reading helpers --------------------------------------------------------


def _text(value: Any) -> str:
    return str(value or "").strip()


def _mapping(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _sequence(value: Any) -> List[Any]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        return []
    return list(value)


def _texts(value: Any) -> List[str]:
    return [_text(item) for item in _sequence(value) if _text(item)]


def _is_http_url(value: str) -> bool:
    return value.lower().startswith(("http://", "https://"))


# --- validation -------------------------------------------------------------


def _check_required(value: str, label: str, errors: List[str]) -> None:
    if not value:
        errors.append("{0} is required.".format(label))


def _check_items(
    items: Sequence[str], label: str, maximum: int, errors: List[str]
) -> None:
    for index, item in enumerate(items, start=1):
        if len(item) > maximum:
            errors.append(
                "{0} {1} is longer than {2} characters.".format(label, index, maximum)
            )


def _entry_is_blank(values: Sequence[str], *lists: Sequence[str]) -> bool:
    """A row the user added but never filled in — dropped rather than rejected."""

    if any(values):
        return False
    return not any(any(entries) for entries in lists)


def _validate_identity(identity: Mapping[str, Any], errors: List[str]) -> None:
    _check_required(_text(identity.get("name")), "Your name", errors)
    email = _text(identity.get("email"))
    _check_required(email, "Your email address", errors)
    if email and not _EMAIL_PATTERN.match(email):
        errors.append("Your email address does not look like an email address.")
    _check_required(_text(identity.get("phone")), "Your phone number", errors)
    _check_required(_text(identity.get("location")), "Your location", errors)

    for index, raw in enumerate(_sequence(identity.get("links")), start=1):
        link = _mapping(raw)
        label = _text(link.get("label"))
        url = _text(link.get("url"))
        if not label and not url:
            continue
        if not label:
            errors.append("Link {0} needs a label.".format(index))
        if not url:
            errors.append("Link {0} needs a web address.".format(index))
        elif not _is_http_url(url):
            errors.append(
                "Link {0} must be a full http:// or https:// address.".format(index)
            )


def _validate_headline(summary: str, errors: List[str]) -> None:
    if not summary:
        errors.append(
            "A headline is required — one short line describing you, shown under "
            "your name."
        )
        return
    if len(summary.split()) > MAX_SUMMARY_WORDS:
        errors.append(
            "The headline is longer than {0} words; it has to fit on one line "
            "under your name.".format(MAX_SUMMARY_WORDS)
        )
    if len(summary) > MAX_SUMMARY_CHARACTERS:
        errors.append(
            "The headline is longer than {0} characters.".format(MAX_SUMMARY_CHARACTERS)
        )


def _validate_experience(entries: Sequence[Any], errors: List[str]) -> None:
    for index, raw in enumerate(entries, start=1):
        item = _mapping(raw)
        role = _text(item.get("role"))
        company = _text(item.get("company"))
        location = _text(item.get("location"))
        start = _text(item.get("start"))
        end = _text(item.get("end"))
        bullets = _texts(item.get("bullets"))
        if _entry_is_blank([role, company, location, start, end], bullets):
            continue
        label = "Experience {0}".format(index)
        _check_required(role, label + ": job title", errors)
        _check_required(company, label + ": company", errors)
        _check_required(location, label + ": location", errors)
        _check_required(start, label + ": start date", errors)
        _check_required(end, label + ": end date", errors)
        _check_items(bullets, label + ", bullet", MAX_TEXT_ITEM_CHARACTERS, errors)


def _validate_projects(entries: Sequence[Any], errors: List[str]) -> None:
    for index, raw in enumerate(entries, start=1):
        item = _mapping(raw)
        name = _text(item.get("name"))
        url = _text(item.get("url"))
        technologies = _texts(item.get("technologies"))
        bullets = _texts(item.get("bullets"))
        if _entry_is_blank([name, url], technologies, bullets):
            continue
        label = "Project {0}".format(index)
        _check_required(name, label + ": name", errors)
        if url and not _is_http_url(url):
            errors.append(
                "{0}: the link must be a full http:// or https:// address.".format(label)
            )
        _check_items(
            technologies, label + ", technology", MAX_SHORT_ITEM_CHARACTERS, errors
        )
        _check_items(bullets, label + ", bullet", MAX_TEXT_ITEM_CHARACTERS, errors)


def _validate_education(entries: Sequence[Any], errors: List[str]) -> None:
    for index, raw in enumerate(entries, start=1):
        item = _mapping(raw)
        institution = _text(item.get("institution"))
        degree = _text(item.get("degree"))
        location = _text(item.get("location"))
        start = _text(item.get("start"))
        end = _text(item.get("end"))
        details = _texts(item.get("details"))
        if _entry_is_blank([institution, degree, location, start, end], details):
            continue
        label = "Education {0}".format(index)
        _check_required(institution, label + ": school", errors)
        _check_required(degree, label + ": degree", errors)
        _check_required(location, label + ": location", errors)
        _check_required(start, label + ": start date", errors)
        _check_required(end, label + ": end date", errors)
        _check_items(details, label + ", detail", MAX_SHORT_ITEM_CHARACTERS, errors)


def _validate_skills(entries: Sequence[Any], errors: List[str]) -> None:
    for index, raw in enumerate(entries, start=1):
        item = _mapping(raw)
        category = _text(item.get("category"))
        items = _texts(item.get("items"))
        if _entry_is_blank([category], items):
            continue
        label = "Skill group {0}".format(index)
        _check_required(category, label + ": group name", errors)
        if not items:
            errors.append("{0} needs at least one skill.".format(label))
        _check_items(items, label + ", skill", MAX_SHORT_ITEM_CHARACTERS, errors)


def _has_content(draft: Mapping[str, Any]) -> bool:
    pruned = prune_draft(draft)
    return any(
        pruned.get(section)
        for section in ("experience", "projects", "education", "skills", "achievements")
    )


def validate_draft(draft: Mapping[str, Any]) -> List[str]:
    """Field-addressed reasons this draft cannot be saved, in reading order."""

    errors: List[str] = []
    _validate_identity(_mapping(draft.get("identity")), errors)
    _validate_headline(_text(draft.get("summary")), errors)
    _validate_experience(_sequence(draft.get("experience")), errors)
    _validate_projects(_sequence(draft.get("projects")), errors)
    _validate_education(_sequence(draft.get("education")), errors)
    _validate_skills(_sequence(draft.get("skills")), errors)
    _check_items(
        _texts(draft.get("achievements")),
        "Achievement",
        MAX_TEXT_ITEM_CHARACTERS,
        errors,
    )
    if not _has_content(draft):
        errors.append(
            "Add at least one section — experience, a project, education, "
            "skills, or an achievement."
        )
    return errors


# --- normalization ----------------------------------------------------------


def prune_draft(draft: Mapping[str, Any]) -> Dict[str, Any]:
    """Drop rows the editor added but nobody filled in.

    Validation reports positions from the *submitted* list so "Experience 2"
    means the second row on screen; pruning happens afterwards, and the stable
    IDs the importer assigns are positional over the pruned result.
    """

    experience = []
    for raw in _sequence(draft.get("experience")):
        item = _mapping(raw)
        bullets = _texts(item.get("bullets"))
        values = [
            _text(item.get(key))
            for key in ("role", "company", "location", "start", "end")
        ]
        if _entry_is_blank(values, bullets):
            continue
        experience.append(
            {
                "role": values[0],
                "company": values[1],
                "location": values[2],
                "start": values[3],
                "end": values[4],
                "bullets": bullets,
            }
        )

    projects = []
    for raw in _sequence(draft.get("projects")):
        item = _mapping(raw)
        technologies = _texts(item.get("technologies"))
        bullets = _texts(item.get("bullets"))
        name = _text(item.get("name"))
        url = _text(item.get("url"))
        if _entry_is_blank([name, url], technologies, bullets):
            continue
        projects.append(
            {
                "name": name,
                "url": url,
                "technologies": technologies,
                "bullets": bullets,
            }
        )

    education = []
    for raw in _sequence(draft.get("education")):
        item = _mapping(raw)
        details = _texts(item.get("details"))
        values = [
            _text(item.get(key))
            for key in ("institution", "degree", "location", "start", "end")
        ]
        if _entry_is_blank(values, details):
            continue
        education.append(
            {
                "institution": values[0],
                "degree": values[1],
                "location": values[2],
                "start": values[3],
                "end": values[4],
                "details": details,
            }
        )

    skills = []
    for raw in _sequence(draft.get("skills")):
        item = _mapping(raw)
        category = _text(item.get("category"))
        items = _texts(item.get("items"))
        if _entry_is_blank([category], items):
            continue
        skills.append({"category": category, "items": items})

    identity = _mapping(draft.get("identity"))
    links = []
    for raw in _sequence(identity.get("links")):
        link = _mapping(raw)
        label = _text(link.get("label"))
        url = _text(link.get("url"))
        if not label or not url:
            continue
        links.append({"label": label, "url": url})

    return {
        "identity": {
            "name": _text(identity.get("name")),
            "email": _text(identity.get("email")),
            "phone": _text(identity.get("phone")),
            "location": _text(identity.get("location")),
            "links": links,
        },
        "summary": _text(draft.get("summary")),
        "experience": experience,
        "projects": projects,
        "education": education,
        "skills": skills,
        "achievements": _texts(draft.get("achievements")),
    }


def _schema_errors(exc: ValidationError) -> List[str]:
    """Field locations and constraints only — never the submitted value (R-10)."""

    reported: List[str] = []
    for error in exc.errors()[:MAX_REPORTED_ERRORS]:
        location = ".".join(str(part) for part in error.get("loc", ()))
        message = str(error.get("msg", "is invalid"))[:200]
        reported.append("{0}: {1}".format(location or "resume", message))
    return reported


def build_manual_resume(draft: Mapping[str, Any]) -> ResumeData:
    """Validate a user-authored draft and normalize it into stored resume facts."""

    errors = validate_draft(draft)
    if errors:
        raise ResumeDraftError(errors)
    normalized = normalize_extracted_resume(prune_draft(draft))
    try:
        return validate_model(ResumeData, normalized)
    except ValidationError as exc:
        raise ResumeDraftError(_schema_errors(exc)) from exc


def baseline_proposal(resume: ResumeData) -> TailorProposal:
    """The identity proposal: the resume rendered exactly as it was written."""

    return TailorProposal(
        summary=resume.summary,
        bullet_rewrites=[],
        skills_order=flattened_skills(resume),
    )


def render_baseline(template: str, resume: ResumeData) -> str:
    """Render an untailored resume, translating renderer failures to draft errors."""

    try:
        return render_template_text(
            template, resume, baseline_proposal(resume), sectioned=True
        )
    except (ResumeError, ProposalValidationError) as exc:
        errors = (
            exc.errors if isinstance(exc, ProposalValidationError) else [str(exc)[:400]]
        )
        raise ResumeDraftError(errors) from exc


def build_manual_artifacts(
    draft: Mapping[str, Any], style_raw: Optional[Mapping[str, Any]] = None
) -> Tuple[ResumeData, ResumeStyle, str, str]:
    """Draft in; ``(resume, style, template, rendered LaTeX)`` out.

    Rendering here is not decoration: it proves the draft compiles into the
    locked template *before* anything is stored, exactly as the import path
    does, so a stored resume can always be previewed and tailored.
    """

    resume = build_manual_resume(draft)
    style = sanitize_style(dict(style_raw) if style_raw else None)
    template = assemble_template(style)
    return resume, style, template, render_baseline(template, resume)
