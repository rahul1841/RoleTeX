---
title: RoleTeX
sdk: docker
app_port: 7860
---

# RoleTeX

*AI + LaTeX.* Tailor a resume to any job description: an LLM proposes plain-text edits, the server validates them, renders them into a locked LaTeX template, and compiles the PDF with Tectonic. You review every change before downloading.

Accounts, private resume and job-description libraries with versions, tailoring history, and per-user encrypted provider keys, all stored in MongoDB. The server won't start without `MONGODB_URI`.

> `backend/resume/data.json` holds the owner's real contact details; only the Docker build's cache prewarm reads it. Keep the repository private.

Docs: [prd](docs/prd.md) · [architecture](docs/architecture.md) · [design](docs/design.md) · [rules](docs/rules.md) · [memory](docs/memory.md)

## Safety model

- Tailoring sends only editable facts to the model — never contact details.
- The model returns plain text; the server writes all LaTeX and fills each template token exactly once.
- Unknown IDs, invented skills, new numbers and over-long text are rejected.
- Every compile runs in its own temp directory with Tectonic's untrusted, cached-only mode and a timeout.
- The UI shows every proposed change beside the PDF.
- **Import is the one exception:** importing a resume (LaTeX paste or PDF) sends the whole document, contact details included, to the model, because you're importing your own document. Imports are re-rendered into a server-controlled template; your original LaTeX is stored but never compiled.

## Accounts

- **Sign-up** needs a 6-digit code emailed to the address (valid 10 minutes, 5 tries). Nothing is created until the code checks out, so every account starts verified. Without `SMTP_HOST`, codes and links are printed in the server log instead.
- **Passwords:** 8–128 characters with a lowercase letter, an uppercase letter, a number and a symbol; not a common password; not containing your email name. Checked when a password is set, never at sign-in.
- Password change and reset and email verification are built in.
- **Disabling an account:** set `disabled: true` on the user document in MongoDB. The next request from that account is refused and its session removed.

## Repository layout

```text
backend/            FastAPI service (see docs/architecture.md for modules)
  app/              application code
  resume/           data.json + template.tex (Docker prewarm only), assets/
  dev.sh            local dev server
frontend/           Next.js app (App Router, TypeScript, Tailwind, shadcn/ui)
  app/              routes: / landing, (app) signed-in screens, (auth) sign-in pages
  components/       feature UI; common/ shared pieces; ui/ shadcn parts
  lib/api/          the only code that calls the API; schema.d.ts is generated
docs/               prd, architecture, design, rules, memory
Dockerfile          production image
docker-compose.yml  local MongoDB
```

## Local development

