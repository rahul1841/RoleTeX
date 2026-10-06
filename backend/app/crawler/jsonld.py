"""schema.org JobPosting blocks on ordinary careers pages.

Many careers sites publish ``<script type="application/ld+json">`` JobPosting
markup for Google for Jobs. It is the one structured format a page without a
job board can still offer, so it is the generic crawl path. The markup is
untrusted page content: it is parsed as JSON only, walked with a node cap, and
every string goes through the same text cleaning as a board's descriptions.
"""

from __future__ import annotations

import json
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlsplit


MAX_SCRIPTS = 50
MAX_NODES = 5_000
MAX_POSTINGS = 500


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.scripts: List[str] = []
        self.anchors: List[str] = []
        self._in_ld = False
        self._buffer: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Any]) -> None:
        attributes = {name.lower(): (value or "") for name, value in attrs}
        if tag == "script" and attributes.get("type", "").strip().lower() == "application/ld+json":
            self._in_ld = True
            self._buffer = []
        elif tag == "a" and attributes.get("href"):
            if len(self.anchors) < 5_000:
                self.anchors.append(attributes["href"])

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._in_ld:
            self._in_ld = False
            if len(self.scripts) < MAX_SCRIPTS:
                self.scripts.append("".join(self._buffer))

    def handle_data(self, data: str) -> None:
        if self._in_ld:
            self._buffer.append(data)


class ParsedPage:
    def __init__(self, postings: List[Dict[str, Any]], anchors: List[str]) -> None:
        self.postings = postings
        self.anchors = anchors


def parse_page(markup: str) -> ParsedPage:
    parser = _PageParser()
    try:
        parser.feed(markup or "")
        parser.close()
    except Exception:
        pass
    postings: List[Dict[str, Any]] = []
    budget = [MAX_NODES]
    for script in parser.scripts:
        try:
            value = json.loads(script.strip(), strict=False)
        except (ValueError, RecursionError):
            continue
        _collect(value, postings, budget)
        if len(postings) >= MAX_POSTINGS:
            break
    return ParsedPage(postings[:MAX_POSTINGS], parser.anchors)


def _is_posting(node: Dict[str, Any]) -> bool:
    kind = node.get("@type")
    kinds = kind if isinstance(kind, list) else [kind]
    return any(isinstance(item, str) and item.lower() == "jobposting" for item in kinds)


def _collect(value: Any, out: List[Dict[str, Any]], budget: List[int]) -> None:
    stack = [value]
    while stack and budget[0] > 0:
        budget[0] -= 1
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(reversed(node[:500]))
        elif isinstance(node, dict):
            if _is_posting(node):
                out.append(node)
                continue
            for key in ("@graph", "itemListElement", "item", "mainEntity", "hasPart"):
                child = node.get(key)
                if isinstance(child, (list, dict)):
                    stack.append(child)


def detail_links(page_url: str, anchors: List[str], limit: int) -> List[str]:
    """Same-host links that look like individual postings, in page order."""

    base = urlsplit(page_url)
    base_path = base.path.rstrip("/")
    found: List[str] = []
    seen = set()
    for href in anchors:
        absolute = urljoin(page_url, href.strip())
        parts = urlsplit(absolute)
        if parts.scheme not in ("http", "https") or parts.hostname != base.hostname:
            continue
        path = parts.path.rstrip("/")
        lowered = path.lower()
        if not path or path == base_path:
            continue
        if not any(marker in lowered for marker in ("job", "career", "position", "opening", "vacanc", "role")):
            continue
        canonical = parts._replace(fragment="").geturl()
        if canonical in seen:
            continue
        seen.add(canonical)
        found.append(canonical)
        if len(found) >= limit:
            break
    return found


def text_value(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("name", "value", "@value"):
            if isinstance(value.get(key), str):
                return value[key]
    if isinstance(value, list) and value:
        return text_value(value[0])
    return ""


def posting_locations(posting: Dict[str, Any]) -> List[str]:
    locations: List[str] = []
    raw = posting.get("jobLocation")
    items = raw if isinstance(raw, list) else [raw]
    for item in items[:20]:
        if not isinstance(item, dict):
            continue
        address = item.get("address")
        if isinstance(address, str):
            locations.append(address)
            continue
        if not isinstance(address, dict):
            continue
        parts = [
            text_value(address.get("addressLocality")),
            text_value(address.get("addressRegion")),
            text_value(address.get("addressCountry")),
        ]
        joined = ", ".join(part for part in parts if part)
        if joined:
            locations.append(joined)
    return locations


def posting_is_remote(posting: Dict[str, Any]) -> Optional[bool]:
    kind = posting.get("jobLocationType")
    kinds = kind if isinstance(kind, list) else [kind]
    if any(isinstance(item, str) and item.upper() == "TELECOMMUTE" for item in kinds):
        return True
    return None


def posting_months_required(posting: Dict[str, Any]) -> Optional[int]:
    requirement = posting.get("experienceRequirements")
    items = requirement if isinstance(requirement, list) else [requirement]
    for item in items:
        if isinstance(item, dict) and "monthsOfExperience" in item:
            try:
                months = int(float(item["monthsOfExperience"]))
            except (TypeError, ValueError):
                continue
            if 0 <= months <= 600:
                return months
    return None


def posting_is_intern(posting: Dict[str, Any]) -> bool:
    kind = posting.get("employmentType")
    kinds = kind if isinstance(kind, list) else [kind]
    return any(isinstance(item, str) and "INTERN" in item.upper() for item in kinds)


def posting_experience_text(posting: Dict[str, Any]) -> str:
    requirement = posting.get("experienceRequirements")
    if isinstance(requirement, str):
        return requirement
    if isinstance(requirement, dict):
        return text_value(requirement.get("description"))
    return ""
