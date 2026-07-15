# Architecture — JD Resume Builder ("RoleTeX")

> Companion docs: [prd.md](prd.md) · [design.md](design.md) · [rules.md](rules.md) · [memory.md](memory.md)

One private FastAPI container. No database, no queue. All state is the seed resume on disk plus optional per-user profile directories.

---

## 1. System overview

```text
Browser (static/ vanilla JS SPA)
        │  JSON over HTTP
        ▼
FastAPI app  (app/main.py — create_app() factory, DI-friendly)
        │
        ├── ResumeRepository (app/resume.py) ── resume/data.json + resume/template.tex (locked seed, demo mode)
        ├── Database         (app/db.py)     ── MongoDB (Motor): users, sessions, api_keys, resumes(+versions), jds(+versions), runs
        ├── Security         (app/security.py)── PBKDF2 passwords, session tokens, Fernet key encryption, rate/login limiting, origin checks
        ├── LLM adapter      (app/llm.py)     ── OpenAI-compatible chat completions (8 providers + mock, per-user key overrides)
        ├── Importer         (app/importer.py)── extraction normalization + template assembly
        ├── PDF text         (app/pdftext.py) ── bounded poppler pdftotext extraction for PDF imports
        └── CompileService   (app/compiler.py)── Tectonic in a per-request sandbox + poppler checks
```

## 2. Module map

| Module | Responsibility |
|---|---|
| `app/main.py` | App factory (`create_app`), routes, tailor orchestration, single shared repair budget, body-size middleware, structured error responses, static file serving |
| `app/llm.py` | Provider-neutral chat client (`OpenAICompatibleLLM`): `generate`/`repair` for tailoring, `extract_resume` for import; env config resolution (`resolve_config`), retry/backoff, JSON-mode fallback, deterministic `mock` provider |
| `app/resume.py` | Load/validate locked resume data; `build_llm_resume_payload` (identity excluded); `validate_proposal` (safety contract); `escape_latex`; `redact_identity`; deterministic token rendering incl. `sectioned=True` mode; change list + unified diff |
| `app/compiler.py` | `CompileService`: unique temp dir per compile, `tectonic -X compile --untrusted [--only-cached]`, timeout + POSIX rlimits, per-event-loop `asyncio.Semaphore`, `pdfinfo` page count, `pdftotext` extraction, log sanitization |
| `app/importer.py` | Normalize LLM extraction into `ResumeData` (backend-assigned positional stable IDs), clamp style hints to whitelists, assemble a fully server-controlled `template.tex` |
| `app/config.py` | `AppConfig` dataclass; `load_config()` reads env with clamped, documented bounds |
| `app/security.py` | Password hashing (PBKDF2-HMAC-SHA256), session token issue/hash, Fernet secret encryption + key hints, `RateLimiter`/`LoginThrottle`, CSRF origin check |
| `app/db.py` | `Database` wrapper over Motor with per-collection stores; every query is `user_id`-scoped (ownership enforced at the query level) |
| `app/auth.py` | Session dependency (`require_user`), auth routes, provider/key resolution for user LLM requests |
| `app/pdftext.py` | Bounded `pdftotext` subprocess extraction (`%PDF-` magic check, size/timeout caps, no shell) |
| `app/routes_keys.py` / `routes_resumes.py` / `routes_jds.py` / `routes_runs.py` | Route groups for per-user API keys, resume library, JD library, and tailor-run history |
| `app/schemas.py` | All Pydantic models (`StrictModel` base, `extra="forbid"`), Pydantic v1/v2 compatibility helpers (`validate_model`, `dump_model`) |
| `static/` | Vanilla JS SPA: hash routing (auth/tailor/resumes/jds/history/settings), diff cards, PDF iframe preview, downloads, abort + request versioning; no localStorage |
| `resume/` | Seed: `data.json` (facts + stable IDs), `template.tex` (locked, 7 tokens), `assets/` (approved files; currently empty) |
| `tests/` | 244 offline tests; stub LLM, mocked compiler subprocess, and mongomock-motor database via `create_app` dependency injection |

## 3. HTTP surface