**Prerequisites:** Python 3.9+ linked against OpenSSL (use Homebrew's on macOS), Tectonic, Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`, `pdftohtml`), and Node 20.9+.

> **macOS:** don't build the venv on `/usr/bin/python3`. It links LibreSSL, whose broken TLS session reuse causes intermittent `503 database_unavailable` against MongoDB Atlas.

```bash
brew install tectonic poppler
/opt/homebrew/opt/python@3.12/bin/python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -c 'import ssl; print(ssl.OPENSSL_VERSION)'   # must print OpenSSL

cp .env.example .env    # fill in what you need
./backend/dev.sh        # API on http://127.0.0.1:8000, auto-reload
```

`dev.sh` runs from the repo root, loads `.env` if present, and passes extra arguments to uvicorn (e.g. `./backend/dev.sh --port 9000`).

**Frontend:**

```bash
cd frontend
npm install
npm run dev             # open http://localhost:3000
```

Always use port 3000, not 8000. `next dev` proxies `/api/*` to the API, so the browser sees one origin — which the HttpOnly session cookie and the CSRF origin check both require. Point it elsewhere with `API_PROXY_ORIGIN=http://127.0.0.1:9000 npm run dev`.

Other frontend commands: `npm run typecheck`, `npm run lint`, `npm run build` (static export to `frontend/out`), and `npm run gen:api` (regenerate `lib/api/schema.d.ts` from the running API — never edit it by hand).

### Offline and local-database runs

Variables set in the shell override `.env`, so these work even when `.env` points at real services:

```bash
docker compose up -d mongo                            # local MongoDB
MONGODB_URI=mongodb://localhost:27017 LLM_PROVIDER=stub ./backend/dev.sh
```

`LLM_PROVIDER=stub` swaps in a deterministic offline client (output prefixed `[stub]`). You still pick a provider and save a key in Settings; the stub simply never uses it.

### Verifying a change

There is no automated test suite (see [rules.md §4](docs/rules.md)). For the frontend, run `npm run typecheck`, `npm run lint` and `npm run build`. For the API, run it with the stub and call it (`curl -s localhost:8000/api/health`). The Docker build is what proves the LaTeX pipeline.

## Configuration

Set these in `.env` locally or in your host's secret store — never in code or Git. Numeric values are clamped to the ranges shown. `.env.example` lists the common ones.

**Database, secrets, accounts**

| Name | Default | Notes |
|---|---|---|
| `MONGODB_URI` | — | Required; the server refuses to start without it |
| `MONGODB_DB` | `jd_resume_builder` | |
| `APP_SECRET_KEY` | random per boot | Set a long random value: it encrypts stored provider keys and keys the sign-up-code hashes. If unset, stored keys become unreadable after a restart |
| `SESSION_TTL_DAYS` | `30` | 1–90 |
| `COOKIE_SECURE` | `auto` | `auto` (Secure over HTTPS or `X-Forwarded-Proto: https`), `true`, `false` |
| `ALLOW_REGISTRATION` | `true` | |
| `ALLOW_ENV_KEY_FALLBACK` | `false` | Let users without their own key use the operator's env keys |
| `REQUIRE_EMAIL_VERIFICATION` | `false` | Block feature routes until the address is verified |
| `TRUST_PROXY_HEADERS` | `false` | Key rate limits on `X-Forwarded-For`; enable only behind a proxy that overwrites it |
| `TRUSTED_PROXY_HOPS` | `1` | Number of proxies in front; 1–10 |

**Email** (sign-up codes, password reset, verification)

| Name | Default | Notes |
|---|---|---|
| `SMTP_HOST` | — | Unset → messages are written to the server log |
| `SMTP_PORT` | `587` | STARTTLS; port 465 (implicit SSL) isn't supported |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | — | Gmail needs a 16-character App Password |
| `SMTP_STARTTLS` | `true` | |
| `SMTP_TIMEOUT_SECONDS` | `15` | 5–120 |
| `MAIL_FROM` | `roletex@localhost` | e.g. `RoleTeX <you@gmail.com>` |
| `PUBLIC_BASE_URL` | — | Required once `SMTP_HOST` is set: emailed links are built from it, not from the request's `Host` header |
| `PASSWORD_RESET_TTL_MINUTES` | `60` | 5–1440 |
| `EMAIL_VERIFY_TTL_HOURS` | `48` | 1–168 |

**LLM**

| Name | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | — | `groq`, `cerebras`, `gemini`, `openrouter`, `mistral`, `openai`, `anthropic`, `grid`, `custom` — or `stub` for the offline client. Otherwise only `/api/health` reads it; each run uses the provider the user picks |
| `LLM_MODEL` | provider default | |
| `${PROVIDER}_API_KEY` | — | e.g. `GROQ_API_KEY`; `LLM_API_KEY` is the generic fallback. Used for runs only with `ALLOW_ENV_KEY_FALLBACK` |
| `${PROVIDER}_MODEL` | — | Beats `LLM_MODEL`; required for `grid` |
| `${PROVIDER}_BASE_URL` | provider endpoint | `LLM_BASE_URL` for `custom` |
| `${PROVIDER}_VISION` | registry flag | Whether the provider can read page images |
| `LLM_TIMEOUT_SECONDS` | `60` | 5–180 |
| `LLM_MAX_TOKENS` | `3000` | 256–8000 |
| `LLM_EXTRACT_MAX_TOKENS` | `6000` | Import extraction; 1000–8000 |
| `LLM_REASONING_EFFORT` | `low` for Gemini, Groq GPT-OSS | `none`, `minimal`, `low`, `medium`, `high` |
| `LLM_JSON_MODE` | `true` | Retried once without it on HTTP 400 |
| `LLM_HTTP_ATTEMPTS` | `3` | 1–4 |
| `ALLOW_INSECURE_LLM_BASE_URL` | `false` | Allow non-HTTPS endpoints (weakens security) |
| `OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME` | — / `JD Resume Builder` | OpenRouter attribution headers |

**Compiler, PDF import, paths**

| Name | Default | Notes |
|---|---|---|
| `TECTONIC_BIN` | `tectonic` | |
| `TECTONIC_ONLY_CACHED` | `true` | No package downloads at request time |
| `COMPILE_TIMEOUT_SECONDS` | `90` | 10–180 |
| `COMPILE_CONCURRENCY` | `1` | 1–4 |
| `COMPILE_MEMORY_LIMIT_MB` | `2048` | 256–8192; Linux only |
| `MAX_PDF_PAGES` | `1` | Page target used for warnings; 1–10 |
| `MAX_PDF_UPLOAD_BYTES` | `5000000` | 1–20 MB |
| `MAX_IMPORT_PDF_PAGES` | `3` | 1–20 |
| `PDF_EXTRACT_TIMEOUT_SECONDS` | `30` | 10–120 |
| `PDFTOTEXT_BIN`, `PDFINFO_BIN`, `PDFTOPPM_BIN`, `PDFTOHTML_BIN` | tool name | Poppler binaries |
| `RESUME_ASSETS_DIR` | `backend/resume/assets` | Approved files copied into every compile |
| `FRONTEND_DIR` | `frontend/out` | Where the static frontend is served from |
| `TECTONIC_UNTRUSTED_MODE`, `TECTONIC_CACHE_DIR` | set in the image | Tectonic's own settings |

**Rate limits and quotas**

| Name | Default | Notes |
|---|---|---|
| `RATE_LIMIT_LLM_CALLS` / `RATE_LIMIT_LLM_WINDOW_SECONDS` | `10` / `300` | Per user: tailor, import, preview, recompile; 1–1000 / 10–3600 |
| `RATE_LIMIT_LLM_IP_CALLS` | `30` | Per-IP ceiling on the same routes; 1–5000 |
| `RATE_LIMIT_GENERAL_CALLS` / `RATE_LIMIT_GENERAL_WINDOW_SECONDS` | `120` / `60` | Everything else; 10–10000 / 1–3600 |
| `RATE_LIMIT_EMAIL_CALLS` / `RATE_LIMIT_EMAIL_WINDOW_SECONDS` | `5` / `900` | Per IP and per address; 1–100 / 60–86400 |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_SECONDS` | `10` / `900` | Failed logins per email + IP; 1–100 / 10–3600 |
| `MAX_RESUMES_PER_USER` | `10` | 1–100 |
| `MAX_VERSIONS_PER_RESUME` | `20` | 1–100 |
| `MAX_JDS_PER_USER` | `50` | 1–500 |
| `MAX_VERSIONS_PER_JD` | `20` | 1–100; oldest pruned |
| `MAX_RUNS_PER_USER` | `200` | 10–2000; oldest pruned |

## Docker

```bash
docker build --platform linux/amd64 -t roletex .     # x86-64 only, also on Apple Silicon
docker run --rm --platform linux/amd64 -p 7860:7860 \
  -e MONGODB_URI -e APP_SECRET_KEY roletex
```

The image pins Tectonic 0.16.9 (SHA-256 verified) and runs as UID 1000. The build needs network access once, to prewarm Tectonic's cache by compiling the seed resume plus one document per font size. At runtime compiles are `--only-cached`, so package, font or formatting changes need a rebuild.

### The frontend is not in the image yet

The Dockerfile has no Node stage, so the image serves the API only and answers `/` with a "no UI installed" page. To add it, use a `node` stage that runs `npm ci && npm run build` in `frontend/`, then `COPY --from` the `frontend/out` folder. Place both **after** the Tectonic prewarm layers so frontend edits don't rerun the prewarm. `node_modules`, `.next` and `out` are in `.dockerignore`, so that stage must install its own dependencies.

## Deploy to a private Hugging Face Space

1. Create a **private** Docker Space on CPU Basic and push this repository. The front matter at the top of this README sets port 7860.
2. In **Settings → Variables and secrets**:
   - Add secrets `MONGODB_URI`, `APP_SECRET_KEY` and `SMTP_PASSWORD`, and variables `SMTP_HOST`, `SMTP_USERNAME`, `MAIL_FROM` and `PUBLIC_BASE_URL` (the Space's URL). Sign-up needs working email, so without SMTP nobody can register.
3. Wait for the build, check `/api/health`, then run one full tailoring flow.

Keep the Space private (see [rules.md M-3](docs/rules.md)). Space disk is ephemeral; everything durable lives in MongoDB.

## Updating Tectonic

Change both `TECTONIC_URL` and `TECTONIC_SHA256` in the Dockerfile to the matching official release, then rebuild — the prewarm compiles every font size, so an incompatible release fails the build rather than a request. ARM builds are refused because the pinned binary is x86-64.
