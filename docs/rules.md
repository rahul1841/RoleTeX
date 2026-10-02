# Rules — RoleTeX

> Invariants and conventions. Changing an **R-x** rule needs a decision recorded in [memory.md](memory.md) first.
> Rule IDs are cited from code comments — never renumber them.

## 1. Security invariants

- **R-1 · No PII to the LLM during tailoring.** `build_llm_resume_payload` excludes `identity` (name, email, phone, location, links); it is restored only at render time. Compiler logs pass through `redact_identity` before any repair prompt.
- **R-2 · The import exception stays scoped to import.** Resume import (`POST /api/resumes`, `/api/resumes/pdf` and their `/versions` variants) sends the user's whole document, contact details included, to the LLM. This must never reach the tailor path, and must stay documented in the README and prd.md.
- **R-3 · The LLM never emits LaTeX.** It returns plain text in a strict JSON schema; only the server writes LaTeX, and every model string goes through `escape_latex`.
- **R-4 · The template is locked.** Every template (seed and server-assembled) contains each of the 7 tokens exactly once — `@@CONTACT@@ @@SUMMARY@@ @@EXPERIENCE@@ @@PROJECTS@@ @@EDUCATION@@ @@SKILLS@@ @@ACHIEVEMENTS@@` — plus the optional `@@CUSTOM@@`. `validate_template` enforces it; rendering substitutes each once and rejects leftovers.
- **R-5 · User LaTeX is never compiled.** Imported source is stored verbatim as `source_text`; the compiler only receives server-assembled templates. Only clamped style values (font size, margin, accent) vary per resume.
- **R-6 · Compilation is always sandboxed.** Fresh temp dir per compile, `tectonic -X compile --untrusted`, `--only-cached` by default, argument-list invocation (never `shell=True`), timeout, POSIX resource limits, bounded concurrency. No exceptions.
- **R-7 · The JD is data, never instructions.** Prompts frame it as reference data; the strict schema (`extra="forbid"`) and server-side validation are the enforcement. Never relax `StrictModel`.
- **R-8 · No fabrication passes validation.** `validate_proposal` must keep rejecting unknown/duplicate bullet IDs, any `skills_order` that isn't an exact permutation of existing skills, new numeric claims, and over-limit text. Extend, never weaken.
- **R-9 · Secrets stay server-side.** Only in env or the host's secret store — never in code, `backend/resume/data.json`, frontend JS, Docker build args or Git. Users' own provider keys are Fernet-encrypted at rest and never returned (masked hint only).
- **R-10 · Resume data is PII.** It lives only in MongoDB. Never log it, and never echo submitted values in errors — describe the field, not its content.
- **R-11 · One LLM repair per request.** The shared budget (semantic OR compile OR page-shortening) is enforced in `backend/app/main.py`. Don't add a second repair path.

## 2. Product contracts

- **R-12 · Stable IDs are forever.** Seed IDs and backend-assigned import IDs are the contract between validation, rendering and the model. Never regenerate or reorder them for existing data.
- **R-13 · Tailoring needs an owned resume.** `POST /api/tailor` requires a `resume_id` the caller owns; the server has no fallback resume and never serves the seed.
- **R-14 · The user reviews before using.** The API returns the change list and unified diff with the PDF; the UI always shows the changes alongside the document. Never auto-apply.
- **R-15 · Bounded style hints only.** Paper is always A4; font size from a whitelist (10/11/12pt); margin clamped to 1.0–3.0 cm (schema outer bound 0.5–4.0); optional 6-hex accent. A new style hint needs its own whitelist or clamp.

## 3. Coding conventions

- **C-1 · Python 3.9 compatible.** The venv and Docker image run 3.12, so this is enforced by review: no `X | Y` unions, no `match`, no 3.10+ stdlib in `backend/app/`.
- **C-2 · Version-agnostic Pydantic calls.** Models are Pydantic v2 (`>=2.9`), but call `schemas.validate_model` / `schemas.dump_model`, not `model_validate` / `model_dump`.
- **C-3 · Dependency injection via `create_app`.** New services get factory parameters with production defaults so they can be replaced offline. No module-level singletons.
- **C-4 · Structured errors.** Failures go through `_api_error` → `{code, message, ...details}`. No bare `HTTPException(detail="...")`.
- **C-5 · Bounded env config.** Every numeric env var is clamped to a documented range and gets a README row.
- **C-6 · Match existing style.** Type hints, short docstrings that state the security reason where there is one, small private helpers prefixed `_`.

## 4. Verification

There is no automated test suite.

- **T-1 · Verify offline.** `LLM_PROVIDER=stub` with an `httpx.ASGITransport` client against `create_app()` drives the real routes and middleware with no network or provider key. Keep every boundary injectable.
- **T-2 · Check security code before it ships.** Validation, escaping, redaction, token and code handling, and the compiler sandbox each get an explicit check — a driven request or a rendered document read back — not just a diff read.
- **T-3 · Use the project venv.** Run the API with `./backend/dev.sh`, or `PYTHONPATH=backend .venv/bin/python …`. Build the venv from Homebrew Python 3.12, never macOS's `/usr/bin/python3`: its LibreSSL breaks concurrent Atlas TLS handshakes (intermittent `BAD_PSK_IDENTITY` → 503s).
- **T-4 · The Docker build verifies LaTeX.** Its prewarm compiles the seed resume and every offered font size with real Tectonic, so a broken template or uncached package fails the build.

## 5. Change management

- **M-1 · Template or package changes need a Docker rebuild** — runtime is `--only-cached`, so the prewarm must cover every package and font.
- **M-2 · Tectonic upgrades change both** `TECTONIC_URL` and `TECTONIC_SHA256` in the Dockerfile, from the matching official release.
- **M-3 · Keep deployments private for now.** The repository's seed resume holds the owner's contact details, and a real deployment hasn't been verified end to end.
- **M-4 · Never commit** API keys, `.env*` (except `.env.example`), or generated PDFs.
- **M-5 · Keep [memory.md](memory.md) current** — significant decisions and open gaps.
