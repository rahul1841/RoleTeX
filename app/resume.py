"""Locked-template resume loading, proposal validation, and LaTeX rendering."""

from __future__ import annotations

import difflib
import json
import os
import re
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any, Deque, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlsplit

from pydantic import ValidationError

from .schemas import (
    ResumeBullet,
    ResumeChange,
    ResumeData,
    ResumeSkillCategory,
    TailorProposal,
    dump_model,
    validate_model,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REQUIRED_TEMPLATE_TOKENS: Tuple[str, ...] = (
    "@@CONTACT@@",
    "@@SUMMARY@@",
    "@@EXPERIENCE@@",
    "@@PROJECTS@@",
    "@@EDUCATION@@",
    "@@SKILLS@@",
    "@@ACHIEVEMENTS@@",
)
TOKEN_PATTERN = re.compile(r"@@[A-Z][A-Z0-9_]*@@")
NUMBER_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])(?:[$₹€£]\s*)?\d[\d,.]*(?:\s*%|\+)?"
)
MAX_TEMPLATE_BYTES = 2_000_000
MAX_DATA_BYTES = 1_000_000
MAX_SUMMARY_WORDS = 12
MAX_SUMMARY_CHARACTERS = 120
MAX_BULLET_WORDS = 70
MAX_BULLET_CHARACTERS = 600
MAX_BULLET_GROWTH_CHARACTERS = 30


class ResumeError(ValueError):
    """Raised when source resume data or the locked template is invalid."""


class ProposalValidationError(ValueError):
    """Raised when a model proposal violates the editable-data contract."""

    def __init__(self, message: str, errors: Optional[List[str]] = None) -> None:
        self.errors = errors or [message]
        super().__init__(message)


def _read_limited(path: Path, limit: int) -> str:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise ResumeError("Unable to access resume file: {0}".format(path)) from exc
    if size > limit:
        raise ResumeError("Resume file is larger than the configured safety limit: {0}".format(path))
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ResumeError("Unable to read UTF-8 resume file: {0}".format(path)) from exc


class ResumeRepository:
    """Filesystem repository with no import-time I/O, making it easy to replace in tests."""

    def __init__(
        self,
        data_path: Optional[Path] = None,
        template_path: Optional[Path] = None,
        assets_dir: Optional[Path] = None,
    ) -> None:
        self.data_path = Path(
            data_path or os.getenv("RESUME_DATA_PATH", str(PROJECT_ROOT / "resume" / "data.json"))
        )
        self.template_path = Path(
            template_path
            or os.getenv("RESUME_TEMPLATE_PATH", str(PROJECT_ROOT / "resume" / "template.tex"))
        )
        configured_assets = assets_dir or os.getenv(
            "RESUME_ASSETS_DIR", str(PROJECT_ROOT / "resume" / "assets")
        )
        self.assets_dir = Path(configured_assets)

    def load_data(self) -> ResumeData:
        return load_resume_data(self.data_path)

    def load_template(self) -> str:
        template = _read_limited(self.template_path, MAX_TEMPLATE_BYTES)
        validate_template(template)
        return template

    def load(self) -> Tuple[ResumeData, str]:
        return self.load_data(), self.load_template()


def load_resume_data(path: Path) -> ResumeData:
    """Load and validate the authoritative factual resume JSON."""

    text = _read_limited(Path(path), MAX_DATA_BYTES)
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ResumeError("Resume data is not valid JSON: {0}".format(exc.msg)) from exc
    try:
        resume = validate_model(ResumeData, raw)
    except ValidationError as exc:
        raise ResumeError("Resume data does not match the required schema: {0}".format(exc)) from exc
    _validate_resume_ids(resume)
    return resume


