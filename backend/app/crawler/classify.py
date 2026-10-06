"""Deterministic facts about a job: category, experience required, location.

Computed once when a job is stored, so matching a user is a cheap comparison.
No model is involved: a posting is untrusted text, and keyword and pattern
rules keep every match explainable ("2–4 yrs · fits").
"""

from __future__ import annotations

import re
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

#: (id, label, title keywords, department-only keywords). The dropdown shows
#: these in this order; the ids are what a user's preferences store.
_CATEGORY_TABLE: Tuple[Tuple[str, str, Tuple[str, ...], Tuple[str, ...]], ...] = (
    (
        "engineering",
        "Engineering",
        (
            "engineer", "engineering", "engineers", "developer", "developers", "sde",
            "sdet", "swe", "programmer", "devops", "devsecops", "sre", "site reliability",
            "qa", "quality assurance", "tester", "test automation", "automation test",
            "backend", "back end", "frontend", "front end", "full stack", "fullstack",
            "android", "ios", "firmware", "embedded", "software", "architect",
            "tech lead", "technical lead", "technical staff", "cto", "mlops",
        ),
        ("technology", "tech", "r&d", "research and development", "it", "product development"),
    ),
    (
        "data_ai",
        "Data & AI",
        (
            "data", "analytics", "machine learning", "ml", "ai", "artificial intelligence",
            "deep learning", "nlp", "computer vision", "research scientist",
            "applied scientist", "business intelligence", "bi", "statistician", "llm",
        ),
        ("research",),
    ),
    (
        "product",
        "Product",
        (
            "product manager", "product management", "product owner", "product lead",
            "head of product", "vp product", "vp of product", "director of product",
            "product director", "chief product", "group product", "product operations",
        ),
        ("product",),
    ),
    (
        "design",
        "Design",
        (
            "designer", "ux", "ui", "user experience", "user research", "ux researcher",
            "illustrator", "creative director", "visual design", "motion design",
        ),
        ("design", "creative"),
    ),
    (
        "sales",
        "Sales",
        (
            "sales", "account executive", "account manager", "business development",
            "bdr", "sdr", "presales", "pre sales", "partnerships", "partner manager",
            "key account", "solutions consultant", "solution consultant", "revenue",
        ),
        ("sales", "business development", "partnerships"),
    ),
    (
        "marketing",
        "Marketing",
        (
            "marketing", "growth", "seo", "sem", "content", "brand", "communications",
            "social media", "public relations", "pr", "demand generation", "community",
            "copywriter", "events",
        ),
        ("marketing", "communications"),
    ),
    (
        "customer_success",
        "Customer success & support",
        (
            "customer success", "customer support", "support", "customer experience",
            "cx", "customer service", "technical support", "onboarding",
            "implementation", "client services", "customer care", "helpdesk",
            "service desk",
        ),
        ("support", "customer success", "customer experience", "services"),
    ),
    (
        "operations",
        "Operations",
        (
            "operations", "ops", "supply chain", "logistics", "procurement",
            "program manager", "project manager", "program management", "strategy",
            "chief of staff", "office manager", "facilities", "administrative",
            "executive assistant", "workplace",
        ),
        ("operations", "ops", "strategy"),
    ),
    (
        "finance",
        "Finance",
        (
            "finance", "financial", "accountant", "accounting", "accounts payable",
            "accounts receivable", "audit", "auditor", "tax", "treasury", "fp&a",
            "controller", "investor relations", "billing",
        ),
        ("finance", "accounting"),
    ),
    (
        "people",
        "People / HR",
        (
            "recruiter", "recruiting", "talent acquisition", "talent", "hr",
            "human resources", "people partner", "people operations", "hrbp",
            "payroll", "compensation", "benefits", "learning and development",
        ),
        ("people", "hr", "human resources", "talent", "recruiting"),
    ),
    (
        "legal",
        "Legal",
        (
            "legal", "counsel", "lawyer", "attorney", "paralegal", "compliance",
            "privacy", "regulatory", "contracts", "company secretary",
        ),
        ("legal", "compliance"),
    ),
)

