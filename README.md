---
title: JD Resume Builder
sdk: docker
app_port: 7860
---

# JD Resume Builder

A FastAPI application that tailors resumes to job descriptions. The language
model returns structured text changes; the server validates them, renders them
into a locked LaTeX template, and compiles a PDF with Tectonic.

With `MONGODB_URI` set the app runs in **multi-user mode**: email+password
accounts, per-user resume libraries (LaTeX paste or PDF upload, with versions),
saved job descriptions, tailor history, and per-user encrypted provider API
keys. Without it the app boots in **demo mode**: no accounts, seed-resume
tailoring only.

The repository currently contains Rahul Kumar's personal seed resume data,
including contact information. Keep the Git repository private, and keep demo
deployments private (the seed resume is exposed to anyone with access).

## Safety model

- During **tailoring**, the model receives editable resume facts, not the
  contact header or arbitrary LaTeX.
- The seven template tokens are replaced deterministically by the server.
- Unknown IDs, newly invented skills, excessive text, and invalid model output
  are rejected.
- Every compile runs in a unique temporary directory with Tectonic's untrusted,
  cached-only mode and a timeout.
- The browser shows the proposed changes before the user accepts a result.

### Importing a resume (multi-user)

Authenticated users build a private resume library from a pasted LaTeX resume
(`POST /api/resumes`) or an uploaded PDF (`POST /api/resumes/pdf`, parsed with
poppler `pdftotext` and LLM extraction). Each resume is stored in MongoDB with
extracted facts, a server-controlled style-personalized template, the raw
source text, and a version history (re-import to evolve). Tailoring targets a
library entry with `resume_id`; in demo mode (no database) the seed resume is
used instead.

Two deliberate boundaries keep this safe:

- **Only the import request sends the whole resume — including contact details —
  to the model**, because the user is importing their own document. Tailoring
  keeps excluding identity, unchanged.
- **The compiled template is still entirely server-controlled.** Import extracts
  plain-text facts plus a few bounded style hints (paper size, font size,
  margins, an optional accent color, each whitelisted); it never compiles the
  user's raw LaTeX. The pasted source is stored verbatim for future exact-layout
  work but is not fed to the compiler.

Resume data is PII and lives only in MongoDB (never in the repo or the Docker
image). The legacy `data/` directory stays git-ignored and docker-ignored.

## Repository layout

```text
app/                  FastAPI application, validation, rendering, and compiler
app/importer.py       LaTeX-extraction normalization and template assembly
app/db.py             MongoDB (Motor) stores: users, sessions, keys, resumes, JDs, runs
app/security.py       Password hashing, sessions, Fernet key encryption, rate limiting
app/config.py         Env-driven AppConfig with clamped bounds
resume/data.json      Canonical seed resume facts and stable editable IDs
resume/template.tex   Locked Tectonic-compatible LaTeX template
resume/assets/        Approved local images/fonts, if the template needs them
static/               Browser UI
tests/                Validation, rendering, compiler, and API tests
Dockerfile            Hugging Face-compatible production image
docker-compose.yml    Local MongoDB for multi-user development
```

`resume/template.tex` contains each of these tokens exactly once:

```text
@@CONTACT@@
@@SUMMARY@@
@@EXPERIENCE@@
@@PROJECTS@@
@@EDUCATION@@
@@SKILLS@@
@@ACHIEVEMENTS@@
```

Do not rename, duplicate, or delete them without updating the renderer and its
tests.

## Local development

Use Python 3.9 or newer. Tectonic 0.16.9 and Poppler (`pdfinfo` and
`pdftotext`) must also be available on `PATH` for real PDF compilation.

On macOS with Homebrew:

```bash
brew install tectonic poppler
```

Create the environment and install the application:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
```

Configure Groq without writing the key into the repository:

```bash
export LLM_PROVIDER=groq
export LLM_MODEL=llama-3.3-70b-versatile
export GROQ_API_KEY='your-secret-key'
```

Start the application:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 7860 --reload
```

Open <http://127.0.0.1:7860>. Run the test suite with:

```bash
pytest -q
```

Tests that need the Tectonic executable may skip when it is unavailable. The
Docker build always renders the configured baseline and performs a real compile.

## Configuration

