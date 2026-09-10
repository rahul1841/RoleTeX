# Architecture — RoleTeX

> Companion docs: [prd.md](prd.md) · [design.md](design.md) · [rules.md](rules.md) · [memory.md](memory.md)

Two applications: a Next.js frontend (browser only) and a FastAPI backend that
owns all business logic. One private container serves both — the frontend is a
static export, so no Node process runs in production. No queue.

---

## 1. System overview

```text
Browser
  └── Next.js frontend (frontend/ — App Router, React, TypeScript)
        │  built to a static export; no server-side rendering at request time
        │  JSON over HTTP, same origin (dev: next rewrites /api → uvicorn)
        ▼
FastAPI app  (backend/app/main.py — create_app() factory, DI-friendly)
        │
        ├── ResumeRepository (backend/app/resume.py) ── backend/resume/data.json + backend/resume/template.tex (locked seed, demo mode)
        ├── Database         (backend/app/db.py)     ── MongoDB (Motor): users, sessions, api_keys, resumes(+versions), jds(+versions), runs
        ├── Security         (backend/app/security.py)── PBKDF2 passwords, session tokens, Fernet key encryption, rate/login limiting, origin checks
        ├── LLM adapter      (backend/app/llm.py)     ── OpenAI-compatible chat completions (9 providers, per-user key overrides)
        ├── Importer         (backend/app/importer.py)── extraction normalization + template assembly
        ├── PDF text         (backend/app/pdftext.py) ── bounded poppler extraction (pdftotext/pdfinfo/pdftoppm) for PDF imports
        └── CompileService   (backend/app/compiler.py)── Tectonic in a per-request sandbox + poppler checks
```

## 2. Module map

| Module | Responsibility |
|---|---|
| `backend/app/main.py` | App factory (`create_app`), routes, tailor orchestration, single shared repair budget, body-size middleware, structured error responses, serving the built frontend |
| `backend/app/llm.py` | Provider-neutral chat client (`OpenAICompatibleLLM`): `generate`/`repair` for tailoring, `extract_resume` for import; env config resolution (`resolve_config`), retry/backoff, JSON-mode fallback |
| `backend/app/resume.py` | Load/validate locked resume data; `build_llm_resume_payload` (identity excluded); `validate_proposal` (safety contract); `escape_latex`; `redact_identity`; deterministic token rendering incl. `sectioned=True` mode; change list + unified diff |
| `backend/app/compiler.py` | `CompileService`: unique temp dir per compile, `tectonic -X compile --untrusted [--only-cached]`, timeout + POSIX rlimits, per-event-loop `asyncio.Semaphore`, `pdfinfo` page count, `pdftotext` extraction, log sanitization |
| `backend/app/importer.py` | Normalize LLM extraction into `ResumeData` (backend-assigned positional stable IDs), clamp style hints to whitelists, assemble a fully server-controlled `template.tex` |
| `backend/app/builder.py` | The same boundary for the *other* untrusted author — a person using the editor. Validates a draft into field-addressed errors, prunes blank rows, reuses the importer's normalization and template assembly, renders the untailored baseline. No LLM involved |
| `backend/app/config.py` | `AppConfig` dataclass; `load_config()` reads env with clamped, documented bounds |
| `backend/app/security.py` | Password hashing (PBKDF2-HMAC-SHA256), session token issue/hash, Fernet secret encryption + key hints, `RateLimiter`/`LoginThrottle`, CSRF origin check |
| `backend/app/db.py` | `Database` wrapper over Motor with per-collection stores; every query is `user_id`-scoped (ownership enforced at the query level) |
| `backend/app/auth.py` | Session dependency (`require_user`), auth routes, provider/key resolution for user LLM requests |
| `backend/app/pdftext.py` | Bounded poppler subprocess work (`%PDF-` magic check, size/page/timeout caps, no shell): `pdftotext` extraction, `pdfinfo` page gate, `pdftoppm` rasterization, `pdftohtml` link-annotation recovery |
| `backend/app/routes_keys.py` / `routes_resumes.py` / `routes_jds.py` / `routes_runs.py` | Route groups for per-user API keys, resume library, JD library, and tailor-run history |
| `backend/app/schemas.py` | All Pydantic models (`StrictModel` base, `extra="forbid"`) plus the `validate_model` / `dump_model` helpers every module validates through |
| `frontend/` | Next.js App Router frontend. `lib/api/` is the only code that talks to FastAPI (`schema.d.ts` is generated from the OpenAPI document); `hooks/` holds TanStack Query hooks, one module per domain; `components/common/` the shared primitives |
| `backend/resume/` | Seed: `data.json` (facts + stable IDs), `template.tex` (locked, 7 tokens), `assets/` (approved files; currently empty) |
| `docs/` | This file plus `prd.md`, `design.md`, `rules.md`, `plan.md`, `memory.md` |

