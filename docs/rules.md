# Rules — JD Resume Builder ("RoleTeX")

> Non-negotiable invariants and working conventions for this codebase.
> Any change that would violate a **R-x** rule needs an explicit, documented decision in [memory.md](memory.md) first.
> Companion docs: [prd.md](prd.md) · [architecture.md](architecture.md) · [design.md](design.md)

---

## 1. Security invariants (MUST hold at all times)

- **R-1 · PII never reaches the LLM during tailoring.** `build_llm_resume_payload` excludes `identity` (name, email, phone, location, links). Identity is restored only during local rendering. Compiler diagnostics MUST pass through `redact_identity` before being included in any repair prompt.
- **R-2 · The import exception is scoped to import only.** The resume import routes (`POST /api/resumes`, `POST /api/resumes/pdf`, and their `/versions` variants) deliberately send the user's full document (their own resume, including contact details) to the LLM for extraction. This exception MUST NOT leak into the tailor path, and MUST stay documented in the README and prd.md.
- **R-3 · The LLM never emits LaTeX.** Model output is plain text in a strict JSON schema. The server — and only the server — produces LaTeX. Every model-provided string is passed through `escape_latex` before rendering.
- **R-4 · The template is locked.** `backend/resume/template.tex` (and every server-assembled profile template) contains each of the 7 tokens exactly once: `@@CONTACT@@ @@SUMMARY@@ @@EXPERIENCE@@ @@PROJECTS@@ @@EDUCATION@@ @@SKILLS@@ @@ACHIEVEMENTS@@`. `validate_template` enforces this; rendering substitutes each token exactly once and rejects leftovers. Do not rename, duplicate, or delete tokens without updating the renderer and its tests.
- **R-5 · Raw user LaTeX is never compiled.** Imported source is stored verbatim as `source.tex` for future work but the compiler only ever receives server-assembled templates. Only clamped style values (paper, font size, margin, accent) may vary per profile.
- **R-6 · Compilation is always sandboxed.** Unique `tempfile.TemporaryDirectory` per compile, `tectonic -X compile --untrusted`, `--only-cached` by default, argument-list invocation (never `shell=True`), bounded timeout, POSIX resource limits, bounded semaphore. No exceptions, including "quick local tests" in app code.
- **R-7 · The JD is untrusted data, never instructions.** Prompts must frame it as reference data; the response schema (`extra="forbid"`) and server-side validation are the actual enforcement. Never relax `StrictModel`.
- **R-8 · No fabrication passes validation.** `validate_proposal` MUST keep rejecting: unknown/duplicate bullet IDs, any `skills_order` that is not an exact multiset permutation of existing skills, new numeric claims not present in the factual source, and over-limit text. Extending these checks is welcome; weakening them is not.
- **R-9 · Secrets live only in env/hosting secret stores.** Never in code, `backend/resume/data.json`, frontend JS, Docker build args, or Git. Provider keys are server-side only.
- **R-10 · `data/` holds PII and never ships.** It stays git-ignored (only `.gitkeep`) and docker-ignored. Never log profile contents; never include them in error responses.
- **R-11 · One LLM repair per request, total.** The single shared repair budget (semantic OR compile OR page-shortening) is an orchestration invariant in `backend/app/main.py`. A second repair path must not be added casually — it doubles token cost and widens the attack surface.

## 2. Product/behavior contracts

- **R-12 · Stable IDs are forever.** IDs in `backend/resume/data.json` (and backend-assigned import IDs) are the contract between validation, rendering, and the model. Never regenerate or reorder them for existing data.
- **R-13 · Back-compat for the seed flow.** `POST /api/tailor` without `resume_id` MUST keep working against the seed resume.
- **R-14 · The user reviews before using.** The API always returns the change list + unified diff alongside the PDF; the UI must keep showing changes with the preview. Never silently auto-apply.
- **R-15 · Bounded style hints only.** Import style extraction is limited to: whitelisted paper size, whitelisted font size, margin clamped to 1.0–3.0 cm by the importer (the `ResumeStyle` schema's outer bound is 0.5–4.0), optional 6-hex accent color. Adding a new style hint requires a whitelist/clamp and tests.

## 3. Coding conventions

- **C-1 · Python 3.9 compatible.** The dev venv is Python 3.9 while the Docker image is newer. No `X | Y` unions, no `match`, no 3.10+ stdlib features in `app/`.
- **C-2 · Version-agnostic Pydantic call sites.** The models themselves are Pydantic v2 (`ConfigDict`, `>=2.9` pinned); still use `schemas.validate_model` / `schemas.dump_model` instead of calling `model_validate`/`model_dump` directly so call sites stay version-agnostic.
- **C-3 · Dependency injection via `create_app`.** New services get constructor/factory parameters with production defaults, so tests can inject doubles. Don't reach for module-level singletons.
- **C-4 · Structured errors.** API failures go through `_api_error` → `{code, message, ...details}`. No bare `HTTPException(detail="string")` in new endpoints.
- **C-5 · Env config is bounded.** Every numeric env knob is clamped to a documented range (see README table). New knobs follow the same pattern and get a README row.
- **C-6 · Match existing style.** Type hints, module docstrings explaining the security rationale, small pure helpers prefixed `_`.

## 4. Verification rules

> `tests/` was deleted on 2026-09-10 during an architecture rework (recoverable
> from git at `0565cf6` or earlier). Until a suite exists again, these are the
> rules that replace the old T-1..T-4.

- **T-1 · Verification stays offline and fast.** No network and no real LLM call is needed to exercise the API: `LLM_PROVIDER=stub` plus an `httpx.ASGITransport` client against `create_app()` drives the real routes through the real middleware stack. Keep every boundary injectable (`create_app` already takes the filesystem, LLM, compiler, database, PDF tooling, and mailer) so that stays true.
- **T-2 · Security invariants are verified before they ship.** Validation, escaping, redaction, token handling, and the compiler sandbox are the code this project exists to get right. A change to any of them gets an explicit check — a driven request, a rendered document read back — recorded in [memory.md](memory.md), not just a reading of the diff.
- **T-3 · Use the project venv:** `PYTHONPATH=backend .venv/bin/python …` (Python 3.9.6). The `PYTHONPATH` is what makes `app.main` importable now that the service lives in `backend/`.
- **T-4 · The LaTeX pipeline is verified by the Docker build.** Its prewarm renders the seed resume and every offered font size and compiles each with real Tectonic, so a broken template or an uncached package fails the build rather than the first request.

## 5. Change management

- **M-1 · Template/package changes require a Docker rebuild** — runtime uses `--only-cached`, so the image pre-warm must cover every package/font the template needs.
- **M-2 · Tectonic upgrades update both** `TECTONIC_URL` and `TECTONIC_SHA256` in the Dockerfile, from the matching official release asset, followed by real compile + PDF-text verification.
- **M-3 · Deployments stay private** until authentication and rate limiting exist. A public endpoint exposes resume PII and the LLM quota.
- **M-4 · Never commit:** API keys, `.env*`, generated PDFs, or anything under `data/`.
- **M-5 · Significant decisions and gap changes get logged in [memory.md](memory.md)** (decision log / gap register), so the next session starts from truth.