| Name | Required | Default | Purpose |
|---|---|---|---|
| `LLM_PROVIDER` | No | `mock` | `mock`, `groq`, `cerebras`, `gemini`, `openrouter`, `mistral`, `openai`, `anthropic`, or `custom` |
| `LLM_MODEL` | No | provider default | Exact provider model ID |
| `${PROVIDER}_API_KEY` | For real providers | — | Preferred provider-specific server credential, such as `GROQ_API_KEY` |
| `LLM_API_KEY` | For real providers without a provider key | — | Generic credential fallback |
| `${PROVIDER}_BASE_URL` | No | provider endpoint | Provider-specific compatible API endpoint override |
| `LLM_BASE_URL` | For `custom` | — | Generic compatible API endpoint override |
| `LLM_TIMEOUT_SECONDS` | No | `60` | LLM HTTP timeout, bounded from 5–180 seconds |
| `LLM_MAX_TOKENS` | No | `3000` | Maximum structured completion tokens, bounded from 256–8000 |
| `LLM_REASONING_EFFORT` | No | `low` for Gemini and Groq GPT-OSS | Provider reasoning budget: `none`, `minimal`, `low`, `medium`, or `high` |
| `LLM_JSON_MODE` | No | `true` | Request JSON-object response format; auto-retries once without it on an HTTP 400 |
| `LLM_HTTP_ATTEMPTS` | No | `3` | Provider HTTP retry attempts (timeouts/429/5xx), bounded 1–4 |
| `ALLOW_INSECURE_LLM_BASE_URL` | No | `false` | Permit non-HTTPS LLM base URLs (**weakens transport security**; leave off in production) |
| `OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME` | No | — / `JD Resume Builder` | OpenRouter attribution headers (`HTTP-Referer` / `X-Title`) |
| `TECTONIC_BIN` | No | `tectonic` | Compiler executable or absolute path |
| `TECTONIC_ONLY_CACHED` | No | `true` | Prevent support-file downloads during a request |
| `COMPILE_TIMEOUT_SECONDS` | No | `90` | Per-compile process timeout, bounded from 10–180 seconds |
| `COMPILE_CONCURRENCY` | No | `1` | Simultaneous compiler processes, bounded from 1–4 |
| `COMPILE_MEMORY_LIMIT_MB` | No | `2048` | Address-space cap (`RLIMIT_AS`) for the compile subprocess, bounded 256–8192; **Linux only** |
| `MAX_PDF_PAGES` | No | `1` | Page-count target/check threshold, bounded from 1–10 |
| `LLM_EXTRACT_MAX_TOKENS` | No | `6000` | Max tokens for resume extraction, bounded 1000–8000 |
| `RESUME_DATA_PATH` | No | `resume/data.json` | Canonical seed structured resume file |
| `RESUME_TEMPLATE_PATH` | No | `resume/template.tex` | Locked LaTeX template |
| `RESUME_ASSETS_DIR` | No | `resume/assets` | Approved local template assets |
| `TECTONIC_UNTRUSTED_MODE` | No | `1` in Docker | Disables trusted-only Tectonic features |
| `TECTONIC_CACHE_DIR` | No | Tectonic default locally | Support-file cache; pre-warmed in Docker |
| `MONGODB_URI` | For multi-user mode | — | MongoDB connection string; unset → demo mode (seed tailoring only) |
| `MONGODB_DB` | No | `jd_resume_builder` | Database name |
| `APP_SECRET_KEY` | Recommended | random ephemeral | Derives the Fernet key encrypting user API keys at rest; unset → keys unreadable after restart (`checks.secret_key: "ephemeral"`) |
| `SESSION_TTL_DAYS` | No | `30` | Session lifetime, bounded 1–90 days |
| `COOKIE_SECURE` | No | `auto` | `auto` (Secure when https / `X-Forwarded-Proto: https`), `true`, or `false` |
| `ALLOW_REGISTRATION` | No | `true` | Allow new account registration |
| `ALLOW_ENV_KEY_FALLBACK` | No | `false` | Let users without a stored key use the operator's env provider keys |
| `RATE_LIMIT_LLM_CALLS` / `RATE_LIMIT_LLM_WINDOW_SECONDS` | No | `10` / `300` | LLM-cost bucket (tailor, imports, recompile); bounded 1–1000 / 10–3600 |
| `RATE_LIMIT_GENERAL_CALLS` / `RATE_LIMIT_GENERAL_WINDOW_SECONDS` | No | `120` / `60` | General authed-API bucket; bounded 10–10000 / 1–3600 |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_SECONDS` | No | `10` / `900` | Failed-login throttle per email+IP; bounded 1–100 / 10–3600 |
| `MAX_RESUMES_PER_USER` | No | `10` | Bounded 1–100 |
| `MAX_VERSIONS_PER_RESUME` | No | `20` | Bounded 1–100 |
| `MAX_VERSIONS_PER_JD` | No | `20` | Archived JD revisions kept per JD, bounded 1–100; oldest pruned |
| `MAX_JDS_PER_USER` | No | `50` | Bounded 1–500 |
| `MAX_RUNS_PER_USER` | No | `200` | Bounded 10–2000; oldest runs pruned |
| `MAX_PDF_UPLOAD_BYTES` | No | `10000000` | PDF upload cap, bounded 1–20 MB |
| `PDFTOTEXT_BIN` | No | `pdftotext` | poppler binary for PDF text extraction |
| `PDF_EXTRACT_TIMEOUT_SECONDS` | No | `30` | Extraction subprocess timeout, bounded 10–120 |

See `.env.example` for a commented template, and `docker-compose.yml` for a
local MongoDB (`docker compose up -d mongo`, then
`MONGODB_URI=mongodb://localhost:27017`).

