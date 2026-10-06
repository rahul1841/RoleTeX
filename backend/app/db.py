"""MongoDB persistence layer: one `Database` wrapper plus per-collection stores.

Security rationale:
- Every store method is scoped by ``user_id`` **inside the Mongo query**, so a
  forged or guessed document id can never read or mutate another user's data —
  ownership is enforced at the lowest layer, not in route handlers.
- All ids are server-generated ``uuid4().hex`` strings; client-supplied ids are
  only ever used as query filter values, never interpolated into operators.
- Session documents store only token *hashes*; expiry is checked in code on
  every read because Mongo's TTL monitor is lazy (typically a 60s sweep).
- API-key documents hold Fernet ciphertext plus a display hint — never the
  plaintext key.
- ``from_env`` refuses to start without ``MONGODB_URI``: every feature is
  per-user, so there is nothing useful to serve without a database.

All timestamps are timezone-aware UTC datetimes. The motor client is created
with ``tz_aware=True``; ``_as_utc`` defensively normalizes naive values from
alternative drivers (e.g. mongomock in tests).
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from pymongo import ReturnDocument, UpdateOne
from pymongo.errors import BulkWriteError, DuplicateKeyError


logger = logging.getLogger(__name__)


class DatabaseError(RuntimeError):
    """Base class for persistence failures surfaced to the API layer."""


class DuplicateEmailError(DatabaseError):
    """Raised when registering an email that already has an account."""


def _new_id() -> str:
    return uuid.uuid4().hex


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Treat naive datetimes as UTC (mongomock returns naive values)."""

    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Stores
# ---------------------------------------------------------------------------


class UserStore:
    """Accounts. Unique on ``email`` (enforced by index and a pre-check)."""

    _UPDATABLE_FIELDS = (
        "name",
        "default_provider",
        "default_model",
        "provider_models",
        "password_hash",
        "password_changed_at",
        "email_verified",
        "email_verified_at",
        "disabled",
        "job_prefs",
    )

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    async def create(self, email: str, password_hash: str, name: str = "") -> Dict[str, Any]:
        existing = await self._collection.find_one({"email": email})
        if existing is not None:
            raise DuplicateEmailError("An account with this email already exists")
        now = _utc_now()
        doc = {
            "_id": _new_id(),
            "email": email,
            "password_hash": password_hash,
            "name": name,
            "default_provider": None,
            "provider_models": {},
            # Accounts created before these fields existed read as unverified
            # and enabled via ``.get(..., default)`` at every call site.
            "email_verified": False,
            "email_verified_at": None,
            "disabled": False,
            "password_changed_at": now,
            "created_at": now,
            "updated_at": now,
        }
        try:
            await self._collection.insert_one(doc)
        except DuplicateKeyError as exc:
            raise DuplicateEmailError("An account with this email already exists") from exc
        return doc

    async def get(self, user_id: str) -> Optional[Dict[str, Any]]:
        return await self._collection.find_one({"_id": user_id})

    async def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        return await self._collection.find_one({"email": email})

    async def update(self, user_id: str, fields: Dict[str, Any]) -> None:
        updates = {
            key: value for key, value in fields.items() if key in self._UPDATABLE_FIELDS
        }
        if not updates:
            return
        updates["updated_at"] = _utc_now()
        await self._collection.update_one({"_id": user_id}, {"$set": updates})

    async def delete(self, user_id: str) -> None:
        await self._collection.delete_one({"_id": user_id})

    async def get_many(self, user_ids: List[str]) -> List[Dict[str, Any]]:
        """Job-watch fields for several users; never password material."""

        if not user_ids:
            return []
        cursor = self._collection.find(
            {"_id": {"$in": list(user_ids)}},
            {"job_prefs": 1, "telegram": 1, "disabled": 1},
        )
        return await cursor.to_list(length=None)

    async def link_telegram(self, user_id: str, chat_id: int) -> None:
        """Bind a Telegram chat to one account, unbinding it from any other."""

        now = _utc_now()
        await self._collection.update_many(
            {"telegram.chat_id": chat_id, "_id": {"$ne": user_id}},
            {"$unset": {"telegram": ""}},
        )
        await self._collection.update_one(
            {"_id": user_id},
            {"$set": {"telegram": {"chat_id": chat_id, "linked_at": now}, "updated_at": now}},
        )

    async def unlink_telegram(self, user_id: str) -> None:
        await self._collection.update_one({"_id": user_id}, {"$unset": {"telegram": ""}})

    async def unlink_telegram_chat(self, chat_id: int) -> int:
        """Forget a chat that stopped the bot or blocked it; returns accounts touched."""

        result = await self._collection.update_many(
            {"telegram.chat_id": chat_id}, {"$unset": {"telegram": ""}}
        )
        return int(getattr(result, "modified_count", 0))


