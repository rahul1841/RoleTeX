# Architecture — RoleTeX

> How the system is put together. Product: [prd.md](prd.md) · Contracts and details: [design.md](design.md) · Invariants: [rules.md](rules.md)

A Next.js frontend and a FastAPI backend that owns all business logic. The frontend is a static export served by FastAPI, so production runs one Python process in one container. MongoDB is the only store; there is no queue.

## 1. Overview

```text
Browser ── Next.js static export (frontend/)
             │  JSON over HTTP, same origin (dev: next dev proxies /api → uvicorn)
             ▼
FastAPI app (backend/app/main.py, create_app() factory)
  ├── ResumeRepository  resume.py      seed resume + locked template (demo mode)
  ├── Database          db.py          MongoDB (Motor), every query scoped by user_id
  ├── Security          security.py    PBKDF2, session tokens, Fernet, rate limits, CSRF, password policy
  ├── LLM client        llm.py         one OpenAI-compatible client for all providers (llm_stub.py offline)
  ├── Importer/Builder  importer.py, builder.py   normalize extracted or hand-written resumes
  ├── PDF tools         pdftext.py     bounded poppler: text, page images, link targets
  ├── Compiler          compiler.py    Tectonic in a per-job sandbox
  └── Mailer            mailer.py      SMTP, or the server log when SMTP_HOST is unset
```

## 2. Modules

| Module | Responsibility |
|---|---|
| `main.py` | App factory, middleware, `/api/health`, `/api/tailor` orchestration and the single repair budget, static frontend serving |
| `auth.py` | Sessions, register (with sign-up code), login/logout, `/api/me`, per-user provider/key resolution |
| `routes_account.py` | Sign-up code, password change/reset, email verification, session list/revoke |
| `routes_resumes.py` · `routes_jds.py` · `routes_runs.py` · `routes_keys.py` | Resume library, JD library, tailor history, provider keys |
| `resume.py` | Seed loading, `build_llm_resume_payload` (identity stripped), `validate_proposal`, `escape_latex`, `redact_identity`, token rendering, change list + diff |
| `importer.py` | Normalize an LLM extraction (server-assigned IDs), `sanitize_style`, assemble the server-controlled template |
| `builder.py` | Validate and normalize a hand-written draft through the importer's path; no LLM |
| `llm.py` | Provider registry, env resolution, retries, JSON mode, `generate` / `repair` / `extract_resume` |
| `compiler.py` | Temp dir per compile, `tectonic -X compile --untrusted [--only-cached]`, timeout, rlimits, semaphore, page count, text check |
| `pdftext.py` | `%PDF-` check and size/page/timeout caps; `pdftotext`, `pdfinfo`, `pdftoppm`, `pdftohtml`; no shell |
| `db.py` | Stores: `users`, `sessions`, `auth_tokens`, `signup_codes`, `api_keys`, `resumes` + `resume_versions`, `jds` + `jd_versions`, `runs` |
| `security.py` · `config.py` · `schemas.py` | Crypto and limits · env config with clamped bounds · all Pydantic models (`StrictModel`, `extra="forbid"`) |
| `frontend/` | App Router UI; `lib/api/` is the only code that calls the API (`schema.d.ts` is generated); `hooks/` holds TanStack Query hooks |
| `backend/resume/` | Seed `data.json` (facts + stable IDs), locked `template.tex`, `assets/` |

## 3. HTTP surface

| Area | Routes |
|---|---|
| Health | `GET /api/health` — mode, subsystem checks (resume render, compiler, database, LLM, secret key, poppler tools) → `ok` / `degraded` |
| Tailor | `POST /api/tailor` |
| Auth | `POST /api/auth/register/code`, `/register`, `/login`, `/logout` · `GET/PATCH/DELETE /api/me` |
| Account | `POST /api/auth/password`, `/password/forgot`, `/password/reset`, `/verify/request`, `/verify/confirm` · `GET/DELETE /api/sessions`, `DELETE /api/sessions/{id}` |
| Keys | `GET /api/providers`, `GET /api/keys`, `PUT/DELETE /api/keys/{provider}` |
| Resumes | `GET/POST /api/resumes`, `POST /api/resumes/pdf`, `/manual`, `/preview` · `GET/PATCH/DELETE /api/resumes/{id}`, `PUT …/content` · `GET/POST …/versions`, `POST …/versions/pdf`, `GET …/versions/{n}/source` |
| JDs | `GET/POST /api/jds` · `GET/PUT/DELETE /api/jds/{id}`, `GET …/versions` |
| Runs | `GET /api/runs` · `GET/DELETE /api/runs/{id}`, `POST …/compile` |
| Frontend | `GET /` and `/*` — the static export from `frontend/out` (`FRONTEND_DIR` overrides), mounted last so `/api/*` always wins |

Sessions use an HttpOnly `rt_session` cookie (or `Authorization: Bearer`). Demo mode answers every database-backed route with `503 database_not_configured`.

**Request pipeline:** a byte-counting body cap (64 KB; 260 KB for LaTeX import and structured-resume routes; `MAX_PDF_UPLOAD_BYTES` + 64 KB for PDF uploads) → CSRF origin check on cookie-authenticated writes → rate limits. The LLM bucket covers tailor, imports and new versions, preview and recompile, keyed per user with a per-IP ceiling; everything else uses the general bucket. Mail routes (sign-up code, password reset, verification) also charge a per-IP and per-address mail bucket. Mongo errors become `503 database_unavailable`.