## 3. HTTP surface

| Route | Purpose |
|---|---|
| `GET /api/health` | Mode (`demo`/`multi_user`), compiler/database/secret-key/pdftotext checks, seed render check when seed files exist → `ok` / `degraded` |
| `POST /api/tailor` | Core pipeline (below). Multi-user: auth + owned `resume_id` (+ optional `jd_id`), run persisted to history. Demo: seed resume, env LLM config |
| `POST /api/auth/register` / `login` / `logout`, `GET/PATCH/DELETE /api/me` | Accounts and sessions (HttpOnly `rt_session` cookie or `Authorization: Bearer`) |
| `GET /api/providers`, `GET /api/keys`, `PUT/DELETE /api/keys/{provider}` | Per-user provider keys, Fernet-encrypted at rest, masked hint only in responses |
| `GET/POST /api/resumes`, `POST /api/resumes/pdf`, `GET/PATCH/DELETE /api/resumes/{id}`, `.../versions[/pdf]`, `.../versions/{n}/source` | Resume library: LaTeX paste or PDF upload → LLM extraction → versioned storage |
| `POST /api/resumes/manual`, `PUT /api/resumes/{id}/content` | Write a resume in the app and edit it afterwards: structured draft → `backend/app/builder.py` → versioned storage. No provider key needed |
| `POST /api/resumes/preview` | Compile a draft as typed, or a stored resume, with no job description and no model call. Returns `pdf_base64` + the rendered LaTeX |
| `GET/POST /api/jds`, `GET/PUT/DELETE /api/jds/{id}`, `.../versions` | JD library with version history |
| `GET /api/runs`, `GET/DELETE /api/runs/{id}`, `POST /api/runs/{id}/compile` | Tailor history; on-demand recompile of stored LaTeX (no LLM) |
| `GET /` + `/*` | Serve the frontend's static export from `frontend/out` (override with `FRONTEND_DIR`). Mounted last, so `/api/*` always wins; an inline HTML notice is served when no build is present |

Middleware (one combined handler): declared-`Content-Length` body-size guard (PDF uploads `MAX_PDF_UPLOAD_BYTES`+64KB, LaTeX import *and* structured-resume routes 260KB — a whole resume authored in the editor arrives as one JSON document — other `/api/*` 64KB) → CSRF origin check for cookie-authenticated state-changing requests → sliding-window rate limiting (LLM bucket for tailor/imports/recompile *and* `/api/resumes/preview`, which spends a Tectonic compile rather than a model call; general bucket for other authed calls, so writing and saving a resume is never charged against the LLM budget; keyed by user id, `Retry-After` on 429). *Known gap: a request omitting `Content-Length` (chunked) bypasses the size guard.*

## 4. Tailor request flow

```text
TailorRequest ──► resume source
                    │  multi-user → require_user + owned resume from Mongo
                    │               (current version, sectioned=True);
                    │               jd_id → owned JD content; provider/key per user
                    │  demo mode  → ResumeRepository seed (sectioned=False), env config
                    ▼
             build_llm_resume_payload      ← identity stripped here
                    ▼
             llm.generate(JD, payload) ──► validate_proposal
                    │ invalid/parse error → llm.repair(...) once → re-validate
                    │ still invalid       → 422 invalid_llm_proposal
                    ▼
             render_template_text (exactly-once token substitution,
                                   leftover-token rejection, LaTeX escaping)
                    ▼
             build_change_list + build_unified_diff
                    ▼
             CompileService.compile (if compile=true)
                    │ latex_compile_failed  → one repair with identity-REDACTED log excerpt *
                    │ page_count > 1 &&
                    │   require_one_page    → one shortening repair *
                    │   (MAX_PDF_PAGES only drives a compiler warning)
                    │            (* only if the semantic repair was not already used)
                    ▼
             TailorResponse: proposal, changes, unified_diff, latex_source,
                             pdf_base64, page_count, compiler report, run_id
                    ▼
             multi-user + save_run → RunStore.create (capped latex/diff,
                             JD excerpt, no PDF bytes; oldest runs pruned)
```

