# Design — JD Resume Builder ("RoleTeX")

> Detailed technical design: API contracts, validation rules, rendering, import, compilation, and frontend.
> Companion docs: [prd.md](prd.md) · [architecture.md](architecture.md) · [rules.md](rules.md)

---

## 1. API design

All models derive from `StrictModel` (`extra="forbid"`): unknown fields are rejected everywhere — requests, responses, and LLM output alike.

### 1.1 `POST /api/tailor` → `TailorResponse`

Request (`TailorRequest`):

| Field | Type | Constraints |
|---|---|---|
| `job_description` | str? | 50–20,000 chars; exactly one of this / `jd_id` (else 422 `jd_required`) |
| `jd_id` | str? | id of a saved JD from the user's library (multi-user only) |
| `provider` / `model` | str? | optional per-request override (multi-user: resolved against the user's stored keys) |
| `compile` | bool | default `true`; `false` returns LaTeX preview only |
| `require_one_page` | bool | default `true`; triggers shortening repair on overflow |
| `resume_id` | str? | required in multi-user mode (owned resume); omitted in demo mode → seed resume |
| `save_run` | bool | default `true`; multi-user: persist the run into tailor history |

Response (`TailorResponse`): `proposal` (the validated `TailorProposal`), `changes[]` (`{field_id, before, after}`), `unified_diff`, `latex_source`, `pdf_base64` (`pdf_data_url` exists in the schema but is always `null` — clients prepend the data-URL prefix themselves), `page_count`, `filename`, `provider`, `model`, `repaired`, `warnings[]`, `compiler` (`CompilerReport`: attempted/success/page_count/text_preview/warnings/log), `run_id` (multi-user, when the run was saved).

### 1.2 Resume import → `{resume: ResumeDetail, warnings[]}`

- `POST /api/resumes` — `latex` (40–200,000 chars), optional `name`/`provider`/`model`.
- `POST /api/resumes/pdf` — multipart `file` (+ optional `name`/`provider`/`model`); poppler `pdftotext` → LLM extraction with `source_kind="text"`.
- `POST /api/resumes/{id}/versions[/pdf]` — same bodies; bumps `current_version`.
Both quota-checked (409 `resume_quota_exceeded` / `version_quota_exceeded`); warnings always include a review-your-import advisory.

### 1.3 Other route groups

- Auth: `POST /api/auth/register|login|logout`, `GET/PATCH/DELETE /api/me` (session cookie `rt_session` or `Authorization: Bearer`).
- Keys: `GET /api/providers` (public), `GET /api/keys` (masked hints only), `PUT/DELETE /api/keys/{provider}` (Fernet-encrypted at rest).
- JDs: `GET/POST /api/jds`, `GET/PUT/DELETE /api/jds/{id}`, `GET /api/jds/{id}/versions` (edits archive the prior version).
- Runs: `GET /api/runs`, `GET/DELETE /api/runs/{id}`, `POST /api/runs/{id}/compile` (recompile stored LaTeX, no LLM).
- `GET /api/health` → `HealthResponse{status: ok|degraded, version, mode: demo|multi_user, provider, model, resume_valid, compiler_available, checks{}}`. When seed files exist, health *renders a real baseline proposal* against the locked seed — it proves the render path, not just liveness.
- Body-size middleware: declared `Content-Length` > `MAX_PDF_UPLOAD_BYTES`+64KB (PDF uploads) / 260KB (LaTeX imports) / 64KB (other `/api/*` writes) → 413. Non-integer `Content-Length` → 413.
- Demo mode (no `MONGODB_URI`): all DB-backed routes → 503 `database_not_configured`; only seed tailoring works.

## 2. LLM contract

### 2.1 Proposal schema (tailoring)

The model must return exactly:

```json
{
  "summary": "string, 1–1000 chars",
  "bullet_rewrites": [{"id": "existing bullet id", "text": "1–600 chars"}],
  "skills_order": ["exact permutation of existing skills"]
}
```

- ≤6 `bullet_rewrites`; `skills_order` capped at 300 entries.
- Extra keys are rejected by the strict schema; non-JSON output is rejected. The parser is deliberately lenient about *wrappers*: a valid JSON object inside a markdown fence or embedded in surrounding prose is extracted (first decodable object wins).

### 2.2 Provider adapter (`backend/app/llm.py`)

- One `OpenAICompatibleLLM` client for all providers; `PROVIDERS` maps each of `anthropic, groq, cerebras, grid, gemini, openrouter, mistral, openai, custom` to `(base_url, key_env, default_model, supports_vision)`.
- `resolve_config()` reads env: `LLM_PROVIDER` (no default — a provider must be named per request or by the operator), `LLM_MODEL`, `${PROVIDER}_API_KEY` then `LLM_API_KEY` fallback, optional `${PROVIDER}_BASE_URL` (`LLM_BASE_URL` applies to the `custom` provider only). HTTPS is enforced by default (`ALLOW_INSECURE_LLM_BASE_URL=true` opts out).
- Bounded knobs: timeout 5–180s (default 60), max tokens 256–8000 (default 3000), extraction max tokens 1000–8000 (default 6000), reasoning effort `none|minimal|low|medium|high` (default `low` for Gemini and Groq GPT-OSS).
- Retry/backoff on 429 and transient 5xx; JSON-mode request with plain-completion fallback when a provider rejects `response_format`.
- **`LLM_PROVIDER=stub`:** selects `backend/app/llm_stub.py`, a deterministic offline client for tests and frontend development. Never a default and never reachable by accident; its copy is fixture text prefixed `[stub]`, not model output. (This replaced the former in-client `mock` provider, which was removed because its placeholder facts were indistinguishable from a real extraction.)

### 2.3 Prompt contract

System prompt establishes: JD is untrusted reference data; reword/shorten/emphasize/reorder only; never fabricate employers, dates, skills, metrics, degrees; use only supplied IDs and skill values; return only the JSON schema; respect bullet length caps. Enforcement is server-side validation, never the prompt.

### 2.4 Repair design (single shared budget)

At most **one** repair LLM call per request, spent on the first of:

1. **Semantic repair** — proposal failed parsing/validation → `repair()` receives the error summary + original contract, output re-validated identically; second failure → 422.
2. **Compile repair** — only for `error_code == "latex_compile_failed"` (never environment errors), receives an **identity-redacted** log excerpt.
3. **Shortening repair** — PDF exceeded `require_one_page` target; if the shortened attempt fails, the original multi-page PDF is still returned.

## 3. Validation design (`validate_proposal`)

| Rule | Rejects |
|---|---|
| ID existence | any `bullet_rewrites.id` not in the resume |
| ID uniqueness | duplicate rewrite IDs |
| Skills permutation | `skills_order` ≠ exact multiset of existing flattened skills (no additions, drops, or renames) |
| Numeric fabrication | any normalized number token in proposed text absent from the factual source (`_new_numeric_claims`) |
| Length caps | summary >12 words or >120 chars (it renders as a headline); bullet >600 chars or >70 words, or >30 chars longer than its source bullet |
| Blank text | empty/whitespace-only rewrites |

*Known limit (tracked in memory.md): the fabrication guard is numeric-only; invented non-numeric facts pass.*

## 4. Rendering design (`backend/app/resume.py`)

- **Token-slot model:** `render_template_text` replaces each of the 7 tokens exactly once; any token left after substitution aborts the render. `validate_template` enforces the exactly-once contract up front.
- **Escaping:** `escape_latex` handles all ten LaTeX specials (`\ { } $ & % # _ ~ ^`), strips NUL, collapses newlines. Applied to every model-supplied string.
- **URLs:** `_safe_url` accepts only `http(s)` without control characters; bullet/project links are owned by the locked data — the model can never add or change a URL.
- **Sectioned mode (`sectioned=True`)** — used for imported profiles: rendering carries section headers with the content so empty sections collapse cleanly instead of leaving orphan headings. Seed template uses the classic non-sectioned layout.
- **Identity:** rendered into `@@CONTACT@@` from locked data only — it never round-trips through the model.
- **Diff:** `build_change_list` emits only material changes (`{field_id, before, after}`); `build_unified_diff` produces a reviewable text diff.

## 5. Import design (`backend/app/importer.py` + `backend/app/db.py` + `backend/app/pdftext.py`)

Pipeline: (PDF only: bounded `pdftotext` extraction) → `extract_resume` (LLM, JSON) → normalization → clamping → assembly → render-check → persist.

- **Normalization:** model-proposed IDs are discarded; the backend assigns deterministic positional IDs (stable across the profile's lifetime — see rules.md R-12).
- **Style clamping (`ResumeStyle`):** paper → whitelist (default `a4paper`); font size → whitelist (default `10pt`); `margin_cm` → clamped 1.0–3.0 by the importer's `sanitize_style` (default 2.0; the schema's outer bound is 0.5–4.0); `accent_hex` → optional, exactly 6 hex chars. Nothing else from the paste influences the preamble.
- **Template assembly:** a fully server-authored template embedding only the clamped style values, with the same 7-token contract. The raw paste / extracted PDF text is stored as `source_text` and **never compiled**.
- **Storage layout:** MongoDB `resumes` + `resume_versions` collections (`{data, template_tex, source_text, source_type, style, provider, model, ...}`), every query scoped by `user_id`; version numbers are monotonic and `current_version` tracks the latest.

## 6. Compiler design (`backend/app/compiler.py`)

- Invocation: `tectonic -X compile --untrusted [--only-cached] --outdir <job_dir> <job_dir>/resume.tex`, argument list, `check=False`, captured output.
- Isolation: fresh `TemporaryDirectory(prefix="resume-job-")` per compile; approved assets copied in; directory always removed.
- Limits: timeout via env (10–180s, default 90); `preexec_fn` applies `RLIMIT_CPU/FSIZE/NOFILE` (`RLIMIT_AS` only on Linux); concurrency via per-event-loop `asyncio.Semaphore` (1–4, default 1) with the blocking run in an executor.
- Post-checks: `pdfinfo` page count vs `MAX_PDF_PAGES`; `pdftotext` extraction (ATS sanity + `text_preview`); compiler log sanitized (temp paths stripped) and capped before leaving the service.
- Failure taxonomy: `compiler_not_found` / start failure → 503, timeout → 504, `latex_compile_failed` → 422-adjacent repairable, inspector failures degrade to warnings.

## 7. Frontend design (`frontend/`)

Next.js App Router + React + TypeScript + Tailwind + shadcn/ui, built to a
**static export** and served by FastAPI. Client-rendered throughout: every
screen sits behind an HttpOnly session cookie, so there is nothing to render on
a server that the browser cannot fetch itself.

Routes: `/` (tailor), `/resumes`, `/jds`, `/history`, `/settings`, plus the
signed-out group `/sign-in`, `/register`, `/forgot-password`, `/reset-password`,
`/verify-email`. Boot mirrors the API: `GET /api/health` decides the mode
(`demo` → seed tailoring only, storage screens explain themselves via
`<RequiresStorage>`; `multi_user` → `GET /api/me`, where a 401 is the normal
signed-out state).

- **Entity selection is a query parameter, never a route segment** (`/resumes?id=…`,
  `/history?run=…`). A static export cannot prerender `[id]` without
  `generateStaticParams`, which cannot know user records. This is also the first
  time the product has had working deep links.
- **One API layer.** `lib/api/client.ts` is the only place that calls `fetch`;
  it uses same-origin relative paths and `credentials: "same-origin"`, so the
  HttpOnly cookie and the Origin-equals-host CSRF check both work with no CORS
  middleware and no `SameSite=None` downgrade. In development `next dev`
  rewrites `/api/*` to uvicorn to preserve that single origin.
- **Types come from the server.** `lib/api/schema.d.ts` is generated from the
  live OpenAPI document (`npm run gen:api`), so TypeScript models cannot drift
  from Pydantic. Note the read/write asymmetry it encodes: `ResumeData` carries
  server-owned ids and object bullets, `ResumeDraft` has neither, and every
  request model is `extra="forbid"` — `lib/api/mappers.ts` converts between them.
- **Server state is TanStack Query**, keyed centrally in `lib/api/query-keys.ts`.
  Mutations never auto-retry; queries never retry a 4xx or a timeout, because
  every expensive call either spends provider tokens or runs Tectonic.
- Results view: reviewable change cards plus a unified diff rendered with
  dedicated `--diff-added` / `--diff-removed` design tokens (legible in both
  themes), the PDF preview alongside — never instead of — the changes (R-14),
  and downloads decoded from base64 into revoked object URLs.
- PDF preview uses `pdfjs-dist` from npm, dynamically imported client-side with
  the worker resolved via `new URL(..., import.meta.url)` so the bundler emits
  it; the old hand-vendored copy and its hard-coded worker path are gone.
- Accessibility: skip link, one `<h1>` per page owned by `<PageHeader>` with
  focus moved to it on navigation, `aria-current` on active nav, labelled inputs
  with `aria-invalid`/`aria-describedby`, and focus traps from the underlying
  Base UI primitives.
- *Known gap: no automated frontend tests. `npm run typecheck`, `npm run lint`
  and `npm run build` are the only gate, and no browser-driven verification has
  been run.*

## 8. Key design decisions & rationale

| Decision | Rationale |
|---|---|
| Token-slot template instead of byte/hash protected-region comparison (plan §2.2) | The model never produces LaTeX at all, so there is no document to diff against; exactly-once substitution + leftover rejection gives a stronger guarantee with less machinery |
| Structured fields instead of full-file LLM output | Smaller/cheaper responses, no injection surface, deterministic rendering |
| Single shared repair budget | Caps cost and attack surface; repair can't ping-pong |
| Server-assembled import templates | Compiling user LaTeX safely would require full sandbox hardening; clamped style hints capture most visual identity at ~zero risk |
| Mock provider excluded from compile-repair | Its output is deterministic; a repair round-trip is pure waste |
| MongoDB (Motor) with a demo fallback | Multi-user accounts/libraries need a real store; the app still boots without `MONGODB_URI` in a degraded seed-only demo mode |
| Web-only (no CLI from plan Phase 1) | The API + SPA subsumed the CLI's purpose; folded into Phase 2 |