def _validate_resume_ids(resume: ResumeData) -> None:
    section_ids: List[str] = []
    bullet_ids: List[str] = []
    for experience in resume.experience:
        section_ids.append(experience.id)
        bullet_ids.extend(bullet.id for bullet in experience.bullets)
    for project in resume.projects:
        section_ids.append(project.id)
        bullet_ids.extend(bullet.id for bullet in project.bullets)
    section_ids.extend(item.id for item in resume.education)
    bullet_ids.extend(item.id for item in resume.achievements)

    duplicate_sections = sorted(key for key, count in Counter(section_ids).items() if count > 1)
    duplicate_bullets = sorted(key for key, count in Counter(bullet_ids).items() if count > 1)
    overlap = sorted(set(section_ids).intersection(bullet_ids))
    errors: List[str] = []
    if duplicate_sections:
        errors.append("duplicate section IDs: {0}".format(", ".join(duplicate_sections)))
    if duplicate_bullets:
        errors.append("duplicate bullet IDs: {0}".format(", ".join(duplicate_bullets)))
    if overlap:
        errors.append("IDs reused by sections and bullets: {0}".format(", ".join(overlap)))
    if errors:
        raise ResumeError("Invalid stable IDs in resume data ({0})".format("; ".join(errors)))


def validate_template(template_text: str) -> None:
    """Require a fixed, single-use token boundary and reject unknown placeholders."""

    errors: List[str] = []
    for token in REQUIRED_TEMPLATE_TOKENS:
        count = template_text.count(token)
        if count != 1:
            errors.append("{0} must appear exactly once (found {1})".format(token, count))
    unknown = sorted(set(TOKEN_PATTERN.findall(template_text)).difference(REQUIRED_TEMPLATE_TOKENS))
    if unknown:
        errors.append("unknown locked-template tokens: {0}".format(", ".join(unknown)))
    if errors:
        raise ResumeError("Invalid locked resume template: {0}".format("; ".join(errors)))


def all_bullets(resume: ResumeData) -> Dict[str, ResumeBullet]:
    bullets: Dict[str, ResumeBullet] = {}
    for experience in resume.experience:
        for bullet in experience.bullets:
            bullets[bullet.id] = bullet
    for project in resume.projects:
        for bullet in project.bullets:
            bullets[bullet.id] = bullet
    for achievement in resume.achievements:
        bullets[achievement.id] = achievement
    return bullets


def flattened_skills(resume: ResumeData) -> List[str]:
    return [item for category in resume.skills for item in category.items]


def build_llm_resume_payload(resume: ResumeData) -> Dict[str, Any]:
    """Return factual tailoring context with the entire identity block omitted.

    Name, personal location, email, phone, and profile URLs are intentionally not
    placed in this payload. The server restores them only during local rendering.
    """

    return {
        "summary": resume.summary,
        "experience": [
            {
                "id": item.id,
                "company": item.company,
                "role": item.role,
                "location": item.location,
                "start": item.start,
                "end": item.end,
                "bullets": [
                    {"id": bullet.id, "text": bullet.text}
                    for bullet in item.bullets
                ],
            }
            for item in resume.experience
        ],
        "projects": [
            {
                "id": item.id,
                "name": item.name,
                "technologies": list(item.technologies),
                "bullets": [
                    {"id": bullet.id, "text": bullet.text}
                    for bullet in item.bullets
                ],
            }
            for item in resume.projects
        ],
        "education": [
            {
                "id": item.id,
                "institution": item.institution,
                "degree": item.degree,
                "location": item.location,
                "start": item.start,
                "end": item.end,
                "details": list(item.details),
            }
            for item in resume.education
        ],
        "skills": [dump_model(category) for category in resume.skills],
        "achievements": [
            {"id": item.id, "text": item.text}
            for item in resume.achievements
        ],
    }


def _normalized_number_tokens(text: str) -> Counter:
    tokens = []
    for token in NUMBER_PATTERN.findall(text):
        tokens.append(re.sub(r"\s+", "", token).replace(",", "").lower())
    return Counter(tokens)


def _new_numeric_claims(proposed: str, factual_source: str) -> List[str]:
    proposed_numbers = _normalized_number_tokens(proposed)
    factual_numbers = _normalized_number_tokens(factual_source)
    return sorted((proposed_numbers - factual_numbers).elements())