The **single repair budget** is the key orchestration invariant: at most one LLM repair per request, whether spent on semantic validation, compile failure, or page overflow.

## 5. Import request flow

```text
POST /api/resumes (latex)          POST /api/resumes/pdf (multipart)
        │                                  │ magic/size checks →
        │                                  │ pdfinfo page gate (> MAX_IMPORT_PDF_PAGES → 422,
        │                                  │   fails open when pdfinfo is absent) →
        │                                  │ pdftext.extract_pdf_text (bounded subprocess)
        │                                  │ pdftext.render_pdf_pages (pdftoppm → PNG)
        │                                  │ pdftext.extract_pdf_links (pdftohtml → label/URL)
        │                                  │   text + pages, provider sees images → "text_and_image"
        │                                  │   text only, provider is text-only  → "text" (+ warning)
        │                                  │   no text layer at all (a scan)     → "image"
        ▼                                  ▼
   llm.extract_resume(source_kind="latex"|"text"|"image"|"text_and_image")
        (FULL document incl. identity — deliberate, import-only
         exception; see rules.md R-2)
        ▼
   importer normalization: model IDs discarded → backend positional IDs
   style clamped: paper/font size whitelists, margin 1.0–3.0cm
                  (schema outer bound 0.5–4.0), accent 6-hex
        ▼
   server-assembled template.tex (only clamped style values vary;
   raw user LaTeX / PDF text is NEVER compiled)
        ▼
   render-check (sectioned) → ResumeStore.create / add_version (quota-checked)
        ▼
   Mongo: resumes + resume_versions {data, template_tex, source_text, style, ...}
```

### 5.1 Manual authoring flow

```text
POST /api/resumes/manual            PUT /api/resumes/{id}/content
POST /api/resumes/preview {resume}  (same draft shape, different destination)
        │
        ▼
   ResumeDraft (Pydantic, extra="forbid"): lenient on emptiness, strict on
   shape — a client-supplied `id` is rejected outright
        ▼
   builder.validate_draft → field-addressed errors, or nothing
        (blank rows are dropped, partially filled rows are reported by the
         position the author sees)
        ▼
   builder.prune_draft → importer.normalize_extracted_resume
        (identical normalization to import: backend positional stable IDs)
        ▼
   sanitize_style → assemble_template → render (sectioned, escape_latex)
        ▼
   manual: ResumeStore.create / add_version, source_type="manual",
           source_text = the rendered .tex (there is no original document)
   preview: CompileService → PDF bytes, nothing stored
```

No LLM participates in any of these three routes, so a user with no provider key
can own and compile a resume; the model is only involved once they tailor it.

## 6. Trust boundaries & threat model

Private, single-owner deployment. Five enforced safety goals:

1. **PII containment** — identity (name, email, phone, location, links) is never in a tailoring LLM payload; it is restored only during local rendering. Compiler diagnostics are identity-redacted before any repair prompt. *Exception:* import deliberately sends the user's own full paste.
2. **No LaTeX injection** — the model returns plain text in a strict schema; the server escapes all specials and owns the template. Unknown/leftover tokens abort the render.
3. **Sandboxed compilation** — unique temp dir per request, `--untrusted`, `--only-cached` (default), argument-list invocation (never `shell=True`), timeout, POSIX rlimits (`RLIMIT_CPU/FSIZE/NOFILE`; `RLIMIT_AS` Linux-only), bounded concurrency.
4. **No fabrication** — stable-ID existence/uniqueness, exact skills multiset permutation, numeric-claim guard, length/growth caps. (*Known limit: guard is numeric-only.*)
5. **JD is data, not instructions** — prompt framing + strict schema + server-side rendering mean a hostile JD cannot alter the output contract.

