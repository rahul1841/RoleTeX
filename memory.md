# Memory — JD Resume Builder ("RoleTeX")

> Living project memory: current state, decision log, verified facts, and the gap register.
> Update this file whenever a significant decision is made, a gap is opened/closed, or a claim is re-verified.
> Companion docs: [prd.md](prd.md) · [architecture.md](architecture.md) · [design.md](design.md) · [rules.md](rules.md)

---

## 1. Status snapshot — 2026-07-16

- **Production multi-user revamp landed**: MongoDB (Motor) accounts + sessions, per-user resume/JD libraries with versions, tailor-run history, per-user Fernet-encrypted provider keys (incl. new `anthropic` provider), PDF-upload import (poppler `pdftotext` → LLM extraction), rate limiting + login throttling + CSRF origin checks + quotas, demo mode fallback when `MONGODB_URI` is unset, rebuilt hash-routed SPA. Legacy file store (`app/storage.py`, `data/<uuid>/`, `POST /api/import`, `GET /api/resume/{id}`) removed.
- **Adversarial review pass complete (2026-07-16):** a 5-lens multi-agent review (security, backend correctness, real-Mongo realism, frontend, contract completeness) surfaced 12 findings (9 unique, 2 high); all confirmed by adversarial verifiers and **all fixed** with regression tests. See §3 D-15 and the fix list at the bottom of §6.
- **Tests: 258/258 passing** in ~6s (`.venv/bin/python -m pytest -q`, Python 3.9.6). The default suite is offline (LLM stubbed, compiler subprocess mocked, Mongo via mongomock-motor); the new `tests/test_compile_integration.py` is a `@pytest.mark.integration` real-Tectonic compile that **skips when the binary is absent** (`pytest -m "not integration"` to force-skip).
- **Full-repo feature audit (2026-07-16):** a 10-agent audit (7 subsystem inventories + PRD/gap-register verification + completeness critic) re-verified every FR and all 13 gaps against the actual code — docs matched code closely. It closed **G-2** (added the gated real-compile test) and a newly-found undocumented gap (history listing silently capped at 50; now lists up to `max_runs_per_user`), and registered new gaps G-14..G-18 (see §4). Decision D-16.
- **Git:** checkpoint commit `7d95a46` (pre-revamp snapshot) on top of `7a03a14`; the revamp + review fixes are committed on top (see git log).
- Earlier snapshot (2026-07-14, pre-revamp): ~80% of the single-user MVP, 87/87 tests.

## 2. Verified facts log