def validate_proposal(resume: ResumeData, proposal: TailorProposal) -> TailorProposal:
    """Enforce stable IDs, text limits, numeric fact safety, and skill membership."""

    errors: List[str] = []
    bullet_map = all_bullets(resume)
    rewrite_ids = [rewrite.id for rewrite in proposal.bullet_rewrites]
    duplicate_ids = sorted(key for key, count in Counter(rewrite_ids).items() if count > 1)
    if duplicate_ids:
        errors.append("duplicate bullet rewrite IDs: {0}".format(", ".join(duplicate_ids)))

    unknown_ids = sorted(set(rewrite_ids).difference(bullet_map))
    if unknown_ids:
        errors.append("unknown bullet IDs: {0}".format(", ".join(unknown_ids)))

    if not proposal.summary.strip():
        errors.append("summary must not be blank")
    if len(proposal.summary.split()) > MAX_SUMMARY_WORDS:
        errors.append("summary exceeds {0} words".format(MAX_SUMMARY_WORDS))
    if len(proposal.summary.strip()) > MAX_SUMMARY_CHARACTERS:
        errors.append(
            "summary exceeds {0} characters".format(MAX_SUMMARY_CHARACTERS)
        )
    new_summary_numbers = _new_numeric_claims(
        proposal.summary, json.dumps(build_llm_resume_payload(resume), ensure_ascii=False)
    )
    if new_summary_numbers:
        errors.append(
            "summary introduces numeric claims absent from the resume: {0}".format(
                ", ".join(new_summary_numbers)
            )
        )

    for rewrite in proposal.bullet_rewrites:
        if rewrite.id not in bullet_map:
            continue
        cleaned = rewrite.text.strip()
        if not cleaned:
            errors.append("bullet {0} must not be blank".format(rewrite.id))
            continue
        if len(cleaned) > MAX_BULLET_CHARACTERS:
            errors.append(
                "bullet {0} exceeds {1} characters".format(rewrite.id, MAX_BULLET_CHARACTERS)
            )
        if len(cleaned.split()) > MAX_BULLET_WORDS:
            errors.append("bullet {0} exceeds {1} words".format(rewrite.id, MAX_BULLET_WORDS))
        source_length = len(bullet_map[rewrite.id].text.strip())
        allowed_length = source_length + MAX_BULLET_GROWTH_CHARACTERS
        if len(cleaned) > allowed_length:
            errors.append(
                "bullet {0} exceeds the source-length allowance ({1} > {2} characters)".format(
                    rewrite.id,
                    len(cleaned),
                    allowed_length,
                )
            )
        new_numbers = _new_numeric_claims(cleaned, bullet_map[rewrite.id].text)
        if new_numbers:
            errors.append(
                "bullet {0} introduces numeric claims absent from its source: {1}".format(
                    rewrite.id, ", ".join(new_numbers)
                )
            )

    expected_skills = flattened_skills(resume)
    proposed_skills = list(proposal.skills_order)
    if Counter(expected_skills) != Counter(proposed_skills):
        missing = sorted((Counter(expected_skills) - Counter(proposed_skills)).elements())
        unknown = sorted((Counter(proposed_skills) - Counter(expected_skills)).elements())
        if missing:
            errors.append("skills_order is missing: {0}".format(", ".join(missing)))
        if unknown:
            errors.append("skills_order contains unknown values: {0}".format(", ".join(unknown)))
        if not missing and not unknown:
            errors.append("skills_order is not an exact permutation of the original skills")

    if errors:
        raise ProposalValidationError("The tailoring proposal was rejected", errors)
    return proposal


_LATEX_SPECIALS: Dict[str, str] = {
    "\\": r"\textbackslash{}",
    "{": r"\{",
    "}": r"\}",
    "$": r"\$",
    "&": r"\&",
    "#": r"\#",
    "%": r"\%",
    "_": r"\_",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}
_LATEX_SPECIAL_PATTERN = re.compile(r"[\\{}$&#%_~^]")


def escape_latex(value: str) -> str:
    """Escape data for LaTeX text/macro arguments and normalize line breaks."""

    normalized = " ".join(str(value).replace("\x00", "").split())
    return _LATEX_SPECIAL_PATTERN.sub(lambda match: _LATEX_SPECIALS[match.group(0)], normalized)


def redact_identity(text: str, resume: ResumeData) -> str:
    """Remove contact identity values before diagnostics are sent to an LLM.

    Compiler excerpts can echo a failing source line. Replace both raw values
    and their deterministic LaTeX representations so the compile-repair path
    keeps the same PII boundary as the initial tailoring request.
    """

    identity = resume.identity
    raw_values = [
        identity.name,
        identity.email,
        identity.phone,
        identity.location,
    ]
    for link in identity.links:
        raw_values.extend([link.label, link.url])
    phone_target = re.sub(r"[^0-9+]", "", identity.phone)
    raw_values.extend(
        [
            "mailto:" + identity.email.strip(),
            "tel:" + phone_target if phone_target else "",
        ]
    )

    variants = set()
    for value in raw_values:
        value = value.strip()
        if not value:
            continue
        variants.add(value)
        variants.add(escape_latex(value))
    redacted = text
    for value in sorted(variants, key=len, reverse=True):
        redacted = re.sub(
            re.escape(value), "[REDACTED_IDENTITY]", redacted, flags=re.IGNORECASE
        )
    return redacted


