"""Store-layer tests against mongomock-motor (offline, no real Mongo).

The critical properties exercised here are the security invariants of the
persistence layer: ownership scoping on every query (user A can never see or
mutate user B's documents), duplicate-email rejection, session expiry checks
in code, resume version bumping, and run pruning.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import pytest
from mongomock_motor import AsyncMongoMockClient

from app.db import Database, DuplicateEmailError


USER_A = "a" * 32
USER_B = "b" * 32


@pytest.fixture
async def db() -> Database:
    database = Database(AsyncMongoMockClient()["testdb"])
    await database.ensure_indexes()
    return database


def _resume_kwargs(**overrides: Any) -> Dict[str, Any]:
    values: Dict[str, Any] = {
        "name": "My resume",
        "source_type": "latex",
        "data": {"summary": "Backend engineer"},
        "template_tex": "% template",
        "source_text": "\\documentclass{article}",
        "style": {"paper": "a4paper"},
        "provider": "mock",
        "model": "deterministic-local",
    }
    values.update(overrides)
    return values


# ---------------------------------------------------------------------------
# Database wrapper
# ---------------------------------------------------------------------------


async def test_from_env_returns_none_without_uri(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MONGODB_URI", raising=False)
    assert Database.from_env() is None
    monkeypatch.setenv("MONGODB_URI", "   ")
    assert Database.from_env() is None


async def test_from_env_builds_database_when_uri_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MONGODB_URI", "mongodb://localhost:27017")
    monkeypatch.setenv("MONGODB_DB", "custom_db")
    database = Database.from_env()
    try:
        assert database is not None
        assert database._db.name == "custom_db"  # no I/O: client is lazy
    finally:
        if database is not None:
            database.close()


async def test_ping_reports_true_on_mock(db: Database) -> None:
    assert await db.ping() is True


async def test_ensure_indexes_is_idempotent(db: Database) -> None:
    await db.ensure_indexes()  # second call must not raise


# ---------------------------------------------------------------------------
# UserStore
# ---------------------------------------------------------------------------


async def test_user_create_get_and_get_by_email(db: Database) -> None:
    user = await db.users.create("a@example.com", "hash-a", name="Alice")
    assert user["_id"]
    assert len(user["_id"]) == 32
    fetched = await db.users.get(user["_id"])
    assert fetched is not None
    assert fetched["email"] == "a@example.com"
    assert isinstance(fetched["created_at"], datetime)
    by_email = await db.users.get_by_email("a@example.com")
    assert by_email is not None
    assert by_email["_id"] == user["_id"]


async def test_user_duplicate_email_rejected(db: Database) -> None:
    await db.users.create("dup@example.com", "hash-1")
    with pytest.raises(DuplicateEmailError):
        await db.users.create("dup@example.com", "hash-2")


async def test_user_update_whitelists_fields(db: Database) -> None:
    user = await db.users.create("w@example.com", "hash-w")
    await db.users.update(
        user["_id"],
        {
            "name": "New Name",
            "default_provider": "openai",
            "email": "hacked@example.com",  # not whitelisted
            "_id": "zzz",  # not whitelisted
            "is_admin": True,  # not whitelisted
        },
    )
    updated = await db.users.get(user["_id"])
    assert updated is not None
    assert updated["name"] == "New Name"
    assert updated["default_provider"] == "openai"
    assert updated["email"] == "w@example.com"
    assert "is_admin" not in updated


async def test_user_delete(db: Database) -> None:
    user = await db.users.create("gone@example.com", "hash")
    await db.users.delete(user["_id"])
    assert await db.users.get(user["_id"]) is None


# ---------------------------------------------------------------------------
# SessionStore
# ---------------------------------------------------------------------------


async def test_session_roundtrip_and_expiry(db: Database) -> None:
    future = datetime.now(timezone.utc) + timedelta(days=1)
    await db.sessions.create(USER_A, "token-hash-1", future)
    session = await db.sessions.get("token-hash-1")
    assert session is not None
    assert session["user_id"] == USER_A

    past = datetime.now(timezone.utc) - timedelta(seconds=5)
    await db.sessions.touch("token-hash-1", past)
    assert await db.sessions.get("token-hash-1") is None  # expiry checked in code


async def test_session_touch_extends(db: Database) -> None:
    soon = datetime.now(timezone.utc) + timedelta(minutes=5)
    await db.sessions.create(USER_A, "token-hash-2", soon)
    later = datetime.now(timezone.utc) + timedelta(days=30)
    await db.sessions.touch("token-hash-2", later)
    session = await db.sessions.get("token-hash-2")
    assert session is not None


async def test_session_delete_and_delete_for_user(db: Database) -> None:
    future = datetime.now(timezone.utc) + timedelta(days=1)
    await db.sessions.create(USER_A, "hash-a1", future)
    await db.sessions.create(USER_A, "hash-a2", future)
    await db.sessions.create(USER_B, "hash-b1", future)
    await db.sessions.delete("hash-a1")
    assert await db.sessions.get("hash-a1") is None
    await db.sessions.delete_for_user(USER_A)
    assert await db.sessions.get("hash-a2") is None
    assert await db.sessions.get("hash-b1") is not None  # other user untouched


# ---------------------------------------------------------------------------
# ApiKeyStore
# ---------------------------------------------------------------------------


async def test_api_key_upsert_insert_then_update(db: Database) -> None:
    await db.api_keys.upsert(USER_A, "openai", "cipher-1", "…1234")
    first = await db.api_keys.get(USER_A, "openai")
    assert first is not None
    assert first["ciphertext"] == "cipher-1"

    await db.api_keys.upsert(USER_A, "openai", "cipher-2", "…5678")
    second = await db.api_keys.get(USER_A, "openai")
    assert second is not None
    assert second["ciphertext"] == "cipher-2"
    assert second["hint"] == "…5678"
    assert second["created_at"] == first["created_at"]  # preserved on update
    keys = await db.api_keys.list_for_user(USER_A)
    assert len(keys) == 1


async def test_api_key_isolation_between_users(db: Database) -> None:
    await db.api_keys.upsert(USER_A, "openai", "cipher-a", "…aaaa")
    assert await db.api_keys.get(USER_B, "openai") is None
    assert await db.api_keys.list_for_user(USER_B) == []
    assert await db.api_keys.delete(USER_B, "openai") is False
    assert await db.api_keys.get(USER_A, "openai") is not None


async def test_api_key_delete_and_delete_for_user(db: Database) -> None:
    await db.api_keys.upsert(USER_A, "openai", "c1", "…1111")
    await db.api_keys.upsert(USER_A, "groq", "c2", "…2222")
    await db.api_keys.upsert(USER_B, "openai", "c3", "…3333")
    assert await db.api_keys.delete(USER_A, "openai") is True
    assert await db.api_keys.delete(USER_A, "openai") is False
    await db.api_keys.delete_for_user(USER_A)
    assert await db.api_keys.list_for_user(USER_A) == []
    assert len(await db.api_keys.list_for_user(USER_B)) == 1


# ---------------------------------------------------------------------------
# ResumeStore
# ---------------------------------------------------------------------------


async def test_resume_create_starts_at_version_one(db: Database) -> None:
    resume = await db.resumes.create(USER_A, **_resume_kwargs())
    assert resume["current_version"] == 1
    assert resume["user_id"] == USER_A
    version = await db.resumes.get_version(USER_A, resume["_id"], 1)
    assert version is not None
    assert version["data"] == {"summary": "Backend engineer"}
    assert version["template_tex"] == "% template"
    assert await db.resumes.count_for_user(USER_A) == 1


async def test_resume_add_version_bumps_current_version(db: Database) -> None:
    resume = await db.resumes.create(USER_A, **_resume_kwargs())
    updated = await db.resumes.add_version(
        USER_A,
        resume["_id"],
        source_type="pdf",
        data={"summary": "Updated engineer"},
        template_tex="% template v2",
        source_text="pdf text",
        style={"paper": "letterpaper"},
        provider="openai",
        model="gpt-4.1-mini",
    )
    assert updated is not None
    assert updated["current_version"] == 2
    assert updated["source_type"] == "pdf"
    version2 = await db.resumes.get_version(USER_A, resume["_id"], 2)
    assert version2 is not None
    assert version2["data"] == {"summary": "Updated engineer"}
    version1 = await db.resumes.get_version(USER_A, resume["_id"], 1)
    assert version1 is not None
    assert version1["data"] == {"summary": "Backend engineer"}  # immutable history


async def test_resume_list_versions_excludes_payloads(db: Database) -> None:
    resume = await db.resumes.create(USER_A, **_resume_kwargs())
    await db.resumes.add_version(
        USER_A, resume["_id"], **{k: v for k, v in _resume_kwargs().items() if k != "name"}
    )
    versions = await db.resumes.list_versions(USER_A, resume["_id"])
    assert [v["version"] for v in versions] == [2, 1]
    for version in versions:
        assert "data" not in version
        assert "template_tex" not in version
        assert "source_text" not in version
        assert version["provider"] == "mock"


async def test_resume_list_for_user_has_no_payloads(db: Database) -> None:
    await db.resumes.create(USER_A, **_resume_kwargs())
    summaries = await db.resumes.list_for_user(USER_A)
    assert len(summaries) == 1
    assert "data" not in summaries[0]
    assert "template_tex" not in summaries[0]


async def test_resume_rename_and_delete(db: Database) -> None:
    resume = await db.resumes.create(USER_A, **_resume_kwargs())
    assert await db.resumes.rename(USER_A, resume["_id"], "Renamed") is True
    fetched = await db.resumes.get(USER_A, resume["_id"])
    assert fetched is not None
    assert fetched["name"] == "Renamed"
    assert await db.resumes.delete(USER_A, resume["_id"]) is True
    assert await db.resumes.get(USER_A, resume["_id"]) is None
    assert await db.resumes.get_version(USER_A, resume["_id"], 1) is None
    assert await db.resumes.delete(USER_A, resume["_id"]) is False


async def test_resume_cross_user_isolation(db: Database) -> None:
    resume = await db.resumes.create(USER_A, **_resume_kwargs())
    resume_id = resume["_id"]
    assert await db.resumes.get(USER_B, resume_id) is None
    assert await db.resumes.get_version(USER_B, resume_id, 1) is None
    assert await db.resumes.list_versions(USER_B, resume_id) == []
    assert await db.resumes.list_for_user(USER_B) == []
    assert await db.resumes.count_for_user(USER_B) == 0
    assert await db.resumes.rename(USER_B, resume_id, "stolen") is False
    added = await db.resumes.add_version(
        USER_B, resume_id, **{k: v for k, v in _resume_kwargs().items() if k != "name"}
    )
    assert added is None
    assert await db.resumes.delete(USER_B, resume_id) is False
    # user A's data is fully intact after all the attempts above
    intact = await db.resumes.get(USER_A, resume_id)
    assert intact is not None
    assert intact["name"] == "My resume"
    assert intact["current_version"] == 1


async def test_resume_delete_for_user_only_affects_that_user(db: Database) -> None:
    await db.resumes.create(USER_A, **_resume_kwargs())
    kept = await db.resumes.create(USER_B, **_resume_kwargs(name="B resume"))
    await db.resumes.delete_for_user(USER_A)
    assert await db.resumes.count_for_user(USER_A) == 0
    assert await db.resumes.get(USER_B, kept["_id"]) is not None
    assert await db.resumes.get_version(USER_B, kept["_id"], 1) is not None


# ---------------------------------------------------------------------------
# JdStore
# ---------------------------------------------------------------------------


async def test_jd_create_and_get(db: Database) -> None:
    jd = await db.jds.create(USER_A, "Backend role", "Build reliable services." * 5)
    assert jd["version"] == 1
    fetched = await db.jds.get(USER_A, jd["_id"])
    assert fetched is not None
    assert fetched["title"] == "Backend role"
    assert await db.jds.count_for_user(USER_A) == 1


async def test_jd_update_archives_and_bumps_version(db: Database) -> None:
    jd = await db.jds.create(USER_A, "Original title", "Original content of the role.")
    updated = await db.jds.update(USER_A, jd["_id"], title=None, content="New content only.")
    assert updated is not None
    assert updated["version"] == 2
    assert updated["title"] == "Original title"  # partial update keeps title
    assert updated["content"] == "New content only."

    versions = await db.jds.list_versions(USER_A, jd["_id"])
    assert len(versions) == 1
    assert versions[0]["version"] == 1
    assert versions[0]["content"] == "Original content of the role."

    again = await db.jds.update(USER_A, jd["_id"], title="Newer title", content=None)
    assert again is not None
    assert again["version"] == 3
    assert again["title"] == "Newer title"
    assert again["content"] == "New content only."
    versions = await db.jds.list_versions(USER_A, jd["_id"])
    assert [v["version"] for v in versions] == [2, 1]


async def test_jd_update_prunes_archived_versions_beyond_cap(db: Database) -> None:
    jd = await db.jds.create(USER_A, "Role", "Version one of the content.")
    for index in range(2, 8):
        updated = await db.jds.update(
            USER_A,
            jd["_id"],
            title=None,
            content="Content revision {0}.".format(index),
            max_versions=3,
        )
        assert updated is not None

    versions = await db.jds.list_versions(USER_A, jd["_id"])
    assert [v["version"] for v in versions] == [6, 5, 4]  # oldest pruned
    current = await db.jds.get(USER_A, jd["_id"])
    assert current is not None
    assert current["version"] == 7


async def test_jd_update_without_cap_keeps_all_versions(db: Database) -> None:
    jd = await db.jds.create(USER_A, "Role", "Version one of the content.")
    for index in range(2, 6):
        await db.jds.update(
            USER_A, jd["_id"], title=None, content="Rev {0}.".format(index)
        )
    versions = await db.jds.list_versions(USER_A, jd["_id"])
    assert len(versions) == 4


async def test_jd_delete_removes_versions(db: Database) -> None:
    jd = await db.jds.create(USER_A, "T", "Some job description content here.")
    await db.jds.update(USER_A, jd["_id"], title="T2", content=None)
    assert await db.jds.delete(USER_A, jd["_id"]) is True
    assert await db.jds.get(USER_A, jd["_id"]) is None
    assert await db.jds.list_versions(USER_A, jd["_id"]) == []
    assert await db.jds.delete(USER_A, jd["_id"]) is False


async def test_jd_cross_user_isolation(db: Database) -> None:
    jd = await db.jds.create(USER_A, "Mine", "Content that belongs to user A only.")
    assert await db.jds.get(USER_B, jd["_id"]) is None
    assert await db.jds.update(USER_B, jd["_id"], title="theirs", content=None) is None
    assert await db.jds.delete(USER_B, jd["_id"]) is False
    assert await db.jds.list_for_user(USER_B) == []
    intact = await db.jds.get(USER_A, jd["_id"])
    assert intact is not None
    assert intact["title"] == "Mine"
    assert intact["version"] == 1


async def test_jd_delete_for_user(db: Database) -> None:
    await db.jds.create(USER_A, "One", "Content for the first job description.")
    kept = await db.jds.create(USER_B, "Two", "Content for the second description.")
    await db.jds.delete_for_user(USER_A)
    assert await db.jds.count_for_user(USER_A) == 0
    assert await db.jds.get(USER_B, kept["_id"]) is not None


# ---------------------------------------------------------------------------
# RunStore
# ---------------------------------------------------------------------------


def _run_doc(index: int) -> Dict[str, Any]:
    return {
        "resume_id": "r" * 32,
        "resume_name": "My resume",
        "provider": "mock",
        "model": "deterministic-local",
        "page_count": 1,
        "repaired": False,
        "latex_source": "% latex {0}".format(index),
        "unified_diff": "--- a\n+++ b",
        "proposal": {"summary": "s"},
        "changes": [],
        "warnings": [],
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=index),
    }


async def test_run_create_get_and_delete(db: Database) -> None:
    run_id = await db.runs.create(USER_A, _run_doc(0))
    assert len(run_id) == 32
    run = await db.runs.get(USER_A, run_id)
    assert run is not None
    assert run["latex_source"] == "% latex 0"
    assert await db.runs.delete(USER_A, run_id) is True
    assert await db.runs.delete(USER_A, run_id) is False


async def test_run_list_is_newest_first_summary(db: Database) -> None:
    for index in range(3):
        await db.runs.create(USER_A, _run_doc(index))
    runs = await db.runs.list_for_user(USER_A)
    assert len(runs) == 3
    timestamps = [run["created_at"] for run in runs]
    assert timestamps == sorted(timestamps, reverse=True)
    for run in runs:
        assert "latex_source" not in run
        assert "unified_diff" not in run
        assert "proposal" not in run
        assert run["provider"] == "mock"
    limited = await db.runs.list_for_user(USER_A, limit=2)
    assert len(limited) == 2


async def test_run_pruning_drops_oldest(db: Database) -> None:
    ids = []
    for index in range(5):
        ids.append(await db.runs.create(USER_A, _run_doc(index), max_runs=3))
    runs = await db.runs.list_for_user(USER_A)
    assert len(runs) == 3
    remaining_ids = {run["_id"] for run in runs}
    assert remaining_ids == set(ids[2:])  # the two oldest were pruned
    assert await db.runs.get(USER_A, ids[0]) is None
    assert await db.runs.get(USER_A, ids[1]) is None


async def test_run_pruning_ignores_other_users(db: Database) -> None:
    for index in range(3):
        await db.runs.create(USER_B, _run_doc(index))
    await db.runs.create(USER_A, _run_doc(10), max_runs=1)
    assert len(await db.runs.list_for_user(USER_B)) == 3


async def test_run_cross_user_isolation(db: Database) -> None:
    run_id = await db.runs.create(USER_A, _run_doc(0))
    assert await db.runs.get(USER_B, run_id) is None
    assert await db.runs.delete(USER_B, run_id) is False
    assert await db.runs.list_for_user(USER_B) == []
    assert await db.runs.get(USER_A, run_id) is not None


async def test_run_server_controls_identity_fields(db: Database) -> None:
    doc = _run_doc(0)
    doc["_id"] = "attacker-chosen-id"
    doc["user_id"] = USER_B
    run_id = await db.runs.create(USER_A, doc)
    assert run_id != "attacker-chosen-id"
    stored = await db.runs.get(USER_A, run_id)
    assert stored is not None
    assert stored["user_id"] == USER_A