| Date | Fact | How verified |
|---|---|---|
| 2026-07-14 | Seed resume renders + compiles with **real** Tectonic 0.16.9 (`--untrusted`) into a valid 27KB **single-page** PDF; `pdftotext` output clean and ATS-readable (headings, contact line, selectable bullets) | Manual smoke script driving `/api/tailor` (mock provider, real compile) via `TestClient` |
| 2026-07-14 | Import flow works end-to-end: paste LaTeX → `/api/import` → `data/<uuid>/` profile (4 files) → `/api/tailor` with `resume_id` → sectioned render → valid PDF | Manual smoke script (mock provider — extraction content is placeholder by design; real parsing needs a real provider) |
| 2026-07-14 | All 87 tests pass; **zero** tests execute real Tectonic/poppler (subprocess + inspectors mocked) even though both are installed locally | `pytest -q -rs` + reading `tests/test_compiler.py` mocks |
| 2026-07-14 | Tectonic 0.16.9 + poppler (`pdfinfo`, `pdftotext`) available on local PATH via Homebrew | `command -v` + `--version` |
| 2026-07-16 | Multi-user revamp verified offline: demo mode (health `mode=demo`, seed mock tailor, register → 503) and multi-user mode (register → me → key upsert w/ masked hint → LaTeX import → tailor with `resume_id` → run in history) via a `TestClient` smoke script; 244/244 tests | Integration smoke script + full pytest run |
| 2026-07-16 | **Full journey verified against REAL MongoDB (mongo:7 container) + real out-of-process uvicorn:** health `mode=multi_user`/`database=ok`, register (real unique-email index rejects dup → 409), key masking, LaTeX import (v1), **PDF upload happy path** (real 506-char poppler-extracted PDF → `source_type=pdf`), JD evolve (v2 + archived version), tailor with **real Tectonic compile → success, 1-page, 18KB PDF**, run persisted to history, cross-user isolation (A's resume/run/jd → 404 for B), logout → 401, DELETE-body 413 guard, per-user model-default fix (env `LLM_MODEL=llama` did not leak into a `gemini` request). motor bound cleanly to uvicorn's loop (no "different loop" error — that only appears with in-process TestClient reusing a module-level client). | `curl` + `httpx` scripts against live uvicorn on real Mongo |
| 2026-07-16 | **DB-outage fix verified live:** with Mongo paused, an authed route returns structured `503 {code:"database_unavailable"}` as `application/json` (not a plain-text 500), and `/api/health` stays up reporting `degraded` / `database: error` | Paused the mongo container mid-request via `docker pause` |
| 2026-07-16 | **256/256 tests pass** after the review fixes (baseline 244 + 12 regression tests incl. `tests/test_db_outage.py`) | `.venv/bin/python -m pytest -q` |
| 2026-07-16 | **Seed resume compiles with real Tectonic 0.16.9 inside the pytest suite** (not just a manual smoke): `tests/test_compile_integration.py` renders the seed → real compile → valid `%PDF-` bytes, **1 page**, poppler-extracted text contains the candidate name. Closes G-2. | `.venv/bin/python -m pytest tests/test_compile_integration.py -v` (1 passed, 3.5s) |
| 2026-07-16 | **258/258 tests pass** after the audit fixes (256 + real-compile integration test + run-listing-cap regression test) | `.venv/bin/python -m pytest -q` (258 passed, ~6s) |

**Never verified yet:** any **real LLM provider** call (Groq/Gemini/Anthropic — the mock provider still stands in for extraction/tailoring quality), Docker image build, HF deployment, frontend in a real browser (verified via `node --check` + DOM-stub harness only), pinned Tectonic SHA-256. *(Real MongoDB and real Tectonic are now both exercised — see above.)*

## 3. Decision log

| ID | Date | Decision | Rationale / consequence |
|---|---|---|---|
| D-1 | ≤2026-07-11 | Structured plain-text LLM output; server owns all LaTeX | Kills injection surface; cheaper tokens; deterministic rendering (plan §2.2) |
| D-2 | ≤2026-07-11 | Token-slot template model **instead of** the plan's byte/hash protected-region comparison | Model never emits LaTeX, so there is nothing to hash-compare; exactly-once substitution + leftover rejection is stronger. The `PROTECTED_*` comments in the template are inert markers only |
| D-3 | ≤2026-07-11 | Tectonic (pinned 0.16.9, `--untrusted --only-cached`) over TeX Live; private HF Docker Space; no DB/queue | Plan §3/§5 validation; single free container |
| D-4 | ≤2026-07-11 | Single shared repair budget per request (semantic OR compile OR shortening) | Caps cost; prevents repair ping-pong; enforced in `app/main.py` |
| D-5 | 2026-07-14 | **Import sends the full paste including identity to the LLM** — a deliberate, user-approved exception scoped to import only | The user is importing their own document; tailoring still excludes identity (rules.md R-1/R-2) |
| D-6 | 2026-07-14 | Imported resumes are re-rendered into a server-assembled template; raw pasted LaTeX is stored (`source.tex`) but **never compiled**; only whitelisted/clamped style hints vary | Compiling arbitrary user LaTeX safely would need far stronger isolation (plan §9 "no arbitrary uploads") |
| D-7 | during build | Skip the plan's Phase-1 "Local CLI"; go straight to FastAPI + SPA | The API subsumed the CLI's purpose; pipeline reachable via `/api/tailor` |
| D-8 | during build | Mock provider excluded from compile-repair | Deterministic output — a repair round-trip is waste |
| D-9 | during build | Backend discards model-proposed IDs on import and assigns positional stable IDs | IDs are a security contract (rules.md R-12); the model must not control them |
| D-10 | during build | Compile semaphore rebuilt per event loop | Allows test event loops to work without cross-loop asyncio primitives |
| D-11 | 2026-07-16 | **R-13 amended: seed-resume tailoring survives only in demo mode.** In multi-user mode `/api/tailor` requires an owned `resume_id`; the seed (owner's personal data) is never served to other users | Multi-user privacy: the seed resume is the owner's PII |
| D-12 | 2026-07-16 | **R-9 amended: users may supply their own provider API keys** via `PUT /api/keys/{provider}`; keys are Fernet-encrypted at rest (key derived from `APP_SECRET_KEY`) and never echoed back (masked hint only). Operator env keys serve demo mode and are used for user requests only when `ALLOW_ENV_KEY_FALLBACK=true` | Multi-user product need; encryption + no-echo keeps the spirit of R-9 |
| D-13 | 2026-07-16 | **Legacy file-based storage removed** (`app/storage.py`, `data/<uuid>/`, `POST /api/import`, `GET /api/resume/{id}`); MongoDB stores (`app/db.py`) replace it, every query scoped by `user_id` | Lifecycle, quotas, and ownership isolation need a real store (closes old G-6) |
| D-14 | 2026-07-16 | Rate limiting / login throttling are **in-memory sliding windows** (per-process); Docker `CMD` now honors `$PORT` | Single-container deployment target; multi-replica deployments would need a shared limiter store |
| D-16 | 2026-07-16 | **Full-repo feature audit + two fixes.** Added a Tectonic-gated real-compile pytest (closes G-2) and fixed the run-history listing so it returns up to `max_runs_per_user` instead of a silent 50 (`app/routes_runs.py` now passes `limit=services.config.max_runs_per_user`); both backed by tests. The audit also surfaced by-design/nice-to-have gaps logged as G-14..G-18 rather than changed in code. | Keeps the automated suite honest about the real PDF pipeline; makes all retained runs visible. Deferred items (demo env-key gate, fabrication guard, pdf_data_url) need product decisions, not mechanical fixes. |
| D-15 | 2026-07-16 | **Post-revamp adversarial review + fixes.** 12 confirmed findings fixed with regression tests. Notable hardening decisions: (a) `PyMongoError` → structured 503 `database_unavailable` via a FastAPI exception handler **and** an in-middleware catch (BaseHTTPMiddleware runs before route handlers); (b) `ensure_indexes` runs as a background retry task (ping-first, 15s backoff) so an unreachable Mongo never blocks uvicorn startup; (c) PBKDF2 hash/verify run in `run_in_executor` + a dummy-hash path on unknown-email login, closing the event-loop-block and the account-enumeration timing oracle together; (d) `resolve_llm_selection` falls back to the selected provider's default model so the operator's env `LLM_MODEL` can't bleed cross-provider (spec §6.4); (e) DELETE added to the body-size guard; (f) new `MAX_VERSIONS_PER_JD` cap prunes `jd_versions`. | Verified real by adversarial verifiers; each has a regression test |

## 4. Gap register

Severity: 🔴 blocks confidence in core promise · 🟠 should fix before deploy · 🟡 nice to have.

| # | Sev | Gap | Notes |
|---|---|---|---|
| G-1 | 🔴 | Real-provider LLM path never exercised (HTTP/retry/JSON-mode/`extract_resume`, incl. new `anthropic` provider) | Whether tailoring quality is real with Groq/Gemini is unproven |
| G-2 | ✅ closed 2026-07-16 | ~~No automated real-compile test~~ | `tests/test_compile_integration.py` renders the seed and runs a real Tectonic compile (gated `@pytest.mark.integration`, skips when the binary is absent); asserts valid one-page `%PDF-` + selectable text (D-16) |
| G-3 | 🟠 | Frontend has zero automated coverage in the repo suite | Verified via `node --check` + a scripted DOM-stub smoke harness during the revamp, but no committed browser tests |
| G-4 | 🟠 | Deployment unverified: no Docker **image build** / cold-start / privacy test; no dependency lockfile | `$PORT` fixed 2026-07-16. Real MongoDB (mongo:7) + real Tectonic compile + full journey manually verified 2026-07-16 (see §2); image build + HF Space still unproven |
| G-5 | 🟠 | Fabrication guard is numeric-only | Invented non-numeric facts (fake employer/tech/credential) pass validation |
| G-6 | ✅ closed 2026-07-16 | ~~Import storage has no lifecycle / not transactional~~ | Mongo stores with quotas, delete routes, and run pruning replaced the 4-file layout (D-13) |
| G-7 | 🟡 | Body-size 413 guard trusts declared `Content-Length`; chunked requests bypass it | Middleware in `app/main.py` |
| G-8 | 🟡 | Untested branches: `GET /` + static mount, "repaired compile also failed" branch | Provider-error → 429/502 mappings and empty-changes warning gained coverage in the revamp |
| G-12 | 🟠 | Rate limiter / login throttle state is per-process (in-memory) | Fine for the single-container target; multi-replica needs a shared store (D-14) |
| G-13 | 🟡 | `APP_SECRET_KEY` rotation invalidates all stored user keys (`key_decrypt_failed` 500 → user must re-enter) | No re-encryption tooling exists |
| G-9 | 🟡 | No adversarial-JD test (malicious instructions embedded in a JD) | Architecture defends it; scenario never asserted |
| G-10 | 🟡 | `_safe_url` rejection paths, blank-text checks, and the POSIX resource limiter are untested; `RLIMIT_AS` is Linux-only (no memory cap on macOS dev) | |
| G-11 | 🟡 | Phase 4 unbuilt: eval harness, automatic provider failover, cover letter | Plan labels this "ongoing" |
| G-14 | 🟠 | Demo mode uses the operator's env LLM key with **no `ALLOW_ENV_KEY_FALLBACK` gate** | `app/main.py` demo branch passes provider/model straight to `app/llm.py` which reads the env key; a publicly-exposed demo instance lets anonymous (IP-throttled) visitors burn provider quota. Partly intended (README says keep demo private) but the gate asymmetry vs multi-user is undocumented |
| G-15 | ✅ closed 2026-07-16 | ~~Tailor-history listing silently capped at 50 while up to 2000 runs stored~~ | `list_runs` now lists `limit=config.max_runs_per_user`; regression test in `tests/test_runs_api.py` (D-16). Future: real pagination if a user nears the 2000 cap |
| G-16 | 🟡 | `TailorResponse.pdf_data_url` is dead (always `None`) with a frontend fallback that can never fire | `app/main.py:727`; `static/app.js` `normalizeResponse`. Cosmetic dead code — remove field+branch or populate it |
| G-17 | 🟡 | PDF-imported resumes discard the original PDF; the "source" download returns only extracted text (D-6 "source stored verbatim" holds for LaTeX imports only) | `app/routes_resumes.py` stores `source_text`, never the raw PDF bytes |
| G-18 | 🟡 | Account edge cases: `default_provider` may be set to `custom`/`mock` (no storable key); no password-reset / email-verification / password-change; unauthenticated `/api/health` discloses mode/provider/model/version | All low-severity for the private single-owner target |

## 5. Deferred / rejected ideas

- **Byte/hash protected-region comparison** (plan §2.2) — superseded by the token-slot model (D-2).
- **Local CLI** (plan Phase 1) — skipped (D-7).
- **Compiling imported user LaTeX directly** — rejected for safety (D-6); `source.tex` retained for possible future exact-layout work under stronger isolation.
- **Public deployment** — rejected until auth + rate limiting exist (rules.md M-3).

## 6. Next-step candidates (priority order)

1. Close G-1: one real-provider integration run (Groq) + a tiny repeatable eval set (compile success, fact preservation, keyword coverage).
2. ~~Close G-2~~ ✅ done 2026-07-16 (`tests/test_compile_integration.py`, D-16).
3. Close G-4: build the image, verify cold start / cached compile / secrets / privacy on a private deployment with a real MongoDB (`MONGODB_URI` + `APP_SECRET_KEY` set); add a lockfile.
4. Close G-3: minimal browser smoke (Playwright or scripted fetch against a served static dir).
5. Close G-5: extend fabrication guard (e.g., proper-noun/entity diff against factual source).
6. Decide G-14: gate demo-mode env-key usage behind `ALLOW_ENV_KEY_FALLBACK` (or document it as intended for private demos only).

## 7. Operational notes

- Dev: `uvicorn app.main:app --host 127.0.0.1 --port 7860 --reload`; tests: `.venv/bin/python -m pytest -q`.
- `LLM_PROVIDER=mock` (default) gives a deterministic offline flow — output is *not* genuinely tailored.
- Local toolchain via Homebrew: `brew install tectonic poppler`.
- Docker build needs network once (cache pre-warm); runtime is `--only-cached`, so template/package changes require an image rebuild (rules.md M-1).