CATEGORIES: Tuple[Tuple[str, str], ...] = tuple((row[0], row[1]) for row in _CATEGORY_TABLE)
CATEGORY_IDS: Tuple[str, ...] = tuple(row[0] for row in _CATEGORY_TABLE)


def _phrase_pattern(phrases: Iterable[str]) -> "re.Pattern[str]":
    alternatives = sorted(
        (re.escape(phrase).replace(r"\ ", r"[\s\-/]+") for phrase in phrases),
        key=len,
        reverse=True,
    )
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(alternatives) + r")(?![a-z0-9])")


_TITLE_PATTERNS = tuple((row[0], _phrase_pattern(row[2])) for row in _CATEGORY_TABLE)
_DEPARTMENT_PATTERNS = tuple(
    (row[0], _phrase_pattern(row[2] + row[3])) for row in _CATEGORY_TABLE
)


def categorize(title: str, departments: Sequence[str]) -> List[str]:
    """Categories from the title; the department decides only when the title is silent.

    The title is the more specific signal: a "Technical Recruiter" in an
    Engineering department is a recruiting job.
    """

    lowered = (title or "").lower()
    found = [category for category, pattern in _TITLE_PATTERNS if pattern.search(lowered)]
    if found:
        return found
    department_text = " | ".join(department.lower() for department in departments if department)
    if not department_text:
        return []
    return [
        category for category, pattern in _DEPARTMENT_PATTERNS if pattern.search(department_text)
    ]


# ---------------------------------------------------------------------------
# Experience required
# ---------------------------------------------------------------------------

_WORD_NUMBERS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19, "twenty": 20,
}
_NUM = r"(?<![a-z0-9.])(\d{1,2}(?:\.\d{1,2})?|(?:" + "|".join(_WORD_NUMBERS) + r")(?![a-z]))"
_YEARS = r"(?:years?|yrs?)"
_MONTHS = r"(?:months?|mos?)"
_DASH = r"\s*(?:-|–|—|to)\s*"
_EXPERIENCE_TAIL = (
    r"(?:\s*(?:of|')?\s*(?:relevant|professional|industry|hands[\s-]on|work(?:ing)?|"
    r"total|overall|prior|proven|practical|full[\s-]time|post[\s-]qualification|related|"
    r"technical|software|engineering|commercial|demonstrable|solid)?\s*)*"
    r"(?:experience|exp\b|experiance)"
)

# Each pattern yields (min, max-or-None) in the unit named by ``unit``.
_PATTERNS: Tuple[Tuple["re.Pattern[str]", str, str], ...] = (
    # "3-5 years", "3 to 5 yrs", "3 – 5+ years"
    (re.compile(_NUM + _DASH + _NUM + r"\s*\+?\s*" + _YEARS), "range", "year"),
    (re.compile(_NUM + _DASH + _NUM + r"\s*\+?\s*" + _MONTHS), "range", "month"),
    # "5+ years", "5 + yrs"
    (re.compile(_NUM + r"\s*\+\s*" + _YEARS), "min", "year"),
    (re.compile(_NUM + r"\s*\+\s*" + _MONTHS), "min", "month"),
    # "minimum 2 years", "at least 2 yrs", "min. of 2 years"
    (
        re.compile(r"(?:minimum|min\.?|at\s+least|atleast|no\s+less\s+than)\s*(?:of\s+)?" + _NUM + r"\s*" + _YEARS),
        "min",
        "year",
    ),
    (
        re.compile(r"(?:minimum|min\.?|at\s+least|atleast|no\s+less\s+than)\s*(?:of\s+)?" + _NUM + r"\s*" + _MONTHS),
        "min",
        "month",
    ),
    # "5 years or more", "5 or more years"
    (re.compile(_NUM + r"\s*" + _YEARS + r"\s*(?:or\s+more|and\s+above|plus)"), "min", "year"),
    (re.compile(_NUM + r"\s*or\s+more\s+" + _YEARS), "min", "year"),
    # "3 years of experience", "2 yrs exp", "3 years' professional experience"
    (re.compile(_NUM + r"\s*" + _YEARS + _EXPERIENCE_TAIL), "min", "year"),
    (re.compile(_NUM + r"\s*" + _MONTHS + _EXPERIENCE_TAIL), "min", "month"),
    # "Experience: 3-5 years", "Exp - 2 yrs"
    (
        re.compile(r"(?:experience|exp)\s*(?:required|needed|level)?\s*[:\-–]\s*" + _NUM + r"(?:" + _DASH + _NUM + r")?\s*\+?\s*" + _YEARS),
        "labelled",
        "year",
    ),
)
_FRESHER = re.compile(
    r"(?<![a-z])(?:freshers?|new\s+grad(?:uate)?s?|recent\s+graduates?|no\s+(?:prior\s+)?experience\s+(?:is\s+)?(?:required|needed|necessary)|0\s*(?:-|–|to)\s*1\s*(?:years?|yrs?))(?![a-z])"
)
#: Sentences about the company, not the candidate.
_NOT_A_REQUIREMENT = re.compile(
    r"(?<![a-z])(?:ago|old|founded|anniversary|warranty|since\s+\d{4}|age\s+of|years\s+in\s+business|in\s+business\s+for)(?![a-z])"
)
_SENTENCE_SPLIT = re.compile(r"(?:[\n;•▪●]|(?<=[a-z0-9)])\.\s)")
#: Above this, a "years" number is about something other than a candidate.
MAX_PLAUSIBLE_YEARS = 25

