"""A user's saved preferences against one job.

A job is shown when all of these hold:

1. at least one of its categories is one the user chose;
2. it does not ask for more than the top of the user's range plus the margin
   (``M <= B + G``) — the margin extends only the top, which is the "+6 months";
3. it is not only for people below the range (``X >= A`` when X is stated);
4. its location fits: no location preference, or one of the user's cities,
   or remote when the user ticked Remote. A job with no location passes.

The label says why: ``fits`` (``M <= B``), ``stretch`` (inside the margin) or
``unstated`` (no experience requirement found).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, FrozenSet, List, Optional, Set, Tuple

from .classify import CATEGORY_IDS, location_text, place_matches, place_terms


LABEL_RANK = {"fits": 0, "stretch": 1, "unstated": 2}
MAX_LOCATIONS = 10
MAX_LOCATION_CHARACTERS = 80


@dataclass(frozen=True)
class Preferences:
    categories: FrozenSet[str]
    from_months: int
    to_months: int
    margin_months: int
    #: One set of accepted spellings per city or region the user typed.
    places: Tuple[FrozenSet[str], ...]
    include_remote: bool

    @property
    def filters_location(self) -> bool:
        return bool(self.places) or self.include_remote


def preferences_from_doc(doc: Optional[Dict[str, Any]]) -> Optional[Preferences]:
    """The stored ``job_prefs`` as a :class:`Preferences`, or None if unset."""

    if not isinstance(doc, dict):
        return None
    categories = frozenset(
        category for category in doc.get("categories") or [] if category in CATEGORY_IDS
    )
    if not categories:
        return None
    try:
        from_months = int(round(float(doc.get("exp_from_years", 0)) * 12))
        to_months = int(round(float(doc.get("exp_to_years", 0)) * 12))
        margin = int(doc.get("margin_months", 6))
    except (TypeError, ValueError):
        return None
    places = tuple(
        frozenset(place_terms(place)) for place in doc.get("locations") or [] if place_terms(place)
    )
    return Preferences(
        categories=categories,
        from_months=from_months,
        to_months=to_months,
        margin_months=margin,
        places=places,
        include_remote=bool(doc.get("include_remote", False)),
    )


def category_ok(job_categories: List[str], prefs: Preferences) -> bool:
    return any(category in prefs.categories for category in job_categories)


def location_ok(text: str, remote: Optional[bool], prefs: Preferences) -> bool:
    if not prefs.filters_location:
        return True
    if not text and remote is None:
        return True
    if prefs.include_remote and remote:
        return True
    return any(place_matches(set(terms), text) for terms in prefs.places)


def evaluate(job: Dict[str, Any], prefs: Preferences) -> Optional[str]:
    """The label for a stored job, or None when it should not be shown."""

    if not category_ok(job.get("categories") or [], prefs):
        return None
    minimum = job.get("exp_min_months")
    maximum = job.get("exp_max_months")
    if minimum is not None and minimum > prefs.to_months + prefs.margin_months:
        return None
    if maximum is not None and maximum < prefs.from_months:
        return None
    if not location_ok(job.get("location_text") or "", job.get("remote"), prefs):
        return None
    if minimum is None:
        return "unstated"
    return "fits" if minimum <= prefs.to_months else "stretch"


def could_want(
    categories: List[str], locations: List[str], remote: Optional[bool], prefs: Preferences
) -> bool:
    """Pre-check before paying for a posting's detail request (no experience yet)."""

    return category_ok(categories, prefs) and location_ok(location_text(locations), remote, prefs)


def validate_preferences(
    categories: List[str],
    exp_from_years: float,
    exp_to_years: float,
    margin_months: int,
    locations: List[str],
) -> List[str]:
    """Problems with submitted preferences, described by field (never by value)."""

    problems: List[str] = []
    unknown = [category for category in categories if category not in CATEGORY_IDS]
    if not categories:
        problems.append("categories: choose at least one job type")
    elif unknown:
        problems.append("categories: unknown job type")
    if exp_from_years < 0 or exp_to_years < 0 or exp_from_years > 30 or exp_to_years > 30:
        problems.append("experience: years must be between 0 and 30")
    elif exp_from_years > exp_to_years:
        problems.append("experience: 'from' must not be more than 'to'")
    if margin_months < 0 or margin_months > 24:
        problems.append("margin_months: must be between 0 and 24")
    if len(locations) > MAX_LOCATIONS:
        problems.append("locations: at most {0}".format(MAX_LOCATIONS))
    for place in locations:
        if not place.strip() or len(place) > MAX_LOCATION_CHARACTERS or any(
            ord(character) < 32 or ord(character) == 127 for character in place
        ):
            problems.append("locations: each must be 1–{0} characters".format(MAX_LOCATION_CHARACTERS))
            break
    return problems


def describe_experience(minimum: Optional[int], maximum: Optional[int]) -> str:
    """``2–4 yrs``, ``5+ yrs``, ``0–1 yrs``, ``6+ mos``; empty when unknown."""

    if minimum is None:
        return ""

    def years(months: int) -> str:
        value = months / 12.0
        return str(int(value)) if value == int(value) else "{0:.1f}".format(value)

    if maximum is not None and maximum >= minimum:
        if maximum < 12:
            return "{0}–{1} mos".format(minimum, maximum)
        return "{0}–{1} yrs".format(years(minimum), years(maximum))
    if minimum < 12 and minimum != 0:
        return "{0}+ mos".format(minimum)
    return "{0}+ yrs".format(years(minimum))


def unique_places(places: List[str]) -> List[str]:
    """Trimmed, de-duplicated (case-insensitively) city names in input order."""

    result: List[str] = []
    seen: Set[str] = set()
    for place in places:
        cleaned = " ".join(place.split())
        if cleaned and cleaned.lower() not in seen:
            seen.add(cleaned.lower())
            result.append(cleaned)
    return result
