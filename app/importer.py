"""Turn an LLM extraction of a pasted resume into safe, storable artifacts.

The language model reads the user's pasted LaTeX and returns loosely-structured
facts plus a few style hints. This module is the trust boundary: it assigns its
own stable IDs, clamps every style value to a bounded whitelist, and assembles a
template whose LaTeX is entirely server-controlled. Only the extracted plain
text and the validated style knobs come from the model, so the locked-template
safety guarantees continue to hold for everything that is actually compiled.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .resume import MAX_SUMMARY_CHARACTERS, MAX_SUMMARY_WORDS, validate_template
from .schemas import ResumeData, ResumeStyle, validate_model


ALLOWED_PAPER = ("a4paper", "letterpaper")
ALLOWED_FONT_SIZE = ("10pt", "11pt", "12pt")
_HEX_PATTERN = re.compile(r"^[0-9A-Fa-f]{6}$")


def clamp_headline(value: str) -> str:
    """Force the extracted summary into the single-line headline contract."""

    words = str(value or "").split()
    headline = " ".join(words[:MAX_SUMMARY_WORDS]).strip()
    if len(headline) > MAX_SUMMARY_CHARACTERS:
        headline = headline[:MAX_SUMMARY_CHARACTERS].rstrip()
    return headline or "Professional summary"


def sanitize_style(raw: Optional[Dict[str, Any]]) -> ResumeStyle:
    """Coerce untrusted style hints into a bounded, whitelisted ``ResumeStyle``."""

    data = raw if isinstance(raw, dict) else {}

    paper = str(data.get("paper", "")).strip().lower()
    if paper not in ALLOWED_PAPER:
        paper = "a4paper"

    font_size = str(data.get("font_size", "")).strip().lower()
    if font_size not in ALLOWED_FONT_SIZE:
        font_size = "10pt"

    try:
        margin_cm = float(data.get("margin_cm", 2.0))
    except (TypeError, ValueError):
        margin_cm = 2.0
    margin_cm = round(max(1.0, min(3.0, margin_cm)), 2)

    accent_hex: Optional[str] = None
    raw_hex = data.get("accent_hex")
    if isinstance(raw_hex, str):
        candidate = raw_hex.strip().lstrip("#")
        if _HEX_PATTERN.match(candidate):
            accent_hex = candidate.upper()

    return ResumeStyle(
        paper=paper, font_size=font_size, margin_cm=margin_cm, accent_hex=accent_hex
    )


def _sanitize_link(raw: Any) -> Optional[Dict[str, str]]:
    if not isinstance(raw, dict):
        return None
    label = str(raw.get("label", "")).strip()
    url = str(raw.get("url", "")).strip()
    if not label or not url:
        return None
    # Rendering rejects non-http(s) URLs anyway; drop them here so one bad link
    # does not fail an otherwise valid import.
    if not url.lower().startswith(("http://", "https://")):
        return None
    return {"label": label[:100], "url": url[:500]}


def _as_text_items(raw: Any) -> List[str]:
    items: List[str] = []
    if isinstance(raw, list):
        for entry in raw:
            if isinstance(entry, dict):
                text = str(entry.get("text", "")).strip()
            else:
                text = str(entry).strip()
            if text:
                items.append(text)
    return items


def normalize_extracted_resume(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Assign deterministic, globally-unique stable IDs to extracted facts.

    Model-supplied IDs are ignored entirely; positions drive the IDs so the
    result always satisfies the uniqueness contract enforced on load.
    """

    identity_raw = raw.get("identity") if isinstance(raw.get("identity"), dict) else {}
    links = [link for link in (_sanitize_link(l) for l in (identity_raw.get("links") or [])) if link]
    identity = {
        "name": str(identity_raw.get("name", "")).strip(),
        "email": str(identity_raw.get("email", "")).strip(),
        "phone": str(identity_raw.get("phone", "")).strip(),
        "location": str(identity_raw.get("location", "")).strip(),
        "links": links[:12],
    }

    experience: List[Dict[str, Any]] = []
    for index, item in enumerate(raw.get("experience") or [], start=1):
        if not isinstance(item, dict):
            continue
        bullets = [
            {"id": "exp_{0}_b{1}".format(index, b_index), "text": text}
            for b_index, text in enumerate(_as_text_items(item.get("bullets")), start=1)
        ]
        experience.append(
            {
                "id": "exp_{0}".format(index),
                "company": str(item.get("company", "")).strip(),
                "role": str(item.get("role", "")).strip(),
                "location": str(item.get("location", "")).strip(),
                "start": str(item.get("start", "")).strip(),
                "end": str(item.get("end", "")).strip(),
                "bullets": bullets,
            }
        )

    projects: List[Dict[str, Any]] = []
    for index, item in enumerate(raw.get("projects") or [], start=1):
        if not isinstance(item, dict):
            continue
        technologies = [
            str(tech).strip()
            for tech in (item.get("technologies") or [])
            if str(tech).strip()
        ]
        bullets = [
            {"id": "project_{0}_b{1}".format(index, b_index), "text": text}
            for b_index, text in enumerate(_as_text_items(item.get("bullets")), start=1)
        ]
        url = str(item.get("url", "")).strip()
        if url and not url.lower().startswith(("http://", "https://")):
            url = ""
        projects.append(
            {
                "id": "project_{0}".format(index),
                "name": str(item.get("name", "")).strip(),
                "url": url,
                "technologies": technologies[:40],
                "bullets": bullets,
            }
        )

    education: List[Dict[str, Any]] = []
    for index, item in enumerate(raw.get("education") or [], start=1):
        if not isinstance(item, dict):
            continue
        details = [str(d).strip() for d in (item.get("details") or []) if str(d).strip()]
        education.append(
            {
                "id": "edu_{0}".format(index),
                "institution": str(item.get("institution", "")).strip(),
                "degree": str(item.get("degree", "")).strip(),
                "location": str(item.get("location", "")).strip(),
                "start": str(item.get("start", "")).strip(),
                "end": str(item.get("end", "")).strip(),
                "details": details[:20],
            }
        )

    skills: List[Dict[str, Any]] = []
    for item in raw.get("skills") or []:
        if not isinstance(item, dict):
            continue
        category = str(item.get("category", "")).strip()
        items = [str(s).strip() for s in (item.get("items") or []) if str(s).strip()]
        if category and items:
            skills.append({"category": category, "items": items[:100]})

    achievements = [
        {"id": "ach_{0}".format(index), "text": text}
        for index, text in enumerate(_as_text_items(raw.get("achievements")), start=1)
    ]

    return {
        "identity": identity,
        "summary": clamp_headline(raw.get("summary", "")),
        "experience": experience,
        "projects": projects,
        "education": education,
        "skills": skills,
        "achievements": achievements,
    }