def _safe_url(value: str, allow_empty: bool = False) -> str:
    value = value.strip()
    if not value and allow_empty:
        return ""
    if any(character in value for character in ("\x00", "\r", "\n")):
        raise ResumeError("Resume URL contains a forbidden control character")
    parsed = urlsplit(value)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
        raise ResumeError("Resume URLs must use an absolute http(s) address")
    return escape_latex(value)


def _date_range(start: str, end: str) -> str:
    return "{0} -- {1}".format(escape_latex(start), escape_latex(end))


def _render_contact(resume: ResumeData) -> str:
    identity = resume.identity
    first_line = []
    email_target = escape_latex("mailto:" + identity.email.strip())
    email_label = escape_latex(identity.email)
    first_line.append(r"\href{" + email_target + "}{" + email_label + "}")
    phone_href = re.sub(r"[^0-9+]", "", identity.phone)
    if phone_href:
        first_line.append(
            r"\href{" + escape_latex("tel:" + phone_href) + "}{" + escape_latex(identity.phone) + "}"
        )
    first_line.append(escape_latex(identity.location))
    contact_lines = [(r" \textbar{} ").join(first_line)]
    if identity.links:
        links = [
            r"\textbf{\href{"
            + _safe_url(link.url)
            + "}{"
            + escape_latex(link.label)
            + "}}"
            for link in identity.links
        ]
        contact_lines.append((r" \textbar{} ").join(links))
    return (
        r"\ResumeContact{"
        + escape_latex(identity.name)
        + "}{"
        + (r"\\" + "\n").join(contact_lines)
        + "}"
    )


def _render_bullets(bullets: Sequence[ResumeBullet], rewrites: Mapping[str, str]) -> List[str]:
    if not bullets:
        return []
    lines = [r"\ResumeBulletListStart"]
    for bullet in bullets:
        text = rewrites.get(bullet.id, bullet.text)
        rendered_text = escape_latex(text)
        if bullet.link is not None:
            rendered_text += (
                r" -- \textbf{\href{"
                + _safe_url(bullet.link.url)
                + "}{"
                + escape_latex(bullet.link.label)
                + "}}"
            )
        lines.append(r"\ResumeBullet{" + rendered_text + "}")
    lines.append(r"\ResumeBulletListEnd")
    return lines


def _render_experience(resume: ResumeData, rewrites: Mapping[str, str]) -> str:
    lines: List[str] = []
    for item in resume.experience:
        lines.append(
            r"\ResumeEntry{"
            + escape_latex(item.role)
            + "}{"
            + _date_range(item.start, item.end)
            + "}{"
            + escape_latex(item.company)
            + "}{"
            + escape_latex(item.location)
            + "}"
        )
        lines.extend(_render_bullets(item.bullets, rewrites))
    return "\n".join(lines)


def _render_projects(resume: ResumeData, rewrites: Mapping[str, str]) -> str:
    lines: List[str] = []
    for item in resume.projects:
        lines.append(
            r"\ResumeProject{"
            + escape_latex(item.name)
            + "}{"
            + _safe_url(item.url, allow_empty=True)
            + "}{"
            + escape_latex(", ".join(item.technologies))
            + "}"
        )
        lines.extend(_render_bullets(item.bullets, rewrites))
    return "\n".join(lines)


def _render_education(resume: ResumeData) -> str:
    return "\n".join(
        r"\ResumeEducation{"
        + escape_latex(item.institution)
        + "}{"
        + escape_latex(item.location)
        + "}{"
        + escape_latex(item.degree)
        + "}{"
        + _date_range(item.start, item.end)
        + "}{"
        + escape_latex(" | ".join(item.details))
        + "}"
        for item in resume.education
    )