class SessionStore:
    """Server-side sessions keyed by SHA-256 token hash.

    A TTL index reaps expired documents eventually; ``get`` still checks
    ``expires_at`` on every read because the TTL monitor is lazy.
    """

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    async def create(self, user_id: str, token_hash: str, expires_at: datetime) -> None:
        await self._collection.insert_one(
            {
                "_id": _new_id(),
                "user_id": user_id,
                "token_hash": token_hash,
                "expires_at": expires_at,
            }
        )

    async def get(self, token_hash: str) -> Optional[Dict[str, Any]]:
        doc = await self._collection.find_one({"token_hash": token_hash})
        if doc is None:
            return None
        expires_at = _as_utc(doc.get("expires_at"))
        if expires_at is None or expires_at <= _utc_now():
            return None
        return doc

    async def touch(self, token_hash: str, expires_at: datetime) -> None:
        await self._collection.update_one(
            {"token_hash": token_hash},
            {"$set": {"expires_at": expires_at}},
        )

    async def delete_for_user_except(self, user_id: str, keep_token_hash: str) -> int:
        """Revoke every session for a user except the one making the request."""

        result = await self._collection.delete_many(
            {"user_id": user_id, "token_hash": {"$ne": keep_token_hash}}
        )
        return int(getattr(result, "deleted_count", 0))

    async def delete(self, token_hash: str) -> None:
        await self._collection.delete_one({"token_hash": token_hash})

    async def delete_for_user(self, user_id: str) -> None:
        await self._collection.delete_many({"user_id": user_id})


class AuthTokenStore:
    """Single-use, expiring tokens for password reset and email verification.

    Only the SHA-256 hash of a token is stored, exactly as for sessions, so a
    database leak yields nothing usable. ``consume`` is a conditional
    ``find_one_and_update`` on ``used_at: None``: two concurrent redemptions of
    the same token can never both succeed, because only the update that flips
    the field observes the unused document.
    """

    PURPOSE_PASSWORD_RESET = "password_reset"
    PURPOSE_EMAIL_VERIFY = "email_verify"
    PURPOSE_TELEGRAM_LINK = "telegram_link"

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    async def create(
        self, user_id: str, purpose: str, token_hash: str, expires_at: datetime
    ) -> None:
        await self._collection.insert_one(
            {
                "_id": _new_id(),
                "user_id": user_id,
                "purpose": purpose,
                "token_hash": token_hash,
                "created_at": _utc_now(),
                "expires_at": expires_at,
                "used_at": None,
            }
        )

    async def consume(self, purpose: str, token_hash: str) -> Optional[Dict[str, Any]]:
        """Atomically redeem a token; None when unknown, spent, or expired."""

        doc = await self._collection.find_one_and_update(
            {"purpose": purpose, "token_hash": token_hash, "used_at": None},
            {"$set": {"used_at": _utc_now()}},
            return_document=ReturnDocument.BEFORE,
        )
        if doc is None:
            return None
        expires_at = _as_utc(doc.get("expires_at"))
        if expires_at is None or expires_at <= _utc_now():
            return None
        return doc

    async def delete_for_user(
        self, user_id: str, purpose: Optional[str] = None
    ) -> None:
        """Invalidate outstanding tokens (on password change, reset, or delete)."""

        query: Dict[str, Any] = {"user_id": user_id}
        if purpose is not None:
            query["purpose"] = purpose
        await self._collection.delete_many(query)


class SignupCodeStore:
    """Pending sign-up codes, one per email, stored only as an HMAC.

    ``redeem`` is an atomic find-and-delete, so a code works once even under
    concurrent submits; ``max_attempts`` wrong guesses delete it. A TTL index
    on ``expires_at`` sweeps expired codes.
    """

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    async def put(self, email: str, code_hash: str, expires_at: datetime) -> None:
        now = _utc_now()
        await self._collection.replace_one(
            {"email": email},
            {
                "email": email,
                "code_hash": code_hash,
                "attempts": 0,
                "created_at": now,
                "expires_at": expires_at,
            },
            upsert=True,
        )

    async def redeem(self, email: str, code_hash: str, max_attempts: int) -> bool:
        """Consume the code if it matches, is unexpired and not locked out."""

        doc = await self._collection.find_one_and_delete(
            {
                "email": email,
                "code_hash": code_hash,
                "expires_at": {"$gt": _utc_now()},
                "attempts": {"$lt": max_attempts},
            }
        )
        return doc is not None

    async def record_failure(self, email: str, max_attempts: int) -> Optional[int]:
        """Count a wrong guess; return attempts left, or None if no live code."""

        doc = await self._collection.find_one_and_update(
            {"email": email, "expires_at": {"$gt": _utc_now()}},
            {"$inc": {"attempts": 1}},
            return_document=ReturnDocument.AFTER,
        )
        if doc is None:
            return None
        remaining = max_attempts - int(doc.get("attempts", max_attempts))
        if remaining <= 0:
            await self._collection.delete_one({"_id": doc["_id"]})
            return None
        return remaining

    async def delete(self, email: str) -> None:
        await self._collection.delete_one({"email": email})


