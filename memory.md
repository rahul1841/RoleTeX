# Memory — JD Resume Builder ("RoleTeX")

> Living project memory: current state, decision log, verified facts, and the gap register.
> Update this file whenever a significant decision is made, a gap is opened/closed, or a claim is re-verified.
> Companion docs: [prd.md](prd.md) · [architecture.md](architecture.md) · [design.md](design.md) · [rules.md](rules.md)

---

## 1. Status snapshot — 2026-07-14

- **Overall: ~80% of the MVP complete.** Security-critical core (validation, rendering, sandboxed compile, PII handling) built and tested.
- **Tests: 87/87 passing** in <1s (`.venv/bin/python -m pytest -q`, Python 3.9.6). Suite is fully offline: LLM stubbed, compiler subprocess mocked.
- **Git:** single commit (`7a03a14 first commit`); the multi-user import feature + refinements are staged, uncommitted. The five companion docs (prd/architecture/design/rules/memory.md) are untracked, and the `.dockerignore` hunk excluding them from the image is unstaged.
- **Phases (plan.md §7):** P0 done · P1 mostly (no CLI — see D-7) · P2 mostly (frontend untested) · P3 mostly (deploy unverified) · P4 in progress.

## 2. Verified facts log

| Date | Fact | How verified |
|---|---|---|
| 2026-07-14 | Seed resume renders + compiles with **real** Tectonic 0.16.9 (`--untrusted`) into a valid 27KB **single-page** PDF; `pdftotext` output clean and ATS-readable (headings, contact line, selectable bullets) | Manual smoke script driving `/api/tailor` (mock provider, real compile) via `TestClient` |
| 2026-07-14 | Import flow works end-to-end: paste LaTeX → `/api/import` → `data/<uuid>/` profile (4 files) → `/api/tailor` with `resume_id` → sectioned render → valid PDF | Manual smoke script (mock provider — extraction content is placeholder by design; real parsing needs a real provider) |
| 2026-07-14 | All 87 tests pass; **zero** tests execute real Tectonic/poppler (subprocess + inspectors mocked) even though both are installed locally | `pytest -q -rs` + reading `tests/test_compiler.py` mocks |
| 2026-07-14 | Tectonic 0.16.9 + poppler (`pdfinfo`, `pdftotext`) available on local PATH via Homebrew | `command -v` + `--version` |

**Never verified yet:** any real LLM provider call (Groq etc.), Docker image build, HF deployment, frontend in a real browser, pinned Tectonic SHA-256.

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

## 4. Gap register

Severity: 🔴 blocks confidence in core promise · 🟠 should fix before deploy · 🟡 nice to have.

| # | Sev | Gap | Notes |
|---|---|---|---|
| G-1 | 🔴 | Real-provider LLM path never exercised (HTTP/retry/JSON-mode/`extract_resume`) | Whether tailoring quality is real with Groq/Gemini is unproven |
| G-2 | 🔴 | No automated real-compile test | Suite mocks subprocess; add a tectonic-gated (skip-if-missing) integration test |
| G-3 | 🟠 | Frontend has zero automated coverage | Client validation, diff render, base64 PDF decode, `localStorage` logic all unverified |
| G-4 | 🟠 | Deployment unverified: no image build / cold-start / privacy test; `CMD` hardcodes port 7860 (ignores `$PORT`); no dependency lockfile | Phase-3 completion test from plan §7 never run |
| G-5 | 🟠 | Fabrication guard is numeric-only | Invented non-numeric facts (fake employer/tech/credential) pass validation |
| G-6 | 🟠 | Import storage has no lifecycle (list/delete/TTL/quota) and 4-file create is not transactional | Unbounded growth; crash mid-create leaves an orphan partial profile |
| G-7 | 🟡 | Body-size 413 guard trusts declared `Content-Length`; chunked requests bypass it | Middleware in `app/main.py` |
| G-8 | 🟡 | Untested branches: `GET /api/resume/{id}`, `GET /` + static mount, provider-error → 429/502 mappings, `store_failed` 500, "repaired compile also failed" branch, empty-changes warning | Implemented, no coverage |
| G-9 | 🟡 | No adversarial-JD test (malicious instructions embedded in a JD) | Architecture defends it; scenario never asserted |
| G-10 | 🟡 | `_safe_url` rejection paths, blank-text checks, and the POSIX resource limiter are untested; `RLIMIT_AS` is Linux-only (no memory cap on macOS dev) | |
| G-11 | 🟡 | Phase 4 unbuilt: eval harness, automatic provider failover, cover letter | Plan labels this "ongoing" |

## 5. Deferred / rejected ideas

- **Byte/hash protected-region comparison** (plan §2.2) — superseded by the token-slot model (D-2).
- **Local CLI** (plan Phase 1) — skipped (D-7).
- **Compiling imported user LaTeX directly** — rejected for safety (D-6); `source.tex` retained for possible future exact-layout work under stronger isolation.
- **Public deployment** — rejected until auth + rate limiting exist (rules.md M-3).

## 6. Next-step candidates (priority order)

1. Close G-1: one real-provider integration run (Groq) + a tiny repeatable eval set (compile success, fact preservation, keyword coverage).
2. Close G-2: tectonic-gated real-compile pytest (skip when binary absent; runs locally + in Docker build).
3. Close G-4: build the image, verify cold start / cached compile / secrets / privacy on a private HF Space; fix `$PORT`; add a lockfile.
4. Close G-6: profile list/delete + TTL sweep + transactional create (write to temp dir, rename into place).
5. Close G-3: minimal browser smoke (Playwright or scripted fetch against a served static dir).
6. Close G-5: extend fabrication guard (e.g., proper-noun/entity diff against factual source).

## 7. Operational notes

- Dev: `uvicorn app.main:app --host 127.0.0.1 --port 7860 --reload`; tests: `.venv/bin/python -m pytest -q`.
- `LLM_PROVIDER=mock` (default) gives a deterministic offline flow — output is *not* genuinely tailored.
- Local toolchain via Homebrew: `brew install tectonic poppler`.
- Docker build needs network once (cache pre-warm); runtime is `--only-cached`, so template/package changes require an image rebuild (rules.md M-1).