_TITLE_RULES: Tuple[Tuple["re.Pattern[str]", int, Optional[int]], ...] = (
    (re.compile(r"(?<![a-z])(?:intern|interns|internship|trainee|apprentice)(?![a-z])"), 0, 12),
    (re.compile(r"(?<![a-z])(?:junior|jr\.?|graduate|entry[\s-]level|associate)(?![a-z])"), 0, 24),
    (re.compile(r"(?<![a-z])(?:director|head\s+of|vice\s+president|vp)(?![a-z])"), 120, None),
    (re.compile(r"(?<![a-z])(?:staff|principal|distinguished)(?![a-z])"), 84, None),
    (re.compile(r"(?<![a-z])(?:lead)(?![a-z])"), 60, None),
    (re.compile(r"(?<![a-z])(?:senior|sr\.?)(?![a-z])"), 48, None),
)


def _number(token: str) -> Optional[float]:
    token = token.strip().lower()
    if token in _WORD_NUMBERS:
        return float(_WORD_NUMBERS[token])
    try:
        return float(token)
    except ValueError:
        return None


def _months(value: float, unit: str) -> int:
    return int(round(value * 12)) if unit == "year" else int(round(value))


def experience_from_text(text: str) -> Optional[Tuple[int, Optional[int]]]:
    """``(min_months, max_months_or_None)`` stated in a posting, or None.

    With several statements ("5+ years overall, 2+ years in Go") the largest
    minimum wins — the conservative reading. A posting that is explicitly open
    to freshers starts at zero whatever else it says.
    """

    lowered = (text or "").lower()
    if not lowered:
        return None
    found: List[Tuple[int, Optional[int]]] = []
    for sentence in _SENTENCE_SPLIT.split(lowered[:40_000]):
        if not sentence.strip() or _NOT_A_REQUIREMENT.search(sentence):
            continue
        claimed: List[Tuple[int, int]] = []
        for pattern, shape, unit in _PATTERNS:
            for match in pattern.finditer(sentence):
                span = match.span()
                if any(start < span[1] and span[0] < end for start, end in claimed):
                    continue
                first = _number(match.group(1))
                second = _number(match.group(2)) if shape in ("range", "labelled") and match.lastindex and match.lastindex >= 2 and match.group(2) else None
                if first is None:
                    continue
                if unit == "year" and (first > MAX_PLAUSIBLE_YEARS or (second is not None and second > MAX_PLAUSIBLE_YEARS)):
                    continue
                if second is not None and second < first:
                    continue
                claimed.append(span)
                found.append((_months(first, unit), _months(second, unit) if second is not None else None))
    fresher = bool(_FRESHER.search(lowered))
    if not found:
        return (0, 12) if fresher else None
    if fresher:
        maxima = [item[1] for item in found if item[1] is not None]
        return (0, max(maxima) if maxima else None)
    return max(found, key=lambda item: item[0])