class ApiKeyStore:
    """Encrypted provider keys, one document per (user, provider)."""

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    async def upsert(self, user_id: str, provider: str, ciphertext: str, hint: str) -> None:
        now = _utc_now()
        updated = await self._collection.update_one(
            {"user_id": user_id, "provider": provider},
            {"$set": {"ciphertext": ciphertext, "hint": hint, "updated_at": now}},
        )
        if updated.matched_count:
            return
        try:
            await self._collection.insert_one(
                {
                    "_id": _new_id(),
                    "user_id": user_id,
                    "provider": provider,
                    "ciphertext": ciphertext,
                    "hint": hint,
                    "created_at": now,
                    "updated_at": now,
                }
            )
        except DuplicateKeyError:
            # Lost a concurrent insert race; apply as an update instead.
            await self._collection.update_one(
                {"user_id": user_id, "provider": provider},
                {"$set": {"ciphertext": ciphertext, "hint": hint, "updated_at": now}},
            )

    async def get(self, user_id: str, provider: str) -> Optional[Dict[str, Any]]:
        return await self._collection.find_one({"user_id": user_id, "provider": provider})

    async def list_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = self._collection.find({"user_id": user_id}).sort("provider", 1)
        return await cursor.to_list(length=None)

    async def delete(self, user_id: str, provider: str) -> bool:
        result = await self._collection.delete_one(
            {"user_id": user_id, "provider": provider}
        )
        return result.deleted_count > 0

    async def delete_for_user(self, user_id: str) -> None:
        await self._collection.delete_many({"user_id": user_id})


class ResumeStore:
    """One document per resume; saving replaces its content in place.

    resume doc: {_id, user_id, name, source_type, style, provider, model,
                 data, template_tex, created_at, updated_at}
    """

    # Large fields a list view never needs.
    _CONTENT_FIELDS = ("data", "template_tex")

    def __init__(self, resumes: Any) -> None:
        self._resumes = resumes

    async def create(
        self,
        user_id: str,
        name: str,
        source_type: str,
        data: Dict[str, Any],
        template_tex: str,
        style: Dict[str, Any],
        provider: str,
        model: str,
    ) -> Dict[str, Any]:
        now = _utc_now()
        resume_doc = {
            "_id": _new_id(),
            "user_id": user_id,
            "name": name,
            "source_type": source_type,
            "style": style,
            "provider": provider,
            "model": model,
            "data": data,
            "template_tex": template_tex,
            "created_at": now,
            "updated_at": now,
        }
        await self._resumes.insert_one(resume_doc)
        return resume_doc

    async def replace_content(
        self,
        user_id: str,
        resume_id: str,
        source_type: str,
        data: Dict[str, Any],
        template_tex: str,
        style: Dict[str, Any],
        provider: str,
        model: str,
    ) -> Optional[Dict[str, Any]]:
        """Overwrite a resume's content; None when it is not this user's."""

        return await self._resumes.find_one_and_update(
            {"_id": resume_id, "user_id": user_id},
            {
                "$set": {
                    "source_type": source_type,
                    "style": style,
                    "provider": provider,
                    "model": model,
                    "data": data,
                    "template_tex": template_tex,
                    "updated_at": _utc_now(),
                },
            },
            return_document=ReturnDocument.AFTER,
        )

    async def list_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        projection = {field: 0 for field in self._CONTENT_FIELDS}
        cursor = (
            self._resumes.find({"user_id": user_id}, projection).sort("updated_at", -1)
        )
        return await cursor.to_list(length=None)

    async def get(self, user_id: str, resume_id: str) -> Optional[Dict[str, Any]]:
        return await self._resumes.find_one({"_id": resume_id, "user_id": user_id})

    async def rename(self, user_id: str, resume_id: str, name: str) -> bool:
        result = await self._resumes.update_one(
            {"_id": resume_id, "user_id": user_id},
            {"$set": {"name": name, "updated_at": _utc_now()}},
        )
        return result.matched_count > 0

    async def delete(self, user_id: str, resume_id: str) -> bool:
        result = await self._resumes.delete_one({"_id": resume_id, "user_id": user_id})
        return result.deleted_count > 0

    async def delete_for_user(self, user_id: str) -> None:
        await self._resumes.delete_many({"user_id": user_id})

    async def count_for_user(self, user_id: str) -> int:
        return await self._resumes.count_documents({"user_id": user_id})