| Route | Purpose |
|---|---|
| `GET /api/health` | Mode (`demo`/`multi_user`), compiler/database/secret-key/pdftotext checks, seed render check when seed files exist → `ok` / `degraded` |
| `POST /api/tailor` | Core pipeline (below). Multi-user: auth + owned `resume_id` (+ optional `jd_id`), run persisted to history. Demo: seed resume, env LLM config |
| `POST /api/auth/register` / `login` / `logout`, `GET/PATCH/DELETE /api/me` | Accounts and sessions (HttpOnly `rt_session` cookie or `Authorization: Bearer`) |
| `GET /api/providers`, `GET /api/keys`, `PUT/DELETE /api/keys/{provider}` | Per-user provider keys, Fernet-encrypted at rest, masked hint only in responses |
| `GET/POST /api/resumes`, `POST /api/resumes/pdf`, `GET/PATCH/DELETE /api/resumes/{id}`, `.../versions[/pdf]`, `.../versions/{n}/source` | Resume library: LaTeX paste or PDF upload → LLM extraction → versioned storage |
| `GET/POST /api/jds`, `GET/PUT/DELETE /api/jds/{id}`, `.../versions` | JD library with version history |
| `GET /api/runs`, `GET/DELETE /api/runs/{id}`, `POST /api/runs/{id}/compile` | Tailor history; on-demand recompile of stored LaTeX (no LLM) |
| `GET /` + `/static` | Serve the SPA (inline HTML fallback if `static/index.html` is missing) |

Middleware (one combined handler): declared-`Content-Length` body-size guard (PDF uploads `MAX_PDF_UPLOAD_BYTES`+64KB, LaTeX import routes 260KB, other `/api/*` 64KB) → CSRF origin check for cookie-authenticated state-changing requests → sliding-window rate limiting (LLM bucket for tailor/imports/recompile, general bucket for other authed calls; keyed by user id, `Retry-After` on 429). *Known gap: a request omitting `Content-Length` (chunked) bypasses the size guard.*

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
                    │            (* only if the semantic repair was not already used,
                    │               and never for the mock provider)
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
        │                                  │ pdftext.extract_pdf_text (bounded subprocess)
        ▼                                  ▼
   llm.extract_resume(source_kind="latex"|"text")
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

## 6. Trust boundaries & threat model

Private, single-owner deployment. Five enforced safety goals:

1. **PII containment** — identity (name, email, phone, location, links) is never in a tailoring LLM payload; it is restored only during local rendering. Compiler diagnostics are identity-redacted before any repair prompt. *Exception:* import deliberately sends the user's own full paste.
2. **No LaTeX injection** — the model returns plain text in a strict schema; the server escapes all specials and owns the template. Unknown/leftover tokens abort the render.
3. **Sandboxed compilation** — unique temp dir per request, `--untrusted`, `--only-cached` (default), argument-list invocation (never `shell=True`), timeout, POSIX rlimits (`RLIMIT_CPU/FSIZE/NOFILE`; `RLIMIT_AS` Linux-only), bounded concurrency.
4. **No fabrication** — stable-ID existence/uniqueness, exact skills multiset permutation, numeric-claim guard, length/growth caps. (*Known limit: guard is numeric-only.*)
5. **JD is data, not instructions** — prompt framing + strict schema + server-side rendering mean a hostile JD cannot alter the output contract.

## 7. Data model

- **Seed resume:** `resume/data.json` → `ResumeData` (identity, summary, experience[], projects[], education[], skills[], achievements[]) with stable string IDs on every editable node. `resume/template.tex` contains each token exactly once: `@@CONTACT@@ @@SUMMARY@@ @@EXPERIENCE@@ @@PROJECTS@@ @@EDUCATION@@ @@SKILLS@@ @@ACHIEVEMENTS@@`.
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

All via environment variables — see the README table for the full list. Key ones: `LLM_PROVIDER` (default `mock`), `LLM_MODEL`, `${PROVIDER}_API_KEY` / `LLM_API_KEY`, `TECTONIC_BIN`, `TECTONIC_ONLY_CACHED` (default `true`), `COMPILE_TIMEOUT_SECONDS`, `COMPILE_CONCURRENCY`, `MAX_PDF_PAGES`, `USER_DATA_DIR` (default `data`), `RESUME_DATA_PATH`, `RESUME_TEMPLATE_PATH`. HTTPS is enforced for provider base URLs by default (`ALLOW_INSECURE_LLM_BASE_URL=true` opts out).

## 11. Deployment

Single Docker image (see `Dockerfile`): checksum-pinned Tectonic 0.16.9 (x86-64 only, guarded), non-root UID 1000 (matches HF Spaces), `TECTONIC_UNTRUSTED_MODE=1`, two-pass cache pre-warm proving the `--only-cached` path, port 7860. Target: **private** Hugging Face Docker Space. *Known gaps: `CMD` hardcodes 7860 (ignores `$PORT`); deps range-pinned without a lockfile; deployment never verified end-to-end.*

## 12. Testing architecture

`create_app(repository, llm_client, compiler, static_dir, store)` accepts injected doubles — tests wire a `StubLLM` and a fake compiler subprocess; everything runs offline in <1s. Real Tectonic/poppler and real providers are **not** exercised by the suite (verified manually on 2026-07-14 — see memory.md). Frontend has no automated coverage.