def experience_from_title(title: str) -> Optional[Tuple[int, Optional[int]]]:
    lowered = (title or "").lower()
    for pattern, minimum, maximum in _TITLE_RULES:
        if pattern.search(lowered):
            return (minimum, maximum)
    return None


def experience_required(
    title: str,
    description: str,
    structured_months: Optional[int] = None,
    intern: bool = False,
) -> Tuple[Optional[int], Optional[int], str]:
    """``(min_months, max_months, basis)``; basis is structured/text/title/none."""

    if intern:
        return 0, 12, "structured"
    # An internship title outranks a stray "2+ years of coding" in its text.
    if _TITLE_RULES[0][0].search((title or "").lower()):
        return 0, 12, "title"
    if structured_months is not None:
        return structured_months, None, "structured"
    stated = experience_from_text(description)
    if stated is not None:
        return stated[0], stated[1], "text"
    estimated = experience_from_title(title)
    if estimated is not None:
        return estimated[0], estimated[1], "title"
    return None, None, "none"


# ---------------------------------------------------------------------------
# Location
# ---------------------------------------------------------------------------

#: Names for the same place; any member matches any other.
_EQUIVALENT_PLACES: Tuple[Tuple[str, ...], ...] = (
    ("bengaluru", "bangalore", "blr"),
    ("gurugram", "gurgaon"),
    ("mumbai", "bombay"),
    ("chennai", "madras"),
    ("kolkata", "calcutta"),
    ("delhi", "new delhi"),
    ("pune", "poona"),
    ("thiruvananthapuram", "trivandrum"),
    ("kochi", "cochin"),
    ("mysuru", "mysore"),
    ("vadodara", "baroda"),
    ("visakhapatnam", "vizag"),
    ("puducherry", "pondicherry"),
    ("new york", "new york city", "nyc"),
    ("san francisco", "sf"),
)
#: A region the user may type that covers several cities (one-way).
_REGIONS: Dict[str, Tuple[str, ...]] = {
    "delhi ncr": ("delhi", "new delhi", "ncr", "noida", "greater noida", "gurugram", "gurgaon", "faridabad", "ghaziabad"),
    "ncr": ("delhi", "new delhi", "ncr", "noida", "greater noida", "gurugram", "gurgaon", "faridabad", "ghaziabad"),
    "bay area": ("san francisco", "sf", "san jose", "palo alto", "mountain view", "sunnyvale", "menlo park", "redwood city", "oakland", "santa clara"),
}
_REMOTE = re.compile(r"(?<![a-z])(?:remote|work\s+from\s+home|wfh|anywhere|distributed|telecommute)(?![a-z])")
_HYBRID = re.compile(r"(?<![a-z])hybrid(?![a-z])")
_PLACE_CLEAN = re.compile(r"[^a-z0-9]+")


def normalize_place(value: str) -> str:
    return _PLACE_CLEAN.sub(" ", (value or "").lower()).strip()


def place_terms(user_place: str) -> Set[str]:
    """Every spelling a user's city or region should match."""

    place = normalize_place(user_place)
    if not place:
        return set()
    if place in _REGIONS:
        return set(_REGIONS[place]) | {place}
    for group in _EQUIVALENT_PLACES:
        if place in group:
            return set(group)
    return {place}


def location_text(parts: Iterable[str]) -> str:
    """Normalized text of all of a job's locations, for term matching."""

    joined = " | ".join(normalize_place(part) for part in parts if part)
    return joined[:2_000]


def detect_remote(parts: Iterable[str], flag: Optional[bool]) -> Optional[bool]:
    if flag is not None:
        return flag
    text = " ".join(part.lower() for part in parts if part)
    if not text:
        return None
    if _REMOTE.search(text) and not _HYBRID.search(text):
        return True
    return False


def place_matches(terms: Set[str], text: str) -> bool:
    for term in terms:
        if re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", text):
            return True
    return False