## 7. Data model

- **Seed resume:** `backend/resume/data.json` → `ResumeData` (identity, summary, experience[], projects[], education[], skills[], achievements[]) with stable string IDs on every editable node. `backend/resume/template.tex` contains each token exactly once: `@@CONTACT@@ @@SUMMARY@@ @@EXPERIENCE@@ @@PROJECTS@@ @@EDUCATION@@ @@SKILLS@@ @@ACHIEVEMENTS@@, plus the optional @@CUSTOM@@`.
- **Per-user profile:** `data/<uuid32>/` — `data.json` (extracted `ResumeData`), `template.tex` (server-assembled, style-personalized), `source.tex` (verbatim paste, never compiled), `meta.json` (provider/model/timestamps). Directory is git-ignored (only `.gitkeep` tracked) and docker-ignored.

## 8. Error model

Structured JSON errors via `_api_error`: `{code, message, ...details}`.

| Condition | HTTP | code |
|---|---|---|
| LLM unconfigured | 503 | `llm_not_configured` |
| Provider HTTP failure | 429/502 | provider error passthrough |
| Proposal invalid after repair | 422 | `invalid_llm_proposal` |
| Import extraction invalid | 422 | extraction error |
| Compiler missing / start failed | 503 | `compiler_not_found` / start error |
| Compile timeout | 504 | timeout |
| Unknown `resume_id` | 404 | not found |
| Oversized body | 413 | too large |
| Stored/locked resume corrupt | 500 | `resume_configuration_error` |
| Import profile persistence failed | 500 | `store_failed` |

## 9. Concurrency & resources

- Compiles bounded by an `asyncio.Semaphore` (`COMPILE_CONCURRENCY`, 1–4, default 1), rebuilt per event loop (test-friendly), executed via `run_in_executor`.
- Every compile in its own `tempfile.TemporaryDirectory(prefix="resume-job-")`, always cleaned up.
- LLM HTTP: bounded timeout (5–180s), capped max tokens, retry/backoff on 429/5xx.

## 10. Configuration

All via environment variables — see the README table for the full list. Key ones: `LLM_PROVIDER` (no default), `LLM_MODEL`, `${PROVIDER}_API_KEY` / `LLM_API_KEY`, `TECTONIC_BIN`, `TECTONIC_ONLY_CACHED` (default `true`), `COMPILE_TIMEOUT_SECONDS`, `COMPILE_CONCURRENCY`, `MAX_PDF_PAGES`, `USER_DATA_DIR` (default `data`), `RESUME_DATA_PATH`, `RESUME_TEMPLATE_PATH`. HTTPS is enforced for provider base URLs by default (`ALLOW_INSECURE_LLM_BASE_URL=true` opts out).

## 11. Deployment

Single Docker image (see `Dockerfile`): checksum-pinned Tectonic 0.16.9 (x86-64 only, guarded), non-root UID 1000 (matches HF Spaces), `TECTONIC_UNTRUSTED_MODE=1`, two-pass cache pre-warm proving the `--only-cached` path, port 7860. Target: **private** Hugging Face Docker Space. *Known gaps: the image has no Node stage, so it ships no frontend and answers `/` with a "no UI installed" notice (see README, "The frontend is not in the image yet"); deps range-pinned without a lockfile; deployment never verified end-to-end.*

## 12. Verification

**There is no automated test suite.** `tests/` was deleted on 2026-09-10 during an architecture rework; it is recoverable from git at `0565cf6` or earlier.

`create_app(repository, llm_client, compiler, static_dir, database, config, pdf_extractor, pdf_renderer, pdf_link_extractor, mailer)` still accepts injected doubles at every boundary — filesystem, LLM, compiler, database, PDF tooling, mailer — so the app can be driven offline in-process. In practice: `LLM_PROVIDER=stub` plus an `httpx.ASGITransport` client against `create_app()` exercises the real routes through the real middleware stack with no provider key and no network.

The Docker build is the only thing that still verifies the LaTeX pipeline for real: its prewarm renders the seed resume and four style variants and compiles each with Tectonic twice, so a broken template or an uncached package fails the build.