def build_resume_data(raw: Dict[str, Any]) -> ResumeData:
    """Normalize extracted facts and validate them against the strict schema."""

    return validate_model(ResumeData, normalize_extracted_resume(raw))


# --- Server-controlled template assembly -----------------------------------
# Everything below is fixed application LaTeX except the bounded style values.
# This mirrors resume/template.tex but parameterizes only documentclass options,
# page geometry, and an optional accent color.

_MACRO_BLOCK = r"""\textheight=10in
\pagestyle{empty}
\raggedright
\ifdefined\XeTeXgenerateactualtext
  \XeTeXgenerateactualtext=1
\fi

\newcommand{\lineunder}{%
  \vspace*{-8pt} \\
  \hspace*{-18pt} \hrulefill \\
}

\newcommand{\header}[1]{%
  {\hspace*{-18pt}\vspace*{6pt} {\ResumeAccent \textsc{#1}}}
  \vspace*{-6pt} \lineunder
}

\newcommand{\ResumeContact}[2]{%
  \vspace*{-2pt}
  \begin{center}
    {\Huge \scshape {\ResumeAccent #1}}\\
    \vspace*{2pt}
    {\ResumeHeadline}\\
    \vspace*{2pt}
    #2
  \end{center}
  \vspace*{-8pt}
}

% Renderer order: role, date range, company, location.
\newcommand{\ResumeEntry}[4]{%
  \textbf{#3}\textbf{ | #1}\hfill #4 | #2\\
  \vspace{-2mm}
}

% Renderer order: institution, location, degree, date range, details.
% The details line is omitted when empty so an absent detail set does not leave
% a dangling \\ (imported resumes frequently have no education details).
\newcommand{\ResumeEducation}[5]{%
  \textbf{#1}\hfill #2\\
  #3 \hfill #4\\
  \def\ResumeArg{#5}\ifx\ResumeArg\empty\else{\sl #5}\\\fi
  \vspace{2mm}
}

% The "| Link" segment is omitted when the project has no URL.
\newcommand{\ResumeProject}[3]{%
  \textbf{#1}\def\ResumeArg{#2}\ifx\ResumeArg\empty\else\textbf{ | \href{#2}{Link}}\fi\hfill{\sl #3}\\
  \vspace{-2mm}
}

\newcommand{\ResumeBulletListStart}{%
  \begin{itemize}\itemsep -3pt
}
\newcommand{\ResumeBullet}[1]{\item #1}
\newcommand{\ResumeBulletListEnd}{\end{itemize}\vspace*{1mm}}

\newcommand{\ResumeSkill}[2]{#1: & #2\\}
"""


