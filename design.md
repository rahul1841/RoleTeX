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
| `job_description` | str | required, 50–20,000 chars |
| `provider` / `model` | str? | optional per-request override |
| `compile` | bool | default `true`; `false` returns LaTeX preview only |
| `require_one_page` | bool | default `true`; triggers shortening repair on overflow |
| `resume_id` | str? | optional imported-profile id; omitted → seed resume |

Response (`TailorResponse`): `proposal` (the validated `TailorProposal`), `changes[]` (`{field_id, before, after}`), `unified_diff`, `latex_source`, `pdf_base64` (`pdf_data_url` exists in the schema but is always `null` — clients prepend the data-URL prefix themselves), `page_count`, `filename`, `provider`, `model`, `repaired`, `warnings[]`, `compiler` (`CompilerReport`: attempted/success/page_count/text_preview/warnings/log).

### 1.2 `POST /api/import` → `ImportResponse`

Request: `latex` (40–200,000 chars), optional `provider`/`model`.
Response: `id` (32-char UUID hex), `provider`, `model`, `style` (`ResumeStyle`), `resume` (full extracted `ResumeData`), `warnings[]` (always includes a review-your-import advisory).

### 1.3 Other routes

- `GET /api/health` → `HealthResponse{status: ok|degraded, version, provider, model, resume_valid, compiler_available, checks{}}`. Health *renders a real baseline proposal* against the locked seed — it proves the render path, not just liveness.
- `GET /api/resume/{id}` → `{id, resume}` wrapper around the stored `ResumeData` (404 on miss; hidden from OpenAPI).
- Body-size middleware: declared `Content-Length` > 260KB (import) / 64KB (other `/api/*` writes) → 413. Non-integer `Content-Length` → 413.

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

### 2.2 Provider adapter (`app/llm.py`)

- One `OpenAICompatibleLLM` client for all providers; `PROVIDERS` maps each of `groq, cerebras, gemini, openrouter, mistral, openai, custom` to `(base_url, key_env, default_model)`.
- `resolve_config()` reads env: `LLM_PROVIDER` (default **mock**), `LLM_MODEL`, `${PROVIDER}_API_KEY` then `LLM_API_KEY` fallback, optional `${PROVIDER}_BASE_URL` (`LLM_BASE_URL` applies to the `custom` provider only). HTTPS is enforced by default (`ALLOW_INSECURE_LLM_BASE_URL=true` opts out).
- Bounded knobs: timeout 5–180s (default 60), max tokens 256–8000 (default 3000), extraction max tokens 1000–8000 (default 6000), reasoning effort `none|minimal|low|medium|high` (default `low` for Gemini and Groq GPT-OSS).
- Retry/backoff on 429 and transient 5xx; JSON-mode request with plain-completion fallback when a provider rejects `response_format`.
- **`mock` provider:** deterministic, offline output for dev/tests (no network; skills are reordered by JD keyword frequency, so output does vary with the JD); excluded from compile-repair.

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

## 4. Rendering design (`app/resume.py`)

- **Token-slot model:** `render_template_text` replaces each of the 7 tokens exactly once; any token left after substitution aborts the render. `validate_template` enforces the exactly-once contract up front.
- **Escaping:** `escape_latex` handles all ten LaTeX specials (`\ { } $ & % # _ ~ ^`), strips NUL, collapses newlines. Applied to every model-supplied string.
- **URLs:** `_safe_url` accepts only `http(s)` without control characters; bullet/project links are owned by the locked data — the model can never add or change a URL.
- **Sectioned mode (`sectioned=True`)** — used for imported profiles: rendering carries section headers with the content so empty sections collapse cleanly instead of leaving orphan headings. Seed template uses the classic non-sectioned layout.
- **Identity:** rendered into `@@CONTACT@@` from locked data only — it never round-trips through the model.
- **Diff:** `build_change_list` emits only material changes (`{field_id, before, after}`); `build_unified_diff` produces a reviewable text diff.

## 5. Import design (`app/importer.py` + `app/storage.py`)

Pipeline: `extract_resume` (LLM, JSON) → normalization → clamping → assembly → render-check → persist.

- **Normalization:** model-proposed IDs are discarded; the backend assigns deterministic positional IDs (stable across the profile's lifetime — see rules.md R-12).
- **Style clamping (`ResumeStyle`):** paper → whitelist (default `a4paper`); font size → whitelist (default `10pt`); `margin_cm` → clamped 1.0–3.0 by the importer's `sanitize_style` (default 2.0; the schema's outer bound is 0.5–4.0); `accent_hex` → optional, exactly 6 hex chars. Nothing else from the paste influences the preamble.
- **Template assembly:** a fully server-authored `template.tex` embedding only the clamped style values, with the same 7-token contract. The raw paste is stored as `source.tex` and **never compiled**.
- **Storage layout:** `data/<uuid32>/{data.json, template.tex, source.tex, meta.json}`. UUIDs are canonicalized before path use (path-traversal defense). Writes are per-file atomic (temp + rename), though the 4-file create is not transactional (gap tracked in memory.md).

## 6. Compiler design (`app/compiler.py`)

- Invocation: `tectonic -X compile --untrusted [--only-cached] --outdir <job_dir> <job_dir>/resume.tex`, argument list, `check=False`, captured output.
- Isolation: fresh `TemporaryDirectory(prefix="resume-job-")` per compile; approved assets copied in; directory always removed.
- Limits: timeout via env (10–180s, default 90); `preexec_fn` applies `RLIMIT_CPU/FSIZE/NOFILE` (`RLIMIT_AS` only on Linux); concurrency via per-event-loop `asyncio.Semaphore` (1–4, default 1) with the blocking run in an executor.
- Post-checks: `pdfinfo` page count vs `MAX_PDF_PAGES`; `pdftotext` extraction (ATS sanity + `text_preview`); compiler log sanitized (temp paths stripped) and capped before leaving the service.
- Failure taxonomy: `compiler_not_found` / start failure → 503, timeout → 504, `latex_compile_failed` → 422-adjacent repairable, inspector failures degrade to warnings.

## 7. Frontend design (`static/`)

Vanilla JS SPA, no build step. Two panes: **Import** (paste LaTeX → profile chip persisted in `localStorage`) and **Tailor** (JD textarea → results).

- Results view: before/after diff cards (`<del>`/`<ins>`), embedded PDF `<iframe>` from a base64 object URL, PDF + `.tex` downloads.
- Robustness: in-flight request abort + monotonic request versioning (stale responses dropped), object-URL revocation, status-specific error copy, reduced-motion support. Progress messages are canned/cosmetic, not backend-driven.
- *Known gap: zero automated coverage; verified only by manual use.*

## 8. Key design decisions & rationale

| Decision | Rationale |
|---|---|
| Token-slot template instead of byte/hash protected-region comparison (plan §2.2) | The model never produces LaTeX at all, so there is no document to diff against; exactly-once substitution + leftover rejection gives a stronger guarantee with less machinery |
| Structured fields instead of full-file LLM output | Smaller/cheaper responses, no injection surface, deterministic rendering |
| Single shared repair budget | Caps cost and attack surface; repair can't ping-pong |
| Server-assembled import templates | Compiling user LaTeX safely would require full sandbox hardening; clamped style hints capture most visual identity at ~zero risk |
| Mock provider excluded from compile-repair | Its output is deterministic; a repair round-trip is pure waste |
| No database | Single-container target (HF Space); filesystem profiles suffice at this scale |
| Web-only (no CLI from plan Phase 1) | The API + SPA subsumed the CLI's purpose; folded into Phase 2 |
