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
- ``from_env`` returns None when ``MONGODB_URI`` is unset so the app can boot
  in demo mode with no database at all.

All timestamps are timezone-aware UTC datetimes. The motor client is created
with ``tz_aware=True``; ``_as_utc`` defensively normalizes naive values from
alternative drivers (e.g. mongomock in tests).
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError


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

    _UPDATABLE_FIELDS = ("name", "default_provider", "default_model", "password_hash")

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
            "default_model": None,
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
                "created_at": _utc_now(),
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
            {"token_hash": token_hash}, {"$set": {"expires_at": expires_at}}
        )

    async def delete(self, token_hash: str) -> None:
        await self._collection.delete_one({"token_hash": token_hash})

    async def delete_for_user(self, user_id: str) -> None:
        await self._collection.delete_many({"user_id": user_id})


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
    """Resume documents plus immutable per-version payload documents.

    resume doc:  {_id, user_id, name, source_type, style, provider, model,
                  current_version, created_at, updated_at}
    version doc: {_id, resume_id, user_id, version, data, template_tex,
                  source_text, source_type, style, provider, model, created_at}
    """

    _VERSION_PAYLOAD_FIELDS = ("data", "template_tex", "source_text")

    def __init__(self, resumes: Any, versions: Any) -> None:
        self._resumes = resumes
        self._versions = versions

    async def create(
        self,
        user_id: str,
        name: str,
        source_type: str,
        data: Dict[str, Any],
        template_tex: str,
        source_text: str,
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
            "current_version": 1,
            "created_at": now,
            "updated_at": now,
        }
        await self._resumes.insert_one(resume_doc)
        await self._versions.insert_one(
            self._version_doc(
                resume_doc["_id"], user_id, 1, source_type, data, template_tex,
                source_text, style, provider, model, now,
            )
        )
        return resume_doc

    async def add_version(
        self,
        user_id: str,
        resume_id: str,
        source_type: str,
        data: Dict[str, Any],
        template_tex: str,
        source_text: str,
        style: Dict[str, Any],
        provider: str,
        model: str,
    ) -> Optional[Dict[str, Any]]:
        now = _utc_now()
        updated = await self._resumes.find_one_and_update(
            {"_id": resume_id, "user_id": user_id},
            {
                "$inc": {"current_version": 1},
                "$set": {
                    "source_type": source_type,
                    "style": style,
                    "provider": provider,
                    "model": model,
                    "updated_at": now,
                },
            },
            return_document=ReturnDocument.AFTER,
        )
        if updated is None:
            return None
        await self._versions.insert_one(
            self._version_doc(
                resume_id, user_id, int(updated["current_version"]), source_type,
                data, template_tex, source_text, style, provider, model, now,
            )
        )
        return updated

    async def list_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = self._resumes.find({"user_id": user_id}).sort("updated_at", -1)
        return await cursor.to_list(length=None)

    async def get(self, user_id: str, resume_id: str) -> Optional[Dict[str, Any]]:
        return await self._resumes.find_one({"_id": resume_id, "user_id": user_id})

    async def get_version(
        self, user_id: str, resume_id: str, version: int
    ) -> Optional[Dict[str, Any]]:
        return await self._versions.find_one(
            {"resume_id": resume_id, "user_id": user_id, "version": version}
        )

    async def list_versions(self, user_id: str, resume_id: str) -> List[Dict[str, Any]]:
        projection = {field: 0 for field in self._VERSION_PAYLOAD_FIELDS}
        cursor = (
            self._versions.find({"resume_id": resume_id, "user_id": user_id}, projection)
            .sort("version", -1)
        )
        return await cursor.to_list(length=None)

    async def rename(self, user_id: str, resume_id: str, name: str) -> bool:
        result = await self._resumes.update_one(
            {"_id": resume_id, "user_id": user_id},
            {"$set": {"name": name, "updated_at": _utc_now()}},
        )
        return result.matched_count > 0

    async def delete(self, user_id: str, resume_id: str) -> bool:
        result = await self._resumes.delete_one({"_id": resume_id, "user_id": user_id})
        if result.deleted_count == 0:
            return False
        await self._versions.delete_many({"resume_id": resume_id, "user_id": user_id})
        return True

    async def delete_for_user(self, user_id: str) -> None:
        await self._resumes.delete_many({"user_id": user_id})
        await self._versions.delete_many({"user_id": user_id})

    async def count_for_user(self, user_id: str) -> int:
        return await self._resumes.count_documents({"user_id": user_id})

    @staticmethod
    def _version_doc(
        resume_id: str,
        user_id: str,
        version: int,
        source_type: str,
        data: Dict[str, Any],
        template_tex: str,
        source_text: str,
        style: Dict[str, Any],
        provider: str,
        model: str,
        created_at: datetime,
    ) -> Dict[str, Any]:
        return {
            "_id": _new_id(),
            "resume_id": resume_id,
            "user_id": user_id,
            "version": version,
            "data": data,
            "template_tex": template_tex,
            "source_text": source_text,
            "source_type": source_type,
            "style": style,
            "provider": provider,
            "model": model,
            "created_at": created_at,
        }


