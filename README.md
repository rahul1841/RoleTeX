---
title: JD Resume Builder
sdk: docker
app_port: 7860
---

# JD Resume Builder

A private, single-user FastAPI application that tailors an approved resume to a
job description. The language model returns structured text changes; the server
validates them, renders them into a locked LaTeX template, and compiles a PDF
with Tectonic.

The repository currently contains Rahul Kumar's personal resume data, including
contact information. Keep both the Git repository and deployed Space private.

## Safety model

- The model receives editable resume facts, not the contact header or arbitrary
  LaTeX.
- The seven template tokens are replaced deterministically by the server.
- Unknown IDs, newly invented skills, excessive text, and invalid model output
  are rejected.
- Every compile runs in a unique temporary directory with Tectonic's untrusted,
  cached-only mode and a timeout.
- The browser shows the proposed changes before the user accepts a result.

This MVP intentionally does not accept uploaded LaTeX projects. Supporting
untrusted templates requires stronger operating-system or virtual-machine
isolation.

## Repository layout

```text
app/                  FastAPI application, validation, rendering, and compiler
resume/data.json      Canonical resume facts and stable editable IDs
resume/template.tex   Locked Tectonic-compatible LaTeX template
resume/assets/        Approved local images/fonts, if the template needs them
static/               Browser UI
tests/                Validation, rendering, compiler, and API tests
Dockerfile            Hugging Face-compatible production image
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
| `LLM_PROVIDER` | No | `mock` | `mock`, `groq`, `cerebras`, `gemini`, `openrouter`, `mistral`, `openai`, or `custom` |
| `LLM_MODEL` | No | provider default | Exact provider model ID |
| `${PROVIDER}_API_KEY` | For real providers | — | Preferred provider-specific server credential, such as `GROQ_API_KEY` |
| `LLM_API_KEY` | For real providers without a provider key | — | Generic credential fallback |
| `${PROVIDER}_BASE_URL` | No | provider endpoint | Provider-specific compatible API endpoint override |
| `LLM_BASE_URL` | For `custom` | — | Generic compatible API endpoint override |
| `LLM_TIMEOUT_SECONDS` | No | `60` | LLM HTTP timeout, bounded from 5–180 seconds |
| `LLM_MAX_TOKENS` | No | `3000` | Maximum structured completion tokens, bounded from 256–8000 |
| `LLM_REASONING_EFFORT` | No | `low` for Gemini and Groq GPT-OSS | Provider reasoning budget: `none`, `minimal`, `low`, `medium`, or `high` |
| `TECTONIC_BIN` | No | `tectonic` | Compiler executable or absolute path |
| `TECTONIC_ONLY_CACHED` | No | `true` | Prevent support-file downloads during a request |
| `COMPILE_TIMEOUT_SECONDS` | No | `90` | Per-compile process timeout, bounded from 10–180 seconds |
| `COMPILE_CONCURRENCY` | No | `1` | Simultaneous compiler processes, bounded from 1–4 |
| `MAX_PDF_PAGES` | No | `1` | Page-count target/check threshold, bounded from 1–10 |
| `RESUME_DATA_PATH` | No | `resume/data.json` | Canonical structured resume file |
| `RESUME_TEMPLATE_PATH` | No | `resume/template.tex` | Locked LaTeX template |
| `RESUME_ASSETS_DIR` | No | `resume/assets` | Approved local template assets |
| `TECTONIC_UNTRUSTED_MODE` | No | `1` in Docker | Disables trusted-only Tectonic features |
| `TECTONIC_CACHE_DIR` | No | Tectonic default locally | Support-file cache; pre-warmed in Docker |

Only put API credentials in local environment variables or your hosting
provider's secret store. Never add them to `resume/data.json`, frontend code,
Docker build arguments, or Git.

Provider adapters use separate secrets such as `GROQ_API_KEY`,
`CEREBRAS_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`,
and `OPENAI_API_KEY`. Use `LLM_PROVIDER=mock` for deterministic local UI and API
testing without an external request; its output is not a genuinely tailored
resume.

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