_DOCUMENT_BODY = r"""
% The headline is the model's validated summary field. It is escaped and is
% the only authorized editable value stored in the otherwise locked preamble.
\newcommand{\ResumeHeadline}{@@SUMMARY@@}

\begin{document}
\vspace*{-40pt}

% PROTECTED_CONTACT_START
@@CONTACT@@
% PROTECTED_CONTACT_END

% AI_EDITABLE_START
% Sectioned rendering supplies each header and wrapper, so an absent section
% (e.g. no projects) collapses to nothing instead of leaving a dangling rule.
@@EDUCATION@@

@@EXPERIENCE@@

@@SKILLS@@

@@PROJECTS@@

@@ACHIEVEMENTS@@
% AI_EDITABLE_END

\end{document}
"""


def _accent_setup(style: ResumeStyle) -> str:
    if not style.accent_hex:
        return r"\newcommand{\ResumeAccent}{}"
    return (
        r"\usepackage{xcolor}"
        + "\n"
        + r"\definecolor{ResumeAccentColor}{HTML}{"
        + style.accent_hex
        + "}\n"
        + r"\newcommand{\ResumeAccent}{\color{ResumeAccentColor}}"
    )


def assemble_template(style: ResumeStyle) -> str:
    """Build a Tectonic-compatible template from bounded style hints.

    Only ``paper``, ``font_size``, ``margin_cm``, and the optional accent color
    vary; the ``style`` values are already whitelisted by :func:`sanitize_style`.
    """

    margin = "{0:g}".format(style.margin_cm)
    preamble = "\n".join(
        [
            "% This template is immutable application code generated from a bounded",
            "% style profile. The backend replaces each named placeholder exactly once.",
            "% PROTECTED_PREAMBLE_START",
            r"\documentclass[" + style.paper + "," + style.font_size + r"]{article}",
            "",
            r"\usepackage{fullpage}",
            r"\usepackage{amsmath}",
            r"\usepackage{amssymb}",
            r"\usepackage{textcomp}",
            r"\usepackage{iftex}",
            r"\ifPDFTeX",
            r"  \usepackage[utf8]{inputenc}",
            r"\fi",
            r"\usepackage[T1]{fontenc}",
            r"\usepackage[hidelinks]{hyperref}",
            r"\usepackage[left="
            + margin
            + "cm,right="
            + margin
            + "cm,top="
            + margin
            + r"cm]{geometry}",
            r"\usepackage{longtable}",
            _accent_setup(style),
            "",
            _MACRO_BLOCK,
            "% PROTECTED_PREAMBLE_END",
        ]
    )
    template = preamble + "\n" + _DOCUMENT_BODY
    # Fail fast if a future edit breaks the fixed seven-token contract.
    validate_template(template)
    return template