## 4. Tailor flow

```text
TailorRequest ─► resume source
                   multi-user → owned resume (current version, sectioned), optional saved JD, user's provider/key
                   demo       → seed resume, operator env config
               ─► build_llm_resume_payload            (identity stripped)
               ─► llm.generate(JD, payload) ─► validate_proposal
                     invalid → llm.repair once → re-validate → still invalid: 422 invalid_llm_proposal
               ─► render template (each token once, leftovers rejected, all text escaped)
               ─► change list + unified diff
               ─► compile (unless compile=false)
                     latex_compile_failed → one repair with an identity-redacted log   ┐ only if the repair
                     >1 page and require_one_page → one shortening repair              ┘ budget is unused
               ─► TailorResponse (changes, diff, LaTeX, PDF, page count, compiler report, run_id)
               ─► multi-user + save_run → store the run (LaTeX, diff, JD excerpt; no PDF bytes)
```

At most one LLM repair per request, whichever need comes first (R-11).

## 5. Import and authoring flows

```text
POST /api/resumes (LaTeX)            POST /api/resumes/pdf
        │                              size/magic check → pdfinfo page cap (fails open)
        │                              → pdftotext + pdftoppm page images + pdftohtml link targets
        │                              source_kind: text_and_image (vision provider) | text (text-only) | image (scan)
        ▼                              ▼
   llm.extract_resume — whole document incl. contact details (import-only exception, R-2)
        ▼
   normalize: model IDs discarded → server positional IDs; sanitize_style (A4, font whitelist, margin clamp, accent)
        ▼
   assemble server-controlled template → render check → store resume + version (quota-checked)
```

`POST /api/resumes/manual`, `PUT /api/resumes/{id}/content` and `POST /api/resumes/preview` take a structured draft instead: `builder.validate_draft` (field-addressed errors) → the same normalization and template assembly → store a version (manual) or compile and return the PDF without storing (preview). No LLM is involved, so no provider key is needed.

## 6. Trust boundaries

Private deployment; multi-user data isolated by `user_id` in every query.

1. **PII containment** — identity never enters a tailoring prompt; compiler logs are redacted before a repair prompt. Import is the one scoped exception.
2. **No LaTeX injection** — plain-text model output, server-side escaping, server-owned template.
3. **Sandboxed compilation** — see R-6.
4. **No fabrication** — ID existence and uniqueness, exact skill permutation, numeric-claim guard, length caps (the guard is numbers-only; see memory G-5).
5. **JD is data** — prompt framing plus the strict schema; a hostile JD can't change the output contract.

## 7. Data model

- **Seed:** `backend/resume/data.json` → `ResumeData` (identity, summary, experience, projects, education, skills, achievements, custom sections) with stable IDs on every editable node.
- **MongoDB:** `resumes` hold the current version pointer; `resume_versions` hold `{data, template_tex, source_text, source_type, style, provider, model}` with `source_type` one of `latex`, `pdf`, `pdf_scanned`, `manual`. `jds` / `jd_versions` keep archived revisions (oldest pruned). `runs` keep LaTeX, diff and a JD excerpt (oldest pruned). `auth_tokens` and `signup_codes` store only hashes, with TTL indexes. `api_keys` are Fernet-encrypted.

## 8. Errors

Every failure is JSON: `{"detail": {"code", "message", …}}` (C-4). Common codes:

| HTTP | Codes |
|---|---|
| 400 | `code_required`, `invalid_code`, `weak_password`, `invalid_token`, `provider_required`, `llm_key_required`, `resume_required` |
| 401 / 403 | `not_authenticated`, `invalid_credentials`, `account_disabled`, `email_verification_required`, `registration_disabled` |
| 404 | `resume_not_found`, `jd_not_found`, `run_not_found`, `session_not_found`, `key_not_found` |
| 409 | `email_taken`, `already_verified`, `resume_quota_exceeded`, `version_quota_exceeded`, `jd_quota_exceeded` |
| 413 | body over the cap, `pdf_too_large` |
| 422 | `invalid_llm_proposal`, `invalid_extraction`, `incomplete_resume`, `invalid_pdf`, `jd_required`, `preview_target_required`, `latex_compile_failed`, `unknown_provider` |
| 429 / 502 | rate limits (`too_many_requests`, `too_many_attempts`), `llm_provider_error` |
| 500 | `render_failed`, `resume_configuration_error`, `key_decrypt_failed` |
| 503 / 504 | `database_not_configured`, `database_unavailable`, `llm_not_configured`, `mail_not_configured`, `compiler_not_found` / `compile_timeout` |

## 9. Resources

Compiles run in `run_in_executor` behind a per-event-loop semaphore (`COMPILE_CONCURRENCY`, 1–4), each in its own `TemporaryDirectory`, always removed. LLM calls have a bounded timeout (5–180 s), capped tokens, and retries on 429/5xx.

## 10. Deployment

One Docker image: pinned, checksum-verified Tectonic 0.16.9 (x86-64 only), non-root UID 1000, `TECTONIC_UNTRUSTED_MODE=1`, a build-time cache prewarm that proves the `--only-cached` path, port `$PORT` (7860). The image has no Node stage yet, so it serves the API only (see README). Target: a private Hugging Face Docker Space.
