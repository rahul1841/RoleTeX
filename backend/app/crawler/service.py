"""The crawl cycle, its schedule, matching and Telegram digests.

One cycle:

1. take the ``crawler`` lease (one runner across processes);
2. read every careers page still ``checking``: point it at the board it
   embeds, keep it as a JobPosting page, or mark it ``unsupported``;
3. crawl every due source (bounded concurrency; the fetcher serializes
   requests per host), store new jobs, close vanished ones, and match new
   jobs against each watcher's preferences;
4. prune old closed jobs and sources nobody watches;
5. **when everything is done**, send each user one digest of the cycle's new
   matches — never per company, never mid-crawl.

A company's first crawl, and any recompute after a user edits preferences or
adds companies, creates matches already marked notified: they show on the
site and are summarized in one digest line, so adding 100 companies does not
flood Telegram.

Scheduling: with ``CRAWLER_ENABLED`` every watched source is marked due every
``CRAWL_INTERVAL_HOURS`` (tracked in Mongo, so a restart or a sleeping Space
catches up on wake). Adding a company and "Refresh now" trigger a cycle in any
case; only due sources are crawled then.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Set

from .. import security
from ..db import AuthTokenStore, _as_utc
from .ats import CrawlContext, FeedError, RawJob, crawl_source
from .classify import categorize, detect_remote, experience_required, location_text
from .fetch import FetchError, SafeFetcher
from .jsonld import detail_links, parse_page
from .match import LABEL_RANK, Preferences, could_want, describe_experience, evaluate, preferences_from_doc
from .sources import detect_source, find_embedded_source
from .telegram import (
    EXPIRED_MESSAGE,
    HELP_MESSAGE,
    LINKED_MESSAGE,
    MAX_JOBS_PER_DIGEST,
    POLL_TIMEOUT_SECONDS,
    STOPPED_MESSAGE,
    Notifier,
    NotifierError,
    command,
    format_digest,
    start_payload,
)


logger = logging.getLogger(__name__)

CYCLE_LEASE_SECONDS = 15 * 60
SCHEDULE_TICK_SECONDS = 60
POLL_LEASE_SECONDS = POLL_TIMEOUT_SECONDS + 60
#: A source fails this many crawls in a row before it shows as ``error``.
FAILURES_BEFORE_ERROR = 3
#: Sources nobody watches are kept this long (covers a request mid-insert).
UNWATCHED_GRACE = timedelta(hours=1)
#: Pages checked for JobPosting markup when the careers page itself has none.
RESOLVE_DETAIL_LINKS = 5
USER_AGENT = "RoleTeXBot/0.1"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class CrawlerService:
    def __init__(
        self,
        database: Any,
        config: Any,
        notifier: Notifier,
        fetcher_factory: Optional[Callable[[], Any]] = None,
        now_fn: Callable[[], datetime] = _utc_now,
    ) -> None:
        self.database = database
        self.config = config
        self.notifier = notifier
        self._fetcher_factory = fetcher_factory or self._default_fetcher
        self._now = now_fn
        self._holder = uuid.uuid4().hex
        self._tasks: List["asyncio.Task[Any]"] = []
        self._cycle_task: Optional["asyncio.Task[Any]"] = None
        self._rerun = False
        self.last_cycle_at: Optional[datetime] = None

    # -- lifecycle ------------------------------------------------------------

    @property
    def user_agent(self) -> str:
        base = getattr(self.config, "public_base_url", "") or ""
        return "{0} (+{1})".format(USER_AGENT, base) if base else USER_AGENT

    def _default_fetcher(self) -> SafeFetcher:
        return SafeFetcher(
            timeout_seconds=self.config.crawl_timeout_seconds,
            max_bytes=self.config.crawl_max_response_bytes,
            user_agent=self.user_agent,
        )

    def start(self) -> None:
        loop = asyncio.get_running_loop()
        if self.config.crawler_enabled:
            self._tasks.append(loop.create_task(self._schedule_loop()))
        if self.notifier.configured:
            self._tasks.append(loop.create_task(self._poll_loop()))

    async def stop(self) -> None:
        tasks = list(self._tasks)
        if self._cycle_task is not None:
            tasks.append(self._cycle_task)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks = []
        try:
            await self.notifier.close()
        except Exception:
            pass

    @property
    def running(self) -> bool:
        return self._cycle_task is not None and not self._cycle_task.done()

    def trigger(self) -> None:
        """Crawl what is due soon; a cycle already running is followed by another."""

        if self.running:
            self._rerun = True
            return
        self._cycle_task = asyncio.get_running_loop().create_task(self._run_cycles())

    async def _run_cycles(self) -> None:
        while True:
            self._rerun = False
            try:
                await self.run_cycle()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Crawl cycle failed")
            if not self._rerun:
                return

    async def _schedule_loop(self) -> None:
        interval = timedelta(hours=self.config.crawl_interval_hours)
        state = self.database.system_state
        while True:
            try:
                last = await state.get_value("last_scheduled_crawl")
                now = self._now()
                last = _as_utc(last) if isinstance(last, datetime) else None
                if (last is None or last + interval <= now) and await state.acquire_lease(
                    "crawl_schedule", self._holder, SCHEDULE_TICK_SECONDS * 5
                ):
                    watched = await self.database.watchlist.watched_source_ids()
                    await self.database.career_sources.recheck_pages(watched)
                    await self.database.career_sources.mark_due(watched, now)
                    await state.set_value("last_scheduled_crawl", now)
                    self.trigger()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Crawl scheduling failed: %s", type(exc).__name__)
            await asyncio.sleep(SCHEDULE_TICK_SECONDS)

    # -- user actions ----------------------------------------------------------

    async def refresh_user(self, user_id: str) -> int:
        """Mark a user's sources due (and re-read their careers pages), then crawl."""

        source_ids = await self.database.watchlist.source_ids_for_user(user_id)
        await self.database.career_sources.recheck_pages(source_ids)
        await self.database.career_sources.mark_due(source_ids, self._now())
        self.trigger()
        return len(source_ids)

    async def recompute_user(self, user_id: str, only_sources: Optional[List[str]] = None) -> int:
        """Bring one user's matches in line with their preferences.

        Used after preferences change and after companies are added. New
        matches are created already notified: the user is looking at the site,
        and a recompute must never turn into a Telegram flood. Saved and
        dismissed matches are left alone.
        """

        db = self.database
        user = await db.users.get(user_id)
        if user is None:
            return 0
        prefs = preferences_from_doc(user.get("job_prefs"))
        rows = await db.watchlist.list_for_user(user_id)
        names = {}
        for row in rows:
            names.setdefault(row.get("source_id"), row.get("company_name", ""))
        source_ids = list(only_sources) if only_sources is not None else list(names)
        jobs = await db.jobs.open_complete_for_sources(source_ids)
        scope = set(source_ids)
        existing = {
            match["job_id"]: match
            for match in await db.job_matches.all_for_user(user_id)
            if match.get("source_id") in scope
        }

        desired: Dict[str, Dict[str, Any]] = {}
        if prefs is not None:
            for job in jobs:
                label = evaluate(job, prefs)
                if label is not None:
                    desired[job["_id"]] = {"job": job, "label": label}

        now = self._now()
        fresh = []
        relabel = []
        for job_id, entry in desired.items():
            match = existing.get(job_id)
            if match is None:
                job = entry["job"]
                fresh.append(
                    {
                        "job_id": job_id,
                        "source_id": job["source_id"],
                        "company_name": names.get(job["source_id"], ""),
                        "label": entry["label"],
                    }
                )
            elif match.get("label") != entry["label"]:
                relabel.append((match["_id"], entry["label"]))
        added = await db.job_matches.bulk_add(user_id, fresh, now)
        await db.job_matches.bulk_set_labels(relabel)
        stale = [
            match["_id"]
            for job_id, match in existing.items()
            if job_id not in desired and match.get("state") in ("new", "seen")
        ]
        await db.job_matches.delete_ids(user_id, stale)
        return added

    async def after_companies_added(self, user_id: str, source_ids: List[str]) -> None:
        """Match already-crawled sources at once; crawl the new ones."""

        sources = await self.database.career_sources.get_many(source_ids)
        crawled = [sid for sid, doc in sources.items() if doc.get("last_crawled_at") is not None]
        if crawled:
            await self.recompute_user(user_id, crawled)
        if len(crawled) < len(source_ids):
            self.trigger()

    # -- the cycle -------------------------------------------------------------

    async def run_cycle(self) -> Dict[str, int]:
        db = self.database
        if not await db.system_state.acquire_lease("crawler", self._holder, CYCLE_LEASE_SECONDS):
            return {"skipped": 1}
        report = {"resolved": 0, "crawled": 0, "failed": 0, "new_jobs": 0}
        backlog: Dict[str, int] = {}
        fetcher = self._fetcher_factory()
        semaphore = asyncio.Semaphore(max(1, int(self.config.crawl_concurrency)))
        try:
            watched = await db.watchlist.watched_source_ids()

            async def resolve(source: Dict[str, Any]) -> None:
                async with semaphore:
                    await self._resolve_page(fetcher, source, backlog)
                    report["resolved"] += 1
                    await self._renew_lease()

            await asyncio.gather(*(resolve(source) for source in await db.career_sources.checking(watched)))

            watched = await db.watchlist.watched_source_ids()
            due = await db.career_sources.due(watched, self._now())

            async def crawl(source: Dict[str, Any]) -> None:
                async with semaphore:
                    created = await self._crawl_source(fetcher, source, backlog)
                    if created is None:
                        report["failed"] += 1
                    else:
                        report["crawled"] += 1
                        report["new_jobs"] += created
                    await self._renew_lease()

            await asyncio.gather(*(crawl(source) for source in due))
            await self._prune(watched)
            await self._send_digests(backlog)
        finally:
            await fetcher.close()
            await db.system_state.release_lease("crawler", self._holder)
            self.last_cycle_at = self._now()
        logger.info("Crawl cycle: %s", report)
        return report

    async def _renew_lease(self) -> None:
        await self.database.system_state.acquire_lease("crawler", self._holder, CYCLE_LEASE_SECONDS)

    async def _resolve_page(self, fetcher: Any, source: Dict[str, Any], backlog: Dict[str, int]) -> None:
        """Read a careers page once: embedded board, JobPosting page, or unsupported."""

        db = self.database
        source_id = source["_id"]
        try:
            response = await fetcher.get_page(source["url"])
        except FetchError as exc:
            await db.career_sources.update(source_id, {"status": "error", "last_error": exc.code})
            return
        markup = response.text()
        board = detect_source(response.url) or find_embedded_source(markup)
        if board is not None:
            target = await db.career_sources.get_or_create(
                board.key, board.kind, board.params, board.url, board.label
            )
            watchers = await db.watchlist.watchers(source_id)
            await db.watchlist.repoint(source_id, target["_id"])
            await db.career_sources.update(
                source_id, {"status": "ready", "alias_of": target["_id"], "last_error": None}
            )
            if target.get("last_crawled_at") is not None:
                # Another user's crawl already read this board.
                for user_id in {watcher["user_id"] for watcher in watchers}:
                    added = await self.recompute_user(user_id, [target["_id"]])
                    if added:
                        backlog[user_id] = backlog.get(user_id, 0) + added
            return

        parsed = parse_page(markup)
        has_postings = bool(parsed.postings)
        if not has_postings:
            for link in detail_links(response.url, parsed.anchors, RESOLVE_DETAIL_LINKS):
                try:
                    detail = await fetcher.get_page(link)
                except FetchError:
                    continue
                if parse_page(detail.text()).postings:
                    has_postings = True
                    break
        if has_postings:
            await db.career_sources.update(
                source_id,
                {"status": "ready", "page_mode": "jsonld", "last_error": None, "due_at": self._now()},
            )
        else:
            await db.career_sources.update(source_id, {"status": "unsupported", "last_error": "no_job_data"})

    async def _crawl_source(
        self, fetcher: Any, source: Dict[str, Any], backlog: Dict[str, int]
    ) -> Optional[int]:
        """Crawl one source; returns the number of new jobs, or None on failure."""

        db = self.database
        source_id = source["_id"]
        watchers = await db.watchlist.watchers(source_id)
        if not watchers:
            return 0
        names: Dict[str, str] = {}
        for watcher in watchers:
            names.setdefault(watcher["user_id"], watcher.get("company_name", ""))
        prefs_by_user: Dict[str, Preferences] = {}
        for user in await db.users.get_many(list(names)):
            prefs = preferences_from_doc(user.get("job_prefs"))
            if prefs is not None and not user.get("disabled", False):
                prefs_by_user[user["_id"]] = prefs

        def want(raw: RawJob) -> bool:
            categories = categorize(raw.title, raw.departments)
            remote = detect_remote(raw.locations, raw.remote)
            return any(
                could_want(categories, raw.locations, remote, prefs) for prefs in prefs_by_user.values()
            )

        known_docs = await db.jobs.known(source_id)
        context = CrawlContext(
            fetcher=fetcher,
            known={external_id: bool(doc.get("complete")) for external_id, doc in known_docs.items()},
            want=want,
        )
        try:
            listing = await crawl_source(source["kind"], source.get("params") or {}, source["url"], context)
        except (FetchError, FeedError) as exc:
            failures = int(source.get("consecutive_failures") or 0) + 1
            await db.career_sources.update(
                source_id,
                {
                    "consecutive_failures": failures,
                    "last_error": getattr(exc, "code", "bad_feed"),
                    "status": "error" if failures >= FAILURES_BEFORE_ERROR else source.get("status", "ready"),
                    "due_at": None,
                },
            )
            logger.info("Crawl of source %s failed: %s", source_id, getattr(exc, "code", "bad_feed"))
            return None

        now = self._now()
        new_docs: List[Dict[str, Any]] = []
        new_ids: Set[str] = set()
        completed: List[Dict[str, Any]] = []
        seen_known: List[str] = []
        for raw in listing.jobs:
            existing = known_docs.get(raw.external_id)
            if existing is not None:
                seen_known.append(raw.external_id)
                if (
                    not existing.get("complete")
                    and raw.description is not None
                    and not raw.detail_pending
                ):
                    fields = self._job_fields(raw)
                    fields["complete"] = True
                    await db.jobs.update(existing["_id"], fields)
                    completed.append(dict(fields, _id=existing["_id"], source_id=source_id))
                continue
            if raw.seen_only or raw.external_id in new_ids:
                continue
            new_ids.add(raw.external_id)
            doc = self._job_fields(raw)
            doc.update(
                {
                    "_id": uuid.uuid4().hex,
                    "source_id": source_id,
                    "external_id": raw.external_id,
                    "complete": raw.description is not None and not raw.detail_pending,
                    "first_seen_at": now,
                    "last_seen_at": now,
                    "closed_at": None,
                }
            )
            new_docs.append(doc)
            if doc["complete"]:
                completed.append(doc)
        await db.jobs.insert_many(new_docs)
        await db.jobs.mark_seen(source_id, seen_known, now)
        if listing.complete:
            await db.jobs.close_unseen(source_id, now)

        initial = source.get("last_crawled_at") is None
        notified_at = now if initial else None
        for user_id, prefs in prefs_by_user.items():
            entries = []
            for job in completed:
                label = evaluate(job, prefs)
                if label is not None:
                    entries.append(
                        {
                            "job_id": job["_id"],
                            "source_id": source_id,
                            "company_name": names.get(user_id, ""),
                            "label": label,
                        }
                    )
            added = await db.job_matches.bulk_add(user_id, entries, notified_at)
            if initial and added:
                backlog[user_id] = backlog.get(user_id, 0) + added

        await db.career_sources.update(
            source_id,
            {
                "status": "ready",
                "last_crawled_at": now,
                "last_error": None,
                "consecutive_failures": 0,
                "due_at": None,
                "open_jobs": await db.jobs.count_open(source_id),
            },
        )
        return len(new_docs)

    @staticmethod
    def _job_fields(raw: RawJob) -> Dict[str, Any]:
        description = raw.description or ""
        minimum, maximum, basis = experience_required(
            raw.title, description, raw.months_required, raw.intern
        )
        remote = detect_remote(raw.locations, raw.remote)
        locations = raw.locations[:20]
        display = "; ".join(locations[:3])
        if len(locations) > 3:
            display += " +{0}".format(len(locations) - 3)
        if not display and remote:
            display = "Remote"
        departments = [department for department in raw.departments if department][:5]
        return {
            "title": raw.title,
            "url": raw.url,
            "location": display[:300],
            "location_text": location_text(locations),
            "remote": remote,
            "departments": departments,
            "categories": categorize(raw.title, departments),
            "description": description,
            "exp_min_months": minimum,
            "exp_max_months": maximum,
            "exp_basis": basis,
            "posted_at": raw.posted_at,
        }

    async def _prune(self, watched: List[str]) -> None:
        db = self.database
        now = self._now()
        pruned = await db.jobs.prune_closed(now - timedelta(days=self.config.job_retention_days))
        await db.job_matches.delete_for_jobs(pruned)
        stale = await db.career_sources.unwatched_ids(
            await db.watchlist.watched_source_ids(), now - UNWATCHED_GRACE
        )
        if stale:
            job_ids = await db.jobs.delete_for_sources(stale)
            await db.job_matches.delete_for_jobs(job_ids)
            await db.career_sources.delete_many(stale)

    # -- digests -----------------------------------------------------------------

    def _jobs_url(self) -> str:
        base = getattr(self.config, "public_base_url", "") or ""
        return base + "/jobs/" if base else ""

    async def _send_digests(self, backlog: Dict[str, int]) -> None:
        db = self.database
        user_ids: Set[str] = set(await db.job_matches.pending_user_ids()) | set(backlog)
        if not user_ids:
            return
        now = self._now()
        for user in await db.users.get_many(sorted(user_ids)):
            user_id = user["_id"]
            chat_id = (user.get("telegram") or {}).get("chat_id")
            if chat_id is None or not self.notifier.configured or user.get("disabled", False):
                # Seen on the website; never replayed into a chat linked later.
                await db.job_matches.mark_notified(user_id, now)
                continue
            pending = await db.job_matches.pending_for_user(user_id, MAX_JOBS_PER_DIGEST * 4)
            total = await db.job_matches.count_pending(user_id)
            if not total and not backlog.get(user_id):
                continue
            jobs = await db.jobs.get_many([match["job_id"] for match in pending])
            pending.sort(key=lambda match: LABEL_RANK.get(match.get("label", ""), 9))
            items = []
            for match in pending:
                job = jobs.get(match["job_id"])
                if job is None:
                    continue
                experience = describe_experience(job.get("exp_min_months"), job.get("exp_max_months"))
                items.append(
                    {
                        "company": match.get("company_name", ""),
                        "title": job.get("title", ""),
                        "location": job.get("location", ""),
                        "experience": experience,
                        "label": {"fits": "fits", "stretch": "stretch"}.get(match.get("label", ""), ""),
                        "url": job.get("url", ""),
                    }
                )
            try:
                for message in format_digest(items, total, backlog.get(user_id, 0), self._jobs_url()):
                    await self.notifier.send(chat_id, message)
                    await asyncio.sleep(1.0)  # Telegram: about one message a second per chat
            except NotifierError as exc:
                if exc.code in ("blocked", "chat_not_found"):
                    await db.users.unlink_telegram_chat(chat_id)
                    await db.job_matches.mark_notified(user_id, now)
                else:
                    logger.warning("Telegram digest not sent (%s); retrying next cycle", exc.code)
                continue
            await db.job_matches.mark_notified(user_id, now)

    # -- the bot -------------------------------------------------------------------

    async def _poll_loop(self) -> None:
        state = self.database.system_state
        try:
            await self.notifier.delete_webhook()
        except NotifierError as exc:
            logger.warning("Telegram deleteWebhook failed: %s", exc.code)
        while True:
            try:
                if not await state.acquire_lease("telegram_poller", self._holder, POLL_LEASE_SECONDS):
                    await asyncio.sleep(30)
                    continue
                offset = int(await state.get_value("telegram_offset") or 0)
                updates = await self.notifier.get_updates(offset, POLL_TIMEOUT_SECONDS)
                for update in updates:
                    try:
                        offset = max(offset, int(update.get("update_id", 0)) + 1)
                    except (TypeError, ValueError):
                        continue
                    try:
                        await self.handle_update(update)
                    except Exception:
                        logger.exception("Could not handle a Telegram update")
                if updates:
                    await state.set_value("telegram_offset", offset)
            except asyncio.CancelledError:
                raise
            except NotifierError as exc:
                logger.warning("Telegram polling failed: %s", exc.code)
                await asyncio.sleep(10)
            except Exception as exc:
                logger.warning("Telegram polling failed: %s", type(exc).__name__)
                await asyncio.sleep(10)

    async def handle_update(self, update: Dict[str, Any]) -> None:
        message = update.get("message")
        if not isinstance(message, dict):
            return
        chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
        chat_id = chat.get("id")
        if chat.get("type") != "private" or not isinstance(chat_id, int):
            return
        text = message.get("text") if isinstance(message.get("text"), str) else ""
        name = command(text)
        db = self.database
        if name == "/start":
            payload = start_payload(text)
            if payload is None:
                await self._reply(chat_id, HELP_MESSAGE)
                return
            record = await db.auth_tokens.consume(
                AuthTokenStore.PURPOSE_TELEGRAM_LINK, security.hash_token(payload)
            )
            if record is None:
                await self._reply(chat_id, EXPIRED_MESSAGE)
                return
            await db.users.link_telegram(record["user_id"], chat_id)
            await self._reply(chat_id, LINKED_MESSAGE)
        elif name == "/stop":
            unlinked = await db.users.unlink_telegram_chat(chat_id)
            await self._reply(chat_id, STOPPED_MESSAGE if unlinked else HELP_MESSAGE)

    async def _reply(self, chat_id: int, text: str) -> None:
        try:
            await self.notifier.send(chat_id, text)
        except NotifierError as exc:
            logger.info("Telegram reply not sent: %s", exc.code)