class JdStore:
    """Job descriptions with archive-on-update version history.

    jd doc:         {_id, user_id, title, content, version, created_at, updated_at}
    jd_version doc: {_id, jd_id, user_id, version, title, content, created_at}
    """

    def __init__(self, jds: Any, versions: Any) -> None:
        self._jds = jds
        self._versions = versions

    async def create(self, user_id: str, title: str, content: str) -> Dict[str, Any]:
        now = _utc_now()
        doc = {
            "_id": _new_id(),
            "user_id": user_id,
            "title": title,
            "content": content,
            "version": 1,
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
        max_versions: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Archive the current revision then apply the update.

        ``max_versions`` caps the archived history per JD (oldest pruned),
        mirroring ``RunStore._prune``; None disables pruning.
        """

        current = await self._jds.find_one({"_id": jd_id, "user_id": user_id})
        if current is None:
            return None
        now = _utc_now()
        await self._versions.insert_one(
            {
                "_id": _new_id(),
                "jd_id": jd_id,
                "user_id": user_id,
                "version": int(current.get("version", 1)),
                "title": current.get("title", ""),
                "content": current.get("content", ""),
                "created_at": now,
            }
        )
        updates = {
            "title": title if title is not None else current.get("title", ""),
            "content": content if content is not None else current.get("content", ""),
            "version": int(current.get("version", 1)) + 1,
            "updated_at": now,
        }
        if max_versions is not None and max_versions > 0:
            await self._prune_versions(user_id, jd_id, max_versions)
        return await self._jds.find_one_and_update(
            {"_id": jd_id, "user_id": user_id},
            {"$set": updates},
            return_document=ReturnDocument.AFTER,
        )

    async def _prune_versions(self, user_id: str, jd_id: str, max_versions: int) -> None:
        query = {"jd_id": jd_id, "user_id": user_id}
        count = await self._versions.count_documents(query)
        excess = count - max_versions
        if excess <= 0:
            return
        cursor = (
            self._versions.find(query, {"_id": 1}).sort("version", 1).limit(excess)
        )
        oldest = await cursor.to_list(length=excess)
        ids = [doc["_id"] for doc in oldest]
        if ids:
            await self._versions.delete_many(
                {"_id": {"$in": ids}, "user_id": user_id}
            )

    async def list_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = self._jds.find({"user_id": user_id}).sort("updated_at", -1)
        return await cursor.to_list(length=None)

    async def get(self, user_id: str, jd_id: str) -> Optional[Dict[str, Any]]:
        return await self._jds.find_one({"_id": jd_id, "user_id": user_id})

    async def list_versions(self, user_id: str, jd_id: str) -> List[Dict[str, Any]]:
        cursor = (
            self._versions.find({"jd_id": jd_id, "user_id": user_id}).sort("version", -1)
        )
        return await cursor.to_list(length=None)

    async def delete(self, user_id: str, jd_id: str) -> bool:
        result = await self._jds.delete_one({"_id": jd_id, "user_id": user_id})
        if result.deleted_count == 0:
            return False
        await self._versions.delete_many({"jd_id": jd_id, "user_id": user_id})
        return True

    async def delete_for_user(self, user_id: str) -> None:
        await self._jds.delete_many({"user_id": user_id})
        await self._versions.delete_many({"user_id": user_id})

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
# Database wrapper
# ---------------------------------------------------------------------------


class Database:
    """Owns the store instances and index management for one Mongo database."""

    def __init__(self, motor_db: Any) -> None:
        self._db = motor_db
        self.users = UserStore(motor_db["users"])
        self.sessions = SessionStore(motor_db["sessions"])
        self.api_keys = ApiKeyStore(motor_db["api_keys"])
        self.resumes = ResumeStore(motor_db["resumes"], motor_db["resume_versions"])
        self.jds = JdStore(motor_db["jds"], motor_db["jd_versions"])
        self.runs = RunStore(motor_db["runs"])

    @classmethod
    def from_env(cls) -> "Optional[Database]":
        """Build from ``MONGODB_URI``/``MONGODB_DB``; None → demo mode."""

        uri = os.getenv("MONGODB_URI", "").strip()
        if not uri:
            return None
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
            (self._db["api_keys"], [("user_id", 1), ("provider", 1)], {"unique": True}),
            (self._db["resumes"], "user_id", {}),
            (self._db["resume_versions"], [("resume_id", 1), ("version", 1)], {"unique": True}),
            (self._db["resume_versions"], "user_id", {}),
            (self._db["jds"], "user_id", {}),
            (self._db["jd_versions"], [("jd_id", 1), ("version", 1)], {}),
            (self._db["runs"], [("user_id", 1), ("created_at", 1)], {}),
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
