"""What a careers link is: a job-board feed we can read, or a page.

``normalize_link`` validates what the user typed. ``detect_source`` recognizes
job-board URLs (the board page, a single posting, an embed script or the
board's API) and maps them to one canonical source, so every way of linking
the same board shares one crawl. Any other link becomes a ``page`` source,
which the crawler reads once to find an embedded board or JobPosting data.

Nothing here guesses or searches: a link the user supplies is the only input.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from urllib.parse import parse_qs, unquote, urlencode, urlsplit, urlunsplit

from .fetch import is_public_address


MAX_LINK_CHARACTERS = 500

#: Display names for the source kinds the UI shows.
KIND_LABELS = {
    "greenhouse": "Greenhouse",
    "lever": "Lever",
    "ashby": "Ashby",
    "workable": "Workable",
    "smartrecruiters": "SmartRecruiters",
    "workday": "Workday",
    "page": "Careers page",
}

#: Job aggregators: their terms forbid scraping and they block bots, and a
#: company's own board is always the better source anyway.
_AGGREGATOR_DOMAINS = (
    "linkedin.com",
    "naukri.com",
    "indeed.com",
    "indeed.co.in",
    "glassdoor.com",
    "glassdoor.co.in",
    "foundit.in",
    "monster.com",
    "instahyre.com",
    "wellfound.com",
    "angel.co",
    "cutshort.io",
    "iimjobs.com",
    "hirist.tech",
    "hirist.com",
    "shine.com",
    "timesjobs.com",
    "ziprecruiter.com",
)

_TRACKING_PARAMS = re.compile(
    r"^(?:utm_.*|gh_src|gh_jid|source|src|ref|referrer|lever-source.*|lever-origin|trk|fbclid|gclid)$",
    re.IGNORECASE,
)
_SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")
_WORKDAY_HOST = re.compile(r"^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$")
_LOCALE = re.compile(r"^[a-z]{2}(?:-[a-z]{2})?$", re.IGNORECASE)
_URL_IN_TEXT = re.compile(r"https?://[^\s\"'<>()\\]+", re.IGNORECASE)
_DOMAINISH = re.compile(r"^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#]\S*)?$", re.IGNORECASE)


class LinkError(ValueError):
    """A link the importer refuses; the message is safe to show."""


@dataclass(frozen=True)
class SourceSpec:
    kind: str
    #: Unique across all users: ``greenhouse:razorpay``, ``page:https://…``.
    key: str
    url: str
    #: A readable default company name derived from the link.
    label: str
    params: Dict[str, str] = field(default_factory=dict)

    @property
    def kind_label(self) -> str:
        return KIND_LABELS.get(self.kind, self.kind)


def looks_like_link(value: str) -> bool:
    value = (value or "").strip()
    return value.lower().startswith(("http://", "https://")) or bool(_DOMAINISH.match(value))


def normalize_link(raw: str) -> str:
    """Validate a typed link and return it with scheme, lowercase host, no fragment."""

    value = (raw or "").strip()
    if not value:
        raise LinkError("missing link")
    if len(value) > MAX_LINK_CHARACTERS:
        raise LinkError("link is too long")
    if any(ord(character) < 33 or ord(character) == 127 for character in value):
        raise LinkError("link contains spaces or control characters")
    if "://" not in value:
        value = "https://" + value
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as exc:
        raise LinkError("not a web link") from exc
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise LinkError("not a web link")
    if parts.username or parts.password:
        raise LinkError("links with a username or password are not allowed")
    host = (parts.hostname or "").rstrip(".").lower()
    if "." not in host and ":" not in host:
        raise LinkError("not a web link")
    if _is_ip_literal(host) and not is_public_address(host):
        # Hostnames are re-checked at crawl time; a literal can be refused now.
        raise LinkError("private or local addresses are not allowed")
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        raise LinkError("private or local addresses are not allowed")
    if port not in (None, 80, 443):
        raise LinkError("only standard web ports are supported")
    if is_aggregator(host):
        raise LinkError("job aggregator sites are not crawled; use the company's own careers link")
    return urlunsplit((scheme, host, parts.path or "/", parts.query, ""))


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def is_aggregator(host: str) -> bool:
    host = host.lower().rstrip(".")
    return any(host == domain or host.endswith("." + domain) for domain in _AGGREGATOR_DOMAINS)


def source_for_link(link: str) -> SourceSpec:
    """The source a normalized link maps to: a known board, else a page."""

    return detect_source(link) or page_source(link)


def page_source(link: str) -> SourceSpec:
    parts = urlsplit(link)
    host = (parts.hostname or "").lower()
    query = [
        (name, value)
        for name, values in sorted(parse_qs(parts.query, keep_blank_values=True).items())
        if not _TRACKING_PARAMS.match(name)
        for value in values
    ]
    path = parts.path.rstrip("/") or "/"
    canonical = urlunsplit((parts.scheme.lower(), host, path, urlencode(query), ""))
    return SourceSpec(
        kind="page",
        key="page:" + canonical,
        url=link,
        label=_name_from_host(host),
    )


def detect_source(url: str) -> Optional[SourceSpec]:
    """Recognize a job-board URL; None for anything else."""

    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    host = (parts.hostname or "").lower().rstrip(".")
    segments = [unquote(segment) for segment in parts.path.split("/") if segment]
    query = parse_qs(parts.query)

    if host in ("boards.greenhouse.io", "job-boards.greenhouse.io", "boards-api.greenhouse.io"):
        token = None
        if host == "boards-api.greenhouse.io":
            if len(segments) >= 3 and segments[0] == "v1" and segments[1] == "boards":
                token = segments[2]
        elif segments and segments[0] == "embed":
            token = (query.get("for") or [None])[0]
        elif segments:
            token = segments[0]
        return _spec("greenhouse", token, "https://job-boards.greenhouse.io/{0}")

    if host in ("jobs.lever.co", "jobs.eu.lever.co", "api.lever.co", "api.eu.lever.co"):
        region = "eu" if ".eu." in host else ""
        site = None
        if host.startswith("api."):
            if len(segments) >= 3 and segments[0] == "v0" and segments[1] == "postings":
                site = segments[2]
        elif segments:
            site = segments[0]
        spec = _spec(
            "lever",
            site,
            "https://jobs.eu.lever.co/{0}" if region else "https://jobs.lever.co/{0}",
            key_prefix="lever-eu" if region else "lever",
        )
        if spec is not None:
            spec.params["region"] = region
        return spec

    if host in ("jobs.ashbyhq.com", "api.ashbyhq.com"):
        name = None
        if host == "api.ashbyhq.com":
            if len(segments) >= 3 and segments[0] == "posting-api" and segments[1] == "job-board":
                name = segments[2]
        elif segments and segments[0] not in ("api",):
            name = segments[0]
        return _spec("ashby", name, "https://jobs.ashbyhq.com/{0}")

    if host == "apply.workable.com":
        slug = None
        if segments and segments[0] == "api":
            if "accounts" in segments:
                index = segments.index("accounts")
                slug = segments[index + 1] if index + 1 < len(segments) else None
        elif segments and segments[0] not in ("j",):
            slug = segments[0]
        return _spec("workable", slug, "https://apply.workable.com/{0}/")
    if host.endswith(".workable.com") and host.count(".") == 2:
        slug = host.split(".")[0]
        if slug not in ("www", "apply", "jobs", "help", "resources", "api"):
            return _spec("workable", slug, "https://apply.workable.com/{0}/")

    if host in ("careers.smartrecruiters.com", "jobs.smartrecruiters.com", "api.smartrecruiters.com"):
        company = None
        if host == "api.smartrecruiters.com":
            if len(segments) >= 3 and segments[0] == "v1" and segments[1] == "companies":
                company = segments[2]
        elif segments and segments[0] not in ("oneclick-ui", "sr-jobs"):
            company = segments[0]
        return _spec("smartrecruiters", company, "https://careers.smartrecruiters.com/{0}")

    match = _WORKDAY_HOST.match(host)
    if match:
        tenant, pod = match.group(1), match.group(2)
        site = None
        if len(segments) >= 4 and segments[0] == "wday" and segments[1] == "cxs":
            site = segments[3]
        else:
            rest = segments[1:] if segments and _LOCALE.match(segments[0]) else segments
            if rest and rest[0].lower() not in ("job", "details", "login", "wday", "userhome"):
                site = rest[0]
        if not site or not _SLUG.match(site):
            return None
        return SourceSpec(
            kind="workday",
            key="workday:{0}.{1}/{2}".format(tenant, pod, site).lower(),
            url="https://{0}/{1}".format(host, site),
            label=_title(tenant),
            params={"host": host, "tenant": tenant, "site": site},
        )
    return None


def find_embedded_source(markup: str) -> Optional[SourceSpec]:
    """The first job board a careers page links to, embeds or scripts."""

    text = (markup or "").replace("\\/", "/").replace("&amp;", "&")
    seen = set()
    for match in _URL_IN_TEXT.finditer(text[:2_000_000]):
        candidate = match.group(0).rstrip(".,;")
        if candidate in seen:
            continue
        seen.add(candidate)
        spec = detect_source(candidate)
        if spec is not None:
            return spec
        if len(seen) > 5_000:
            break
    return None


def _spec(
    kind: str,
    slug: Optional[str],
    url_template: str,
    key_prefix: Optional[str] = None,
) -> Optional[SourceSpec]:
    if not slug or not _SLUG.match(slug):
        return None
    return SourceSpec(
        kind=kind,
        key="{0}:{1}".format(key_prefix or kind, slug.lower()),
        url=url_template.format(slug),
        label=_title(slug),
        params={"slug": slug},
    )


def _title(slug: str) -> str:
    words = re.split(r"[-_.\s]+", slug)
    return " ".join(word[:1].upper() + word[1:] for word in words if word)[:120] or slug


def _name_from_host(host: str) -> str:
    labels = [label for label in host.split(".") if label]
    while len(labels) > 2 and labels[0] in ("www", "careers", "jobs", "career", "apply", "work", "join"):
        labels = labels[1:]
    if labels and labels[0] in ("www", "careers", "jobs") and len(labels) > 1:
        labels = labels[1:]
    return _title(labels[0]) if labels else host


def links_in_text(text: str) -> List[str]:
    """http(s) URLs written out in a block of text (company-list PDFs)."""

    return [match.group(0).rstrip(".,;)") for match in _URL_IN_TEXT.finditer(text or "")]