def _render_achievements(resume: ResumeData, rewrites: Mapping[str, str]) -> str:
    return "\n".join(_render_bullets(resume.achievements, rewrites))


def ordered_skill_categories(
    categories: Sequence[ResumeSkillCategory], skills_order: Sequence[str]
) -> List[Tuple[str, List[str]]]:
    """Apply a flat relevance permutation while retaining category membership."""

    ranks: Dict[str, Deque[int]] = defaultdict(deque)
    for index, skill in enumerate(skills_order):
        ranks[skill].append(index)

    ranked_categories: List[Tuple[int, int, str, List[Tuple[int, str]]]] = []
    for category_index, category in enumerate(categories):
        ranked_items: List[Tuple[int, str]] = []
        for item in category.items:
            if not ranks[item]:
                raise ProposalValidationError("skills_order cannot be mapped back to categories")
            ranked_items.append((ranks[item].popleft(), item))
        ranked_items.sort(key=lambda pair: pair[0])
        first_rank = min((rank for rank, _ in ranked_items), default=10**9)
        ranked_categories.append((first_rank, category_index, category.category, ranked_items))
    ranked_categories.sort(key=lambda value: (value[0], value[1]))
    return [
        (category, [item for _, item in ranked_items])
        for _, _, category, ranked_items in ranked_categories
    ]


def _render_skills(resume: ResumeData, proposal: TailorProposal) -> str:
    lines = []
    for category, items in ordered_skill_categories(resume.skills, proposal.skills_order):
        lines.append(
            r"\ResumeSkill{"
            + escape_latex(category)
            + "}{"
            + escape_latex(", ".join(items))
            + "}"
        )
    return "\n".join(lines)


def render_template_text(
    template_text: str, resume: ResumeData, proposal: TailorProposal
) -> str:
    """Merge validated plain text into the seven authorized template slots."""

    validate_template(template_text)
    validate_proposal(resume, proposal)
    rewrites = {item.id: item.text for item in proposal.bullet_rewrites}
    replacements = {
        "@@CONTACT@@": _render_contact(resume),
        "@@SUMMARY@@": escape_latex(proposal.summary),
        "@@EXPERIENCE@@": _render_experience(resume, rewrites),
        "@@PROJECTS@@": _render_projects(resume, rewrites),
        "@@EDUCATION@@": _render_education(resume),
        "@@SKILLS@@": _render_skills(resume, proposal),
        "@@ACHIEVEMENTS@@": _render_achievements(resume, rewrites),
    }
    rendered = template_text
    for token in REQUIRED_TEMPLATE_TOKENS:
        rendered = rendered.replace(token, replacements[token], 1)
    leftovers = TOKEN_PATTERN.findall(rendered)
    if leftovers:
        raise ResumeError("Rendered resume contains unresolved template tokens")
    return rendered


# Short alias intended for callers/tests that prefer the domain-oriented name.
render_resume = render_template_text


def build_change_list(resume: ResumeData, proposal: TailorProposal) -> List[ResumeChange]:
    validate_proposal(resume, proposal)
    changes: List[ResumeChange] = []
    if resume.summary.strip() != proposal.summary.strip():
        changes.append(
            ResumeChange(
                field_id="summary", before=resume.summary, after=proposal.summary.strip()
            )
        )
    bullets = all_bullets(resume)
    for rewrite in proposal.bullet_rewrites:
        original = bullets[rewrite.id].text
        if original.strip() != rewrite.text.strip():
            changes.append(
                ResumeChange(field_id=rewrite.id, before=original, after=rewrite.text.strip())
            )
    original_skills = flattened_skills(resume)
    if original_skills != proposal.skills_order:
        changes.append(
            ResumeChange(
                field_id="skills_order",
                before=", ".join(original_skills),
                after=", ".join(proposal.skills_order),
            )
        )
    return changes


def build_unified_diff(changes: Iterable[ResumeChange]) -> str:
    before: List[str] = []
    after: List[str] = []
    for change in changes:
        before.extend(["[{0}]".format(change.field_id), change.before, ""])
        after.extend(["[{0}]".format(change.field_id), change.after, ""])
    if before == after:
        return ""
    return "\n".join(
        difflib.unified_diff(
            before,
            after,
            fromfile="original-resume",
            tofile="tailored-resume",
            lineterm="",
        )
    )
