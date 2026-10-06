"""One adapter per job board, each turning a public feed into ``RawJob`` rows.

Every endpoint here is a board's own public, keyless feed (the one its hosted
careers page reads), checked against live responses when this was written.
All feed content is untrusted: strings are length-capped, HTML becomes plain
text, and only http(s) URLs survive.

Workday and SmartRecruiters list postings without descriptions and need one
request per posting. Those detail requests go only to postings that are new
(or still pending) and that at least one watcher could want, within a
per-source budget; the rest stay ``detail_pending`` for a later crawl.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote, urljoin

from . import jsonld
from .fetch import FetchError
from .text import clean_text, escaped_html_to_text, html_to_text


#: Detail requests per source per crawl (Workday, SmartRecruiters, pages).
DETAIL_BUDGET = 150
WORKDAY_PAGE_SIZE = 20  # Workday returns nothing at all for a larger page
WORKDAY_MAX_PAGES = 100  # its feeds stop at 2,000 postings anyway
SMARTRECRUITERS_PAGE_SIZE = 100
SMARTRECRUITERS_MAX_PAGES = 20
PAGE_DETAIL_LINKS = 30
MAX_TITLE_CHARACTERS = 300
MAX_LOCATIONS = 20


class FeedError(RuntimeError):
    """A feed answered but not in the shape its board documents."""

    code = "bad_feed"


@dataclass
class RawJob:
    external_id: str
    title: str
    url: str
    locations: List[str] = field(default_factory=list)
    remote: Optional[bool] = None
    departments: List[str] = field(default_factory=list)
    #: Plain text; None when not fetched in this crawl.
    description: Optional[str] = None
    posted_at: Optional[datetime] = None
    intern: bool = False
    months_required: Optional[int] = None
    #: The board needs a per-posting request that has not happened yet.
    detail_pending: bool = False
    #: Only proves the posting is still listed (a known page link not refetched).
    seen_only: bool = False


@dataclass
class Listing:
    jobs: List[RawJob]
    #: Every open posting was listed, so anything missing has closed. False
    #: when a feed cap cut the list short.
    complete: bool = True


@dataclass
class CrawlContext:
    fetcher: Any
    #: external_id -> whether that stored job already has its description.
    known: Dict[str, bool]
    #: Whether any watcher could want this posting (decides detail requests).
    want: Callable[[RawJob], bool]
    detail_budget: int = DETAIL_BUDGET

    def needs_detail(self, job: RawJob) -> bool:
        if self.known.get(job.external_id):
            return False
        if self.detail_budget <= 0 or not self.want(job):
            return False
        self.detail_budget -= 1
        return True


async def crawl_source(kind: str, params: Dict[str, Any], url: str, ctx: CrawlContext) -> Listing:
    adapter = _ADAPTERS.get(kind)
    if adapter is None:
        raise FeedError("No adapter for source kind '{0}'".format(kind))
    return await adapter(params, url, ctx)


# ---------------------------------------------------------------------------
# Boards
# ---------------------------------------------------------------------------


async def _greenhouse(params: Dict[str, Any], url: str, ctx: CrawlContext) -> Listing:
    data = await ctx.fetcher.get_json(
        "https://boards-api.greenhouse.io/v1/boards/{0}/jobs?content=true".format(quote(params["slug"]))
    )
    items = _list(data, "jobs")
    jobs: List[RawJob] = []
    for item in items:
        external_id = _str(item.get("id"))
        title = _title(item.get("title"))
        if not external_id or not title:
            continue
        locations = [_str((item.get("location") or {}).get("name"))]
        for office in item.get("offices") or []:
            if isinstance(office, dict):
                locations.append(_str(office.get("location") or office.get("name")))
        jobs.append(
            RawJob(
                external_id=external_id,
                title=title,
                url=_safe_url(item.get("absolute_url"), url),
                locations=_locations(locations),
                departments=[_str(d.get("name")) for d in item.get("departments") or [] if isinstance(d, dict)],
                description=escaped_html_to_text(_str(item.get("content"), 200_000)),
                posted_at=_parse_datetime(item.get("first_published") or item.get("updated_at")),
            )
        )
    return Listing(jobs)


async def _lever(params: Dict[str, Any], url: str, ctx: CrawlContext) -> Listing:
    host = "api.eu.lever.co" if params.get("region") == "eu" else "api.lever.co"
    data = await ctx.fetcher.get_json(
        "https://{0}/v0/postings/{1}?mode=json".format(host, quote(params["slug"]))
    )
    if not isinstance(data, list):
        raise FeedError("Lever returned an unexpected shape")
    jobs: List[RawJob] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        external_id = _str(item.get("id"))
        title = _title(item.get("text"))
        if not external_id or not title:
            continue
        categories = item.get("categories") if isinstance(item.get("categories"), dict) else {}
        locations = [_str(categories.get("location"))]
        locations += [_str(value) for value in categories.get("allLocations") or [] if isinstance(value, str)]
        parts = [_str(item.get("descriptionPlain"), 100_000)]
        for block in item.get("lists") or []:
            if isinstance(block, dict):
                parts.append(_str(block.get("text")))
                parts.append(html_to_text(_str(block.get("content"), 100_000)))
        parts.append(_str(item.get("additionalPlain"), 50_000))
        workplace = _str(item.get("workplaceType")).lower()
        commitment = _str(categories.get("commitment")).lower()
        jobs.append(
            RawJob(
                external_id=external_id,
                title=title,
                url=_safe_url(item.get("hostedUrl"), url),
                locations=_locations(locations),
                remote=True if workplace == "remote" else (False if workplace in ("onsite", "hybrid") else None),
                departments=[_str(categories.get("team")), _str(categories.get("department"))],
                description=clean_text("\n\n".join(part for part in parts if part)),
                posted_at=_parse_millis(item.get("createdAt")),
                intern="intern" in commitment,
            )
        )
    return Listing(jobs)


async def _ashby(params: Dict[str, Any], url: str, ctx: CrawlContext) -> Listing:
    data = await ctx.fetcher.get_json(
        "https://api.ashbyhq.com/posting-api/job-board/{0}".format(quote(params["slug"]))
    )
    jobs: List[RawJob] = []
    for item in _list(data, "jobs"):
        if item.get("isListed") is False:
            continue
        external_id = _str(item.get("id"))
        title = _title(item.get("title"))
        if not external_id or not title:
            continue
        locations = [_str(item.get("location"))]
        for extra in item.get("secondaryLocations") or []:
            if isinstance(extra, dict):
                locations.append(_str(extra.get("location")))
        workplace = _str(item.get("workplaceType")).lower()
        remote = item.get("isRemote") if isinstance(item.get("isRemote"), bool) else None
        if workplace == "remote":
            remote = True
        elif workplace in ("onsite", "hybrid"):
            remote = False
        description = _str(item.get("descriptionPlain"), 200_000) or html_to_text(
            _str(item.get("descriptionHtml"), 200_000)
        )
        jobs.append(
            RawJob(
                external_id=external_id,
                title=title,
                url=_safe_url(item.get("jobUrl"), url),
                locations=_locations(locations),
                remote=remote,
                departments=[_str(item.get("department")), _str(item.get("team"))],
                description=clean_text(description),
                posted_at=_parse_datetime(item.get("publishedAt")),
                intern=_str(item.get("employmentType")).lower() == "intern",
            )
        )
    return Listing(jobs)


async def _workable(params: Dict[str, Any], url: str, ctx: CrawlContext) -> Listing:
    data = await ctx.fetcher.get_json(
        "https://apply.workable.com/api/v1/widget/accounts/{0}?details=true".format(quote(params["slug"]))
    )
    jobs: List[RawJob] = []
    for item in _list(data, "jobs"):
        external_id = _str(item.get("shortcode"))
        title = _title(item.get("title"))
        if not external_id or not title:
            continue
        locations = [", ".join(p for p in (_str(item.get("city")), _str(item.get("state")), _str(item.get("country"))) if p)]
        for place in item.get("locations") or []:
            if isinstance(place, dict):
                locations.append(
                    ", ".join(p for p in (_str(place.get("city")), _str(place.get("region")), _str(place.get("country"))) if p)
                )
        level = (_str(item.get("experience")) + " " + _str(item.get("employment_type"))).lower()
        jobs.append(
            RawJob(
                external_id=external_id,
                title=title,
                url=_safe_url(item.get("shortlink") or item.get("url"), url),
                locations=_locations(locations),
                remote=True if item.get("telecommuting") is True else None,
                departments=[_str(item.get("department")), _str(item.get("function"))],
                description=html_to_text(_str(item.get("description"), 200_000)),
                posted_at=_parse_datetime(item.get("published_on") or item.get("created_at")),
                intern="intern" in level,
            )
        )
    return Listing(jobs)


async def _smartrecruiters(params: Dict[str, Any], url: str, ctx: CrawlContext) -> Listing:
    company = quote(params["slug"])
    base = "https://api.smartrecruiters.com/v1/companies/{0}/postings".format(company)
    jobs: List[RawJob] = []
    total = None
    offset = 0
    for _ in range(SMARTRECRUITERS_MAX_PAGES):
        data = await ctx.fetcher.get_json(
            "{0}?limit={1}&offset={2}".format(base, SMARTRECRUITERS_PAGE_SIZE, offset)
        )
        items = _list(data, "content")
        if total is None and isinstance(data, dict):
            try:
                total = int(data.get("totalFound") or 0)
            except (TypeError, ValueError):
                total = 0
        for item in items:
            external_id = _str(item.get("id"))
            title = _title(item.get("name"))
            if not external_id or not title:
                continue
            place = item.get("location") if isinstance(item.get("location"), dict) else {}
            locations = [_str(place.get("fullLocation")) or ", ".join(
                p for p in (_str(place.get("city")), _str(place.get("region")), _str(place.get("country"))) if p
            )]
            level = item.get("experienceLevel") if isinstance(item.get("experienceLevel"), dict) else {}
            jobs.append(
                RawJob(
                    external_id=external_id,
                    title=title,
                    url="https://jobs.smartrecruiters.com/{0}/{1}".format(company, quote(external_id)),
                    locations=_locations(locations),
                    remote=place.get("remote") if isinstance(place.get("remote"), bool) else None,
                    departments=[
                        _str((item.get("department") or {}).get("label")) if isinstance(item.get("department"), dict) else "",
                        _str((item.get("function") or {}).get("label")) if isinstance(item.get("function"), dict) else "",
                    ],
                    posted_at=_parse_datetime(item.get("releasedDate")),
                    intern=_str(level.get("id")) == "internship",
                    detail_pending=True,
                )
            )
        offset += SMARTRECRUITERS_PAGE_SIZE
        if not items or offset >= (total or 0):
            break
    complete = total is not None and offset >= total

    for job in jobs:
        if not ctx.needs_detail(job):
            continue
        try:
            detail = await ctx.fetcher.get_json("{0}/{1}".format(base, quote(job.external_id)))
        except FetchError:
            continue
        sections = ((detail.get("jobAd") or {}).get("sections") or {}) if isinstance(detail, dict) else {}
        parts = []
        for name in ("jobDescription", "qualifications", "additionalInformation"):
            section = sections.get(name)
            if isinstance(section, dict):
                parts.append(_str(section.get("title")))
                parts.append(html_to_text(_str(section.get("text"), 200_000)))
        job.description = clean_text("\n\n".join(part for part in parts if part))
        job.url = _safe_url(detail.get("postingUrl"), job.url)
        job.detail_pending = False
    return Listing(jobs, complete=complete)


async def _workday(params: Dict[str, Any], url: str, ctx: CrawlContext) -> Listing:
    host, tenant, site = params["host"], params["tenant"], params["site"]
    base = "https://{0}/wday/cxs/{1}/{2}".format(host, quote(tenant), quote(site))
    jobs: List[RawJob] = []
    total = None
    offset = 0
    for _ in range(WORKDAY_MAX_PAGES):
        data = await ctx.fetcher.post_json(
            base + "/jobs",
            {"appliedFacets": {}, "limit": WORKDAY_PAGE_SIZE, "offset": offset, "searchText": ""},
        )
        items = _list(data, "jobPostings")
        if total is None and isinstance(data, dict):
            try:
                total = int(data.get("total") or 0)
            except (TypeError, ValueError):
                total = 0
        for item in items:
            path = _str(item.get("externalPath"), 500)
            title = _title(item.get("title"))
            if not path.startswith("/") or not title:
                continue
            where = _str(item.get("locationsText"))
            # "6 Locations" says nothing about where; the detail has the list.
            locations = [] if where.lower().endswith("locations") else [where]
            jobs.append(
                RawJob(
                    external_id=path,
                    title=title,
                    url=_safe_url("https://{0}/{1}{2}".format(host, site, path), url),
                    locations=_locations(locations),
                    detail_pending=True,
                )
            )
        offset += WORKDAY_PAGE_SIZE
        if not items or offset >= (total or 0):
            break
    # Workday's feed stops at 2,000 postings; past that, a missing job may
    # just be beyond the cap, so nothing is closed.
    complete = total is not None and offset >= total and total < 2_000

    for job in jobs:
        if not ctx.needs_detail(job):
            continue
        try:
            detail = await ctx.fetcher.get_json(base + quote(job.external_id, safe="/-_.~"))
        except FetchError:
            continue
        info = detail.get("jobPostingInfo") if isinstance(detail, dict) else None
        if not isinstance(info, dict):
            continue
        locations = [_str(info.get("location"))]
        locations += [_str(value) for value in info.get("additionalLocations") or [] if isinstance(value, str)]
        job.locations = _locations(locations + job.locations)
        job.description = html_to_text(_str(info.get("jobDescription"), 200_000))
        job.url = _safe_url(info.get("externalUrl"), job.url)
        job.posted_at = _parse_datetime(info.get("startDate"))
        job.intern = "intern" in _str(info.get("timeType")).lower()
        job.detail_pending = False
    return Listing(jobs, complete=complete)


async def _page(params: Dict[str, Any], url: str, ctx: CrawlContext) -> Listing:
    """A careers page that publishes schema.org JobPosting markup."""

    response = await ctx.fetcher.get_page(url)
    parsed = jsonld.parse_page(response.text())
    jobs = [job for job in (_posting_job(posting, response.url, None) for posting in parsed.postings) if job]
    if jobs:
        return Listing(jobs)

    links = jsonld.detail_links(response.url, parsed.anchors, PAGE_DETAIL_LINKS)
    for link in links:
        if ctx.known.get(link):
            jobs.append(RawJob(external_id=link, title="", url=link, seen_only=True))
            continue
        if ctx.detail_budget <= 0:
            continue
        ctx.detail_budget -= 1
        try:
            detail = await ctx.fetcher.get_page(link)
        except FetchError:
            continue
        postings = jsonld.parse_page(detail.text()).postings
        if postings:
            job = _posting_job(postings[0], link, link)
            if job is not None:
                jobs.append(job)
    return Listing(jobs, complete=len(links) < PAGE_DETAIL_LINKS)


def _posting_job(posting: Dict[str, Any], page_url: str, external_id: Optional[str]) -> Optional[RawJob]:
    title = _title(jsonld.text_value(posting.get("title")))
    if not title:
        return None
    link = _safe_url(urljoin(page_url, jsonld.text_value(posting.get("url")) or page_url), page_url)
    locations = _locations(jsonld.posting_locations(posting))
    if external_id is None:
        identifier = posting.get("identifier")
        value = identifier.get("value") if isinstance(identifier, dict) else identifier
        external_id = _str(value) if value not in (None, "") else ""
        if not external_id:
            external_id = link if link != page_url else hashlib.sha256(
                (title + "|" + "|".join(locations)).encode("utf-8")
            ).hexdigest()[:32]
    description = html_to_text(_str(jsonld.text_value(posting.get("description")), 200_000))
    extra = jsonld.posting_experience_text(posting)
    if extra:
        description = clean_text(description + "\n\nExperience: " + _str(extra, 2_000))
    return RawJob(
        external_id=external_id[:500],
        title=title,
        url=link,
        locations=locations,
        remote=jsonld.posting_is_remote(posting),
        departments=[_str(jsonld.text_value(posting.get("occupationalCategory")))],
        description=description,
        posted_at=_parse_datetime(jsonld.text_value(posting.get("datePosted"))),
        intern=jsonld.posting_is_intern(posting),
        months_required=jsonld.posting_months_required(posting),
    )


_ADAPTERS = {
    "greenhouse": _greenhouse,
    "lever": _lever,
    "ashby": _ashby,
    "workable": _workable,
    "smartrecruiters": _smartrecruiters,
    "workday": _workday,
    "page": _page,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _list(data: Any, key: str) -> List[Dict[str, Any]]:
    if not isinstance(data, dict) or not isinstance(data.get(key), list):
        raise FeedError("The job feed returned an unexpected shape")
    return [item for item in data[key] if isinstance(item, dict)]


def _str(value: Any, limit: int = 500) -> str:
    if value is None or isinstance(value, (dict, list)):
        return ""
    return str(value).replace("\x00", "").strip()[:limit]


def _title(value: Any) -> str:
    return " ".join(_str(value, MAX_TITLE_CHARACTERS).split())


def _locations(values: List[str]) -> List[str]:
    seen: List[str] = []
    for value in values:
        cleaned = " ".join((value or "").split())[:200]
        if cleaned and cleaned not in seen:
            seen.append(cleaned)
        if len(seen) >= MAX_LOCATIONS:
            break
    return seen


def _safe_url(value: Any, fallback: str) -> str:
    candidate = _str(value, 1_000)
    if candidate.lower().startswith(("http://", "https://")) and not any(
        ord(character) < 33 for character in candidate
    ):
        return candidate
    return fallback


def _parse_datetime(value: Any) -> Optional[datetime]:
    text = _str(value, 64)
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.strptime(text[:10], "%Y-%m-%d")
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_millis(value: Any) -> Optional[datetime]:
    try:
        return datetime.fromtimestamp(int(value) / 1000.0, tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None