Only put API credentials in local environment variables or your hosting
provider's secret store. Never add them to `resume/data.json`, frontend code,
Docker build arguments, or Git.

Provider adapters use separate secrets such as `GROQ_API_KEY`,
`CEREBRAS_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`,
`OPENAI_API_KEY`, and `ANTHROPIC_API_KEY`. These env keys serve demo mode and
(only when `ALLOW_ENV_KEY_FALLBACK=true`) multi-user requests; in multi-user
mode users normally add their own keys in Settings, stored Fernet-encrypted
and never echoed back. Use `LLM_PROVIDER=mock` for deterministic local UI and
API testing without an external request; its output is not a genuinely
tailored resume.

## Customize the resume

1. Update only verified facts in `resume/data.json`; it is the authoritative
   source used for every tailored resume.
2. Keep every object and bullet `id` stable. The model refers to those IDs when
   proposing edits.
3. Keep contact information under `identity`; the backend excludes it from the
   LLM request and restores it during deterministic rendering.
4. Add only approved local files to `resume/assets/`.
5. If you add a LaTeX package or asset, rebuild the image so Tectonic downloads
   it during cache pre-warming.
6. Compile and visually compare the original before using tailored output.

Keep only claims you can support in an interview, and review the generated diff
before using any tailored PDF.

## Docker

The image pins the official Tectonic 0.16.9 x86-64 archive and verifies SHA-256
`f3c825128095dc3399ea11c08c18035b33050a216930c295c79e8eb11bd21de4`.
It runs as UID 1000, which matches Hugging Face Docker Spaces.

Build for the intended x86-64 target (also required on Apple Silicon):

```bash
docker build --platform linux/amd64 -t jd-resume-builder .
```

Run it using the already-exported `GROQ_API_KEY`:

```bash
docker run --rm --platform linux/amd64 \
  -p 7860:7860 \
  -e LLM_PROVIDER=groq \
  -e LLM_MODEL=llama-3.3-70b-versatile \
  -e GROQ_API_KEY \
  jd-resume-builder
```

The build needs network access once to populate Tectonic's package and font
cache from a fully rendered baseline resume. Runtime resume compilation uses
`--only-cached`, so changing packages, fonts, or formatting commands requires a
new image build.

## Deploy to a private Hugging Face Space

1. Create a new **private** Space and select **Docker** as the SDK and **CPU
   Basic** as the hardware.
2. Push this repository to the Space's Git remote. The YAML header at the top of
   this README configures port 7860.
3. In **Settings → Variables and secrets**, add variables:

   ```text
   LLM_PROVIDER=groq
   LLM_MODEL=llama-3.3-70b-versatile
   ```

4. Add `GROQ_API_KEY` as a **secret**, never as a public variable.
5. Wait for the Docker build, verify `/api/health`, then test one complete
   tailoring flow, PDF page count, and extracted text.

Keep the Space private unless application-level authentication and rate limits
are added. A public app could expose personal resume data or allow other users
to consume the API quota. Space disk is ephemeral, so generated PDFs are not a
durable history.

## Updating Tectonic

When upgrading, change both `TECTONIC_URL` and `TECTONIC_SHA256` in the
Dockerfile using the matching official release asset. Then rebuild and run the
full compile and PDF-text tests. The current image deliberately rejects an ARM
build because its pinned executable is x86-64.
# RoleTeX