class JdStore:
    """Job descriptions; editing one overwrites it in place.

    jd doc: {_id, user_id, title, content, created_at, updated_at}
    """

    def __init__(self, jds: Any) -> None:
        self._jds = jds

    async def create(self, user_id: str, title: str, content: str) -> Dict[str, Any]:
        now = _utc_now()
        doc = {
            "_id": _new_id(),
            "user_id": user_id,
            "title": title,
            "content": content,
            "created_at": now,
            "updated_at": now,
        }
        await self._jds.insert_one(doc)
        return doc

    async def update(
        self,
        user_id: str,
        jd_id: str,
        title: Optional[str],
        content: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        """Overwrite the title and/or content; None when it is not this user's."""

        updates: Dict[str, Any] = {"updated_at": _utc_now()}
        if title is not None:
            updates["title"] = title
        if content is not None:
            updates["content"] = content
        return await self._jds.find_one_and_update(
            {"_id": jd_id, "user_id": user_id},
            {"$set": updates},
            return_document=ReturnDocument.AFTER,
        )

    async def list_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = self._jds.find({"user_id": user_id}).sort("updated_at", -1)
        return await cursor.to_list(length=None)

    async def get(self, user_id: str, jd_id: str) -> Optional[Dict[str, Any]]:
        return await self._jds.find_one({"_id": jd_id, "user_id": user_id})

    async def delete(self, user_id: str, jd_id: str) -> bool:
        result = await self._jds.delete_one({"_id": jd_id, "user_id": user_id})
        return result.deleted_count > 0

    async def delete_for_user(self, user_id: str) -> None:
        await self._jds.delete_many({"user_id": user_id})

    async def count_for_user(self, user_id: str) -> int:
        return await self._jds.count_documents({"user_id": user_id})


class RunStore:
    """Persisted tailor runs; oldest are pruned beyond a per-user cap."""

    _DETAIL_ONLY_FIELDS = ("proposal", "changes", "unified_diff", "latex_source", "warnings")

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    async def create(
        self, user_id: str, doc: Dict[str, Any], max_runs: Optional[int] = None
    ) -> str:
        """Insert a run document, then prune the user's oldest runs.

        ``max_runs`` is the caller-supplied cap (``config.max_runs_per_user``);
        None disables pruning. Server-controlled fields (_id, user_id,
        created_at) always override whatever the caller passed.
        """

        stored = dict(doc)
        stored["_id"] = _new_id()
        stored["user_id"] = user_id
        stored.setdefault("created_at", _utc_now())
        await self._collection.insert_one(stored)
        if max_runs is not None and max_runs > 0:
            await self._prune(user_id, max_runs)
        return stored["_id"]

    async def list_for_user(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        projection = {field: 0 for field in self._DETAIL_ONLY_FIELDS}
        cursor = (
            self._collection.find({"user_id": user_id}, projection)
            .sort("created_at", -1)
            .limit(max(1, int(limit)))
        )
        return await cursor.to_list(length=None)

    async def get(self, user_id: str, run_id: str) -> Optional[Dict[str, Any]]:
        return await self._collection.find_one({"_id": run_id, "user_id": user_id})

    async def delete(self, user_id: str, run_id: str) -> bool:
        result = await self._collection.delete_one({"_id": run_id, "user_id": user_id})
        return result.deleted_count > 0

    async def delete_for_user(self, user_id: str) -> None:
        await self._collection.delete_many({"user_id": user_id})

    async def _prune(self, user_id: str, max_runs: int) -> None:
        count = await self._collection.count_documents({"user_id": user_id})
        excess = count - max_runs
        if excess <= 0:
            return
        cursor = (
            self._collection.find({"user_id": user_id}, {"_id": 1})
            .sort("created_at", 1)
            .limit(excess)
        )
        oldest = await cursor.to_list(length=excess)
        ids = [doc["_id"] for doc in oldest]
        if ids:
            await self._collection.delete_many(
                {"_id": {"$in": ids}, "user_id": user_id}
            )


# ---------------------------------------------------------------------------
# Job watch: watchlist (per user), career sources and jobs (shared), matches
# ---------------------------------------------------------------------------


class WatchlistStore:
    """The companies a user follows, one row per careers link.

    watch doc: {_id, user_id, company_name, link, link_key, source_id,
                created_at, updated_at}

    ``link_key`` is the source key for a job-board link and the normalized URL
    for any other page, so the same board pasted twice is one row.
    """

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    async def list_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = self._collection.find({"user_id": user_id}).sort("created_at", -1)
        return await cursor.to_list(length=None)

    async def count_for_user(self, user_id: str) -> int:
        return await self._collection.count_documents({"user_id": user_id})

    async def keys_for_user(self, user_id: str) -> List[str]:
        return await self._collection.distinct("link_key", {"user_id": user_id})

    async def insert_many(self, user_id: str, rows: List[Dict[str, Any]]) -> int:
        """Insert rows, skipping any whose ``link_key`` the user already has."""

        now = _utc_now()
        inserted = 0
        for row in rows:
            doc = {
                "_id": _new_id(),
                "user_id": user_id,
                "company_name": row["company_name"],
                "link": row["link"],
                "link_key": row["link_key"],
                "source_id": row["source_id"],
                "created_at": now,
                "updated_at": now,
            }
            try:
                await self._collection.insert_one(doc)
                inserted += 1
            except DuplicateKeyError:
                continue
        return inserted

    async def get(self, user_id: str, item_id: str) -> Optional[Dict[str, Any]]:
        return await self._collection.find_one({"_id": item_id, "user_id": user_id})

    async def update(
        self, user_id: str, item_id: str, fields: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        updates = dict(fields)
        updates["updated_at"] = _utc_now()
        return await self._collection.find_one_and_update(
            {"_id": item_id, "user_id": user_id},
            {"$set": updates},
            return_document=ReturnDocument.AFTER,
        )

    async def delete(self, user_id: str, item_id: str) -> Optional[Dict[str, Any]]:
        return await self._collection.find_one_and_delete(
            {"_id": item_id, "user_id": user_id}
        )

    async def delete_for_user(self, user_id: str) -> None:
        await self._collection.delete_many({"user_id": user_id})

    async def watched_source_ids(self) -> List[str]:
        return await self._collection.distinct("source_id")

    async def source_ids_for_user(self, user_id: str) -> List[str]:
        return await self._collection.distinct("source_id", {"user_id": user_id})

    async def watchers(self, source_id: str) -> List[Dict[str, Any]]:
        cursor = self._collection.find(
            {"source_id": source_id}, {"user_id": 1, "company_name": 1}
        )
        return await cursor.to_list(length=None)

    async def user_watches_source(self, user_id: str, source_id: str) -> bool:
        found = await self._collection.find_one(
            {"user_id": user_id, "source_id": source_id}, {"_id": 1}
        )
        return found is not None

    async def repoint(self, old_source_id: str, new_source_id: str) -> None:
        """Move every row from a resolved careers page to the board it embeds."""

        await self._collection.update_many(
            {"source_id": old_source_id},
            {"$set": {"source_id": new_source_id, "updated_at": _utc_now()}},
        )


class CareerSourceStore:
    """Crawlable sources, shared by every user who watches the same link.

    source doc: {_id, key, kind, params, url, label, status, page_mode,
                 alias_of, due_at, last_crawled_at, last_error,
                 consecutive_failures, open_jobs, created_at}

    ``kind`` is a job board (``greenhouse`` …) or ``page`` for a careers page.
    A page is ``checking`` until the crawler reads it once: it then either
    points at the board it embeds (``alias_of``), is crawled for its own
    JobPosting data (``page_mode="jsonld"``), or is ``unsupported``.
    """

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    async def get_or_create(
        self, key: str, kind: str, params: Dict[str, Any], url: str, label: str
    ) -> Dict[str, Any]:
        now = _utc_now()
        fresh = {
            "_id": _new_id(),
            "key": key,
            "kind": kind,
            "params": params,
            "url": url,
            "label": label,
            "status": "checking" if kind == "page" else "ready",
            "page_mode": None,
            "alias_of": None,
            "due_at": now,
            "last_crawled_at": None,
            "last_error": None,
            "consecutive_failures": 0,
            "open_jobs": 0,
            "created_at": now,
        }
        try:
            doc = await self._collection.find_one_and_update(
                {"key": key},
                {"$setOnInsert": fresh},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
        except DuplicateKeyError:
            # A concurrent upsert of the same key won; read its document.
            doc = await self._collection.find_one({"key": key})
        if doc is None:  # pragma: no cover - upsert always yields a document
            raise DatabaseError("Could not create the career source")
        return doc

    async def get(self, source_id: str) -> Optional[Dict[str, Any]]:
        return await self._collection.find_one({"_id": source_id})

    async def get_many(self, source_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        if not source_ids:
            return {}
        cursor = self._collection.find({"_id": {"$in": list(source_ids)}})
        return {doc["_id"]: doc for doc in await cursor.to_list(length=None)}

    async def checking(self, source_ids: List[str]) -> List[Dict[str, Any]]:
        cursor = self._collection.find(
            {"_id": {"$in": list(source_ids)}, "kind": "page", "status": "checking"}
        )
        return await cursor.to_list(length=None)

    async def due(self, source_ids: List[str], now: datetime) -> List[Dict[str, Any]]:
        cursor = self._collection.find(
            {
                "_id": {"$in": list(source_ids)},
                "due_at": {"$lte": now},
                "status": {"$in": ["ready", "error"]},
                "alias_of": None,
                # A careers page is crawlable only once it proved to carry
                # JobPosting data; until then it is resolved, not crawled.
                "$or": [{"kind": {"$ne": "page"}}, {"page_mode": "jsonld"}],
            }
        )
        return await cursor.to_list(length=None)

    async def mark_due(self, source_ids: List[str], now: datetime) -> None:
        if not source_ids:
            return
        await self._collection.update_many(
            {"_id": {"$in": list(source_ids)}}, {"$set": {"due_at": now}}
        )

    async def recheck_pages(self, source_ids: List[str]) -> None:
        """Send careers pages that found nothing back to ``checking``."""

        if not source_ids:
            return
        await self._collection.update_many(
            {
                "_id": {"$in": list(source_ids)},
                "kind": "page",
                "alias_of": None,
                "status": {"$in": ["unsupported", "error"]},
            },
            {"$set": {"status": "checking", "page_mode": None}},
        )

    async def update(self, source_id: str, fields: Dict[str, Any]) -> None:
        await self._collection.update_one({"_id": source_id}, {"$set": fields})

    async def unwatched_ids(
        self, watched_ids: List[str], created_before: datetime
    ) -> List[str]:
        """Sources nobody follows any more (aliases included), old enough to drop.

        The age floor keeps a sweep from racing a request that has created a
        source but not yet inserted the watchlist row pointing at it.
        """

        cursor = self._collection.find(
            {"_id": {"$nin": list(watched_ids)}, "created_at": {"$lt": created_before}},
            {"_id": 1},
        )
        return [doc["_id"] for doc in await cursor.to_list(length=None)]

    async def delete_many(self, source_ids: List[str]) -> None:
        if source_ids:
            await self._collection.delete_many({"_id": {"$in": list(source_ids)}})


class JobStore:
    """Openings read from career sources, shared across watchers.

    job doc: {_id, source_id, external_id, title, url, location, location_text,
              remote, departments, categories, description, exp_min_months,
              exp_max_months, exp_basis, posted_at, complete, first_seen_at,
              last_seen_at, closed_at}

    ``complete`` is False while a board that needs one request per posting
    (Workday, SmartRecruiters) has not had its description fetched yet;
    incomplete jobs are never matched.
    """

    _LIST_PROJECTION = {"description": 0}

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    async def known(self, source_id: str) -> Dict[str, Dict[str, Any]]:
        cursor = self._collection.find(
            {"source_id": source_id}, {"external_id": 1, "complete": 1}
        )
        return {doc["external_id"]: doc for doc in await cursor.to_list(length=None)}

    async def insert_many(self, docs: List[Dict[str, Any]]) -> None:
        for start in range(0, len(docs), 500):
            batch = docs[start : start + 500]
            try:
                await self._collection.insert_many(batch, ordered=False)
            except BulkWriteError as exc:
                # Duplicate (source, external id) from a concurrent crawl is
                # harmless; anything else is a real failure.
                errors = exc.details.get("writeErrors", []) if exc.details else []
                if any(error.get("code") != 11000 for error in errors):
                    raise

    async def update(self, job_id: str, fields: Dict[str, Any]) -> None:
        await self._collection.update_one({"_id": job_id}, {"$set": fields})

    async def mark_seen(
        self, source_id: str, external_ids: List[str], now: datetime
    ) -> None:
        for start in range(0, len(external_ids), 1_000):
            await self._collection.update_many(
                {
                    "source_id": source_id,
                    "external_id": {"$in": external_ids[start : start + 1_000]},
                },
                {"$set": {"last_seen_at": now, "closed_at": None}},
            )

    async def close_unseen(self, source_id: str, now: datetime) -> List[str]:
        """Close open jobs this crawl no longer listed; returns their ids."""

        query = {"source_id": source_id, "closed_at": None, "last_seen_at": {"$lt": now}}
        cursor = self._collection.find(query, {"_id": 1})
        ids = [doc["_id"] for doc in await cursor.to_list(length=None)]
        if ids:
            await self._collection.update_many(
                {"_id": {"$in": ids}}, {"$set": {"closed_at": now}}
            )
        return ids

    async def count_open(self, source_id: str) -> int:
        return await self._collection.count_documents(
            {"source_id": source_id, "closed_at": None, "complete": True}
        )

    async def open_complete_for_sources(
        self, source_ids: List[str]
    ) -> List[Dict[str, Any]]:
        if not source_ids:
            return []
        cursor = self._collection.find(
            {"source_id": {"$in": list(source_ids)}, "closed_at": None, "complete": True},
            self._LIST_PROJECTION,
        )
        return await cursor.to_list(length=None)

    async def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        return await self._collection.find_one({"_id": job_id})

    async def get_many(self, job_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        if not job_ids:
            return {}
        cursor = self._collection.find(
            {"_id": {"$in": list(job_ids)}}, self._LIST_PROJECTION
        )
        return {doc["_id"]: doc for doc in await cursor.to_list(length=None)}

    async def prune_closed(self, closed_before: datetime) -> List[str]:
        cursor = self._collection.find(
            {"closed_at": {"$ne": None, "$lt": closed_before}}, {"_id": 1}
        )
        ids = [doc["_id"] for doc in await cursor.to_list(length=None)]
        if ids:
            await self._collection.delete_many({"_id": {"$in": ids}})
        return ids

    async def delete_for_sources(self, source_ids: List[str]) -> List[str]:
        if not source_ids:
            return []
        cursor = self._collection.find(
            {"source_id": {"$in": list(source_ids)}}, {"_id": 1}
        )
        ids = [doc["_id"] for doc in await cursor.to_list(length=None)]
        if ids:
            await self._collection.delete_many({"_id": {"$in": ids}})
        return ids


class JobMatchStore:
    """Which jobs fit which user, plus what the user did with each.

    match doc: {_id, user_id, job_id, source_id, company_name, label, state,
                created_at, notified_at}

    ``notified_at`` is None only for a match a crawl found that has not yet
    gone out in a digest; matches found by a recompute or a first crawl are
    created already notified, so they show on the site without a Telegram flood.
    """

    STATES = ("new", "seen", "saved", "dismissed")

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    async def list_for_user(
        self, user_id: str, states: List[str], limit: int = 500
    ) -> List[Dict[str, Any]]:
        cursor = (
            self._collection.find({"user_id": user_id, "state": {"$in": list(states)}})
            .sort("created_at", -1)
            .limit(limit)
        )
        return await cursor.to_list(length=None)

    async def bulk_add(
        self, user_id: str, entries: List[Dict[str, Any]], notified_at: Optional[datetime]
    ) -> int:
        """Insert many matches at once; ones the user already has are skipped.

        ``entries`` are ``{job_id, source_id, company_name, label}``. Returns
        how many were new.
        """

        if not entries:
            return 0
        now = _utc_now()
        docs = [
            {
                "_id": _new_id(),
                "user_id": user_id,
                "job_id": entry["job_id"],
                "source_id": entry["source_id"],
                "company_name": entry.get("company_name", ""),
                "label": entry["label"],
                "state": "new",
                "created_at": now,
                "notified_at": notified_at,
            }
            for entry in entries
        ]
        inserted = 0
        for start in range(0, len(docs), 500):
            batch = docs[start : start + 500]
            try:
                result = await self._collection.insert_many(batch, ordered=False)
                inserted += len(result.inserted_ids)
            except BulkWriteError as exc:
                details = exc.details or {}
                errors = details.get("writeErrors", [])
                if any(error.get("code") != 11000 for error in errors):
                    raise
                inserted += int(details.get("nInserted", 0))
        return inserted

    async def bulk_set_labels(self, pairs: List[Any]) -> None:
        """``[(match_id, label), ...]``."""

        if not pairs:
            return
        await self._collection.bulk_write(
            [UpdateOne({"_id": match_id}, {"$set": {"label": label}}) for match_id, label in pairs],
            ordered=False,
        )

    async def rename_company(self, user_id: str, source_id: str, name: str) -> None:
        await self._collection.update_many(
            {"user_id": user_id, "source_id": source_id}, {"$set": {"company_name": name}}
        )

    async def all_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = self._collection.find(
            {"user_id": user_id}, {"job_id": 1, "state": 1, "label": 1, "source_id": 1}
        )
        return await cursor.to_list(length=None)

    async def get(self, user_id: str, match_id: str) -> Optional[Dict[str, Any]]:
        return await self._collection.find_one({"_id": match_id, "user_id": user_id})

    async def set_state(
        self, user_id: str, match_id: str, state: str
    ) -> Optional[Dict[str, Any]]:
        return await self._collection.find_one_and_update(
            {"_id": match_id, "user_id": user_id},
            {"$set": {"state": state}},
            return_document=ReturnDocument.AFTER,
        )

    async def delete_ids(self, user_id: str, match_ids: List[str]) -> None:
        if match_ids:
            await self._collection.delete_many(
                {"_id": {"$in": list(match_ids)}, "user_id": user_id}
            )

    async def delete_for_user(self, user_id: str) -> None:
        await self._collection.delete_many({"user_id": user_id})

    async def delete_for_user_source(self, user_id: str, source_id: str) -> None:
        await self._collection.delete_many({"user_id": user_id, "source_id": source_id})

    async def delete_for_jobs(self, job_ids: List[str]) -> None:
        for start in range(0, len(job_ids), 1_000):
            await self._collection.delete_many(
                {"job_id": {"$in": job_ids[start : start + 1_000]}}
            )

    async def pending_user_ids(self) -> List[str]:
        return await self._collection.distinct("user_id", {"notified_at": None})

    async def pending_for_user(self, user_id: str, limit: int) -> List[Dict[str, Any]]:
        cursor = (
            self._collection.find({"user_id": user_id, "notified_at": None})
            .sort("created_at", 1)
            .limit(limit)
        )
        return await cursor.to_list(length=None)

    async def count_pending(self, user_id: str) -> int:
        return await self._collection.count_documents(
            {"user_id": user_id, "notified_at": None}
        )

    async def mark_notified(self, user_id: str, now: datetime) -> None:
        await self._collection.update_many(
            {"user_id": user_id, "notified_at": None}, {"$set": {"notified_at": now}}
        )


class SystemStateStore:
    """Process-coordination documents: leases and small persistent values.

    Leases keep the crawler and the Telegram poller to one runner across
    processes. Acquisition is one conditional upsert: a live lease held by
    someone else matches nothing, so the upsert's insert collides on ``_id``
    and the caller learns it lost.
    """

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    async def acquire_lease(self, name: str, holder: str, ttl_seconds: float) -> bool:
        now = _utc_now()
        try:
            doc = await self._collection.find_one_and_update(
                {
                    "_id": "lease:" + name,
                    "$or": [
                        {"holder": holder},
                        {"holder": None},
                        {"expires_at": {"$lte": now}},
                    ],
                },
                {
                    "$set": {
                        "holder": holder,
                        "expires_at": now + timedelta(seconds=ttl_seconds),
                    }
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
        except DuplicateKeyError:
            return False
        return doc is not None and doc.get("holder") == holder

    async def release_lease(self, name: str, holder: str) -> None:
        await self._collection.update_one(
            {"_id": "lease:" + name, "holder": holder},
            {"$set": {"holder": None, "expires_at": _utc_now()}},
        )

    async def get_value(self, name: str) -> Any:
        doc = await self._collection.find_one({"_id": "value:" + name})
        return None if doc is None else doc.get("value")

    async def set_value(self, name: str, value: Any) -> None:
        await self._collection.update_one(
            {"_id": "value:" + name},
            {"$set": {"value": value, "updated_at": _utc_now()}},
            upsert=True,
        )


# ---------------------------------------------------------------------------
# Database wrapper
# ---------------------------------------------------------------------------


class Database:
    """Owns the store instances and index management for one Mongo database."""

    def __init__(self, motor_db: Any) -> None:
        self._db = motor_db
        self.users = UserStore(motor_db["users"])
        self.sessions = SessionStore(motor_db["sessions"])
        self.auth_tokens = AuthTokenStore(motor_db["auth_tokens"])
        self.signup_codes = SignupCodeStore(motor_db["signup_codes"])
        self.api_keys = ApiKeyStore(motor_db["api_keys"])
        self.resumes = ResumeStore(motor_db["resumes"])
        self.jds = JdStore(motor_db["jds"])
        self.runs = RunStore(motor_db["runs"])
        self.watchlist = WatchlistStore(motor_db["watchlist"])
        self.career_sources = CareerSourceStore(motor_db["career_sources"])
        self.jobs = JobStore(motor_db["jobs"])
        self.job_matches = JobMatchStore(motor_db["job_matches"])
        self.system_state = SystemStateStore(motor_db["system_state"])

    @classmethod
    def from_env(cls) -> "Database":
        """Build from ``MONGODB_URI``/``MONGODB_DB``."""

        uri = os.getenv("MONGODB_URI", "").strip()
        if not uri:
            raise RuntimeError(
                "MONGODB_URI is not set. RoleTeX stores every account, resume and "
                "run in MongoDB and cannot start without it."
            )
        from motor.motor_asyncio import AsyncIOMotorClient

        client = AsyncIOMotorClient(
            uri,
            tz_aware=True,
            serverSelectionTimeoutMS=5_000,
            connectTimeoutMS=5_000,
        )
        db_name = os.getenv("MONGODB_DB", "jd_resume_builder").strip() or "jd_resume_builder"
        return cls(client[db_name])

    async def ping(self) -> bool:
        """Health probe; short timeout, never raises."""

        try:
            await asyncio.wait_for(
                self._db.client.admin.command("ping"), timeout=5.0
            )
            return True
        except Exception:
            return False

    async def ensure_indexes(self) -> None:
        """Create all indexes idempotently; failures are logged, not raised."""

        index_plan = [
            (self._db["users"], "email", {"unique": True}),
            (self._db["sessions"], "token_hash", {"unique": True}),
            (self._db["sessions"], "expires_at", {"expireAfterSeconds": 0}),
            (self._db["sessions"], "user_id", {}),
            (self._db["auth_tokens"], "token_hash", {"unique": True}),
            (self._db["auth_tokens"], "expires_at", {"expireAfterSeconds": 0}),
            (self._db["auth_tokens"], [("user_id", 1), ("purpose", 1)], {}),
            (self._db["signup_codes"], "email", {"unique": True}),
            (self._db["signup_codes"], "expires_at", {"expireAfterSeconds": 0}),
            (self._db["api_keys"], [("user_id", 1), ("provider", 1)], {"unique": True}),
            (self._db["resumes"], "user_id", {}),
            (self._db["jds"], "user_id", {}),
            (self._db["runs"], [("user_id", 1), ("created_at", 1)], {}),
            (self._db["users"], "telegram.chat_id", {"sparse": True}),
            (
                self._db["watchlist"],
                [("user_id", 1), ("link_key", 1)],
                {"unique": True},
            ),
            (self._db["watchlist"], "source_id", {}),
            (self._db["career_sources"], "key", {"unique": True}),
            (
                self._db["jobs"],
                [("source_id", 1), ("external_id", 1)],
                {"unique": True},
            ),
            (self._db["jobs"], [("source_id", 1), ("closed_at", 1)], {}),
            (self._db["jobs"], "closed_at", {}),
            (
                self._db["job_matches"],
                [("user_id", 1), ("job_id", 1)],
                {"unique": True},
            ),
            (
                self._db["job_matches"],
                [("user_id", 1), ("state", 1), ("created_at", -1)],
                {},
            ),
            (self._db["job_matches"], "job_id", {}),
            (self._db["job_matches"], [("notified_at", 1), ("user_id", 1)], {}),
        ]
        for collection, keys, options in index_plan:
            try:
                await collection.create_index(keys, **options)
            except Exception as exc:
                logger.warning(
                    "Could not create index on %s: %s", collection.name, exc
                )

    def close(self) -> None:
        """Close the underlying client (used on app shutdown and in tests)."""

        try:
            self._db.client.close()
        except Exception:
            pass
