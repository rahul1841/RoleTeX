---
title: RoleTeX
sdk: docker
app_port: 7860
---

# RoleTeX

*AI + LaTeX.*

A FastAPI application that tailors resumes to job descriptions. The language
model returns structured text changes; the server validates them, renders them
into a locked LaTeX template, and compiles a PDF with Tectonic.

With `MONGODB_URI` set the app runs in **multi-user mode**: email+password
accounts, per-user resume libraries (write one in the app, or import a LaTeX
paste or PDF, all with versions), saved job descriptions, tailor history, and
per-user encrypted provider API keys. Without it the app boots in **demo mode**:
no accounts, seed-resume tailoring only.

A new account starts empty and stays that way until the user adds a resume.
Nothing user-facing is derived from the repository's seed resume: in multi-user
mode `/api/tailor` requires a resume the caller owns, and the seed is reachable
only in demo mode.

Account management covers the full lifecycle: password change, emailed password
reset, email verification (optionally enforced), a list of active sessions with
per-device and bulk revocation, and a `disabled` flag that ejects an account on
its next request. See [Account lifecycle](#account-lifecycle).

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

### Building a resume in the app (multi-user)

A signed-in user with no document to import can write a resume here: contact
details, a headline, roles with bullets, projects, education, skills, and
achievements, plus four bounded layout knobs (paper size, font size, margin,
accent colour). The server assembles the same locked template it uses for
imports and compiles the same one-page PDF.

| Flow | Route | Notes |
|---|---|---|
| Create | `POST /api/resumes/manual` | Structured draft in, stored resume out. **No LLM call and no provider key** — nothing is sent to a model |
| Edit | `PUT /api/resumes/{id}/content` | Saves edited facts as the resume's next version. Works on imported resumes too, which is how an extraction mistake gets fixed |
| Preview | `POST /api/resumes/preview` | Compiles a draft as typed (`resume`) or a stored resume (`resume_id`), with no job description; returns the PDF and the rendered `.tex` |

The safety contract is unchanged, because the draft is treated exactly like an
LLM extraction: `backend/app/builder.py` discards anything resembling an ID, assigns its
own positional stable IDs, clamps the style values, and renders through
`escape_latex` — so a bullet containing `\input{...}` is typeset as text, never
executed. What differs is the error shape: an incomplete draft comes back as
`422 incomplete_resume` with field-addressed messages ("Your phone number is
required."), which name the field and never echo the submitted value.

Two limits worth knowing while writing: the headline is one line (12 words /
120 characters, because tailoring rewrites it), and a resume needs a name,
email, phone, location and at least one non-empty section before it can be
saved.

### Importing a resume (multi-user)

Authenticated users build a private resume library from a pasted LaTeX resume
(`POST /api/resumes`) or an uploaded PDF (`POST /api/resumes/pdf`, parsed with
poppler `pdftotext` and LLM extraction). Each resume is stored in MongoDB with
extracted facts, a server-controlled style-personalized template, the raw
source text, and a version history (re-import to evolve). Tailoring targets a
library entry with `resume_id`; in demo mode (no database) the seed resume is
used instead.

Sections the fixed template does not name — Certifications, Publications,
Volunteering, Languages — are carried in `custom_sections`, each a heading plus
bullets, and render into a single optional `@@CUSTOM@@` slot. Their bullets get
stable IDs like any other, so tailoring can rewrite them under the same rules.
The slot is optional rather than required so templates stored before it existed
still validate; editing a resume regenerates the template with the slot present.

Uploads are bounded at `MAX_PDF_UPLOAD_BYTES` (5 MB) and `MAX_IMPORT_PDF_PAGES`
(3 pages). The page count is read with `pdfinfo` before any text is extracted,
so an oversized document is rejected (`422 pdf_too_many_pages`) rather than
billed as LLM input; the check fails open when `pdfinfo` is missing and
`/api/health` reports that.

Every uploaded PDF is also rasterized with `pdftoppm`, and when the resolved
provider can see images both are sent in one request (`source_kind="text_and_image"`):
the page images decide *what the document says*, and the text layer confirms the
exact spelling of emails, URLs, and figures. This matters because `pdftotext`
interleaves columns, repeats running headers, and silently drops text drawn
inside a graphic — the usual reason a field goes missing on import. Rendering
costs about 100 ms and roughly 2,000 image tokens per page. Against a text-only
provider the images are dropped and the import proceeds from text alone with a
warning.

Hyperlink targets are recovered separately with `pdftohtml -xml` and passed as a
third input. A PDF stores them as annotations, so a contact row of linked words
("Portfolio", "LinkedIn", "GitHub") shows only its labels in both the text layer
and a page image — without this the URLs are simply not in anything the model
receives.

A scanned PDF has no text layer at all, so `pdftotext` finds nothing. Rather
than failing, its pages go to the model as images only (`source_kind="image"`,
stored as `source_type` `pdf_scanned` with no `source_text`), with a warning to
check names, contacts, and figures because that path transcribes from pixels.
A server without `pdftoppm` still falls back to the original `422 pdf_no_text`.

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

### Account lifecycle

| Flow | Route | Notes |
|---|---|---|
| Change password | `POST /api/auth/password` | Requires the current password. Signs out **every other** session and voids outstanding reset links |
| Request a reset | `POST /api/auth/password/forgot` | Always returns the same body — it never reveals whether an address has an account, or whether that account is disabled |
| Complete a reset | `POST /api/auth/password/reset` | Single-use, expiring token. Signs out **all** sessions, including the requester's, because nobody proved possession of the old password |
| Send a verification mail | `POST /api/auth/verify/request` | Signed-in; `409` once already verified |
| Confirm an address | `POST /api/auth/verify/confirm` | Deliberately unauthenticated — the link is usually opened in a different browser, and the token is the proof |
| List sessions | `GET /api/sessions` | Marks the requesting session; shows a coarse device label, IP, and last-active time |
| Revoke one / all others | `DELETE /api/sessions/{id}` · `DELETE /api/sessions` | Ownership is enforced in the Mongo filter, so an id guess cannot reach another user |

Reset and verification tokens are 256-bit values stored only as SHA-256 hashes,
redeemed through a conditional update so a token can never be spent twice, and
destroyed en masse whenever the account's password changes.

**Mail transport.** With `SMTP_HOST` unset the app uses a console driver that
logs each message instead of sending it, so both flows are exercisable locally
with no mail server. Setting `SMTP_HOST` switches to real SMTP and makes
`PUBLIC_BASE_URL` mandatory — see the configuration table for why.

**Disabling an account.** There is no admin UI. Set `disabled: true` on the
user document in MongoDB; the next request from that account is refused with
`403 account_disabled` and its session document is deleted. Login refuses a
disabled account only *after* verifying the password, so the endpoint does not
become an account oracle.

## Repository layout

```text
backend/                  The FastAPI service — nothing outside it is imported
  app/main.py             App factory, middleware, /api/health, /api/tailor
  app/resume.py           Template token contract, proposal validation, rendering
  app/importer.py         LaTeX/PDF-extraction normalization and template assembly
  app/builder.py          User-authored draft validation and normalization (no LLM)
  app/llm.py              One OpenAI-compatible client for every provider
  app/llm_stub.py         Deterministic offline LLM for frontend development
  app/compiler.py         Sandboxed Tectonic execution
  app/pdftext.py          Bounded poppler text/image/link extraction
  app/db.py               MongoDB (Motor) stores: users, sessions, tokens, keys, resumes, JDs, runs
  app/auth.py             Sessions, login/register, per-user provider-key resolution
  app/routes_account.py   Password change/reset, email verification, session management
  app/routes_*.py         Resume, JD, and tailor-history endpoints
  app/security.py         Password hashing, sessions, Fernet key encryption, rate limiting
  app/config.py           Env-driven AppConfig with clamped bounds
  app/schemas.py          Every request/response model, shared with the frontend via OpenAPI
  resume/data.json        Canonical seed resume facts and stable editable IDs
  resume/template.tex     Locked Tectonic-compatible LaTeX template
  resume/assets/          Approved local images/fonts, if the template needs them
  requirements.txt        Runtime dependencies

frontend/                 Next.js app (App Router, TypeScript, Tailwind, shadcn/ui)
  app/                    Routes. (app) is the signed-in shell, (auth) the signed-out pages
  components/             Feature UI, plus common/ primitives and ui/ shadcn parts
  lib/api/                The only place that talks to FastAPI; schema.d.ts is generated
  hooks/                  TanStack Query hooks, one module per domain

docs/                     architecture, design, prd, rules, plan, memory
Dockerfile                Hugging Face-compatible production image
docker-compose.yml        Local MongoDB for multi-user development
```

The frontend is a separate application that speaks only HTTP/JSON to this API.
It holds no business logic: FastAPI remains the source of truth.

`frontend/lib/api/schema.d.ts` is **generated** from the running server's
OpenAPI document and must never be hand-edited — regenerate it with
`npm run gen:api` whenever a request or response model changes, and the
TypeScript models cannot drift from the Python ones.

`backend/resume/template.tex` contains each of these tokens exactly once:

```text
@@CONTACT@@
@@SUMMARY@@
@@EXPERIENCE@@
@@PROJECTS@@
@@EDUCATION@@
@@SKILLS@@
@@ACHIEVEMENTS@@
```

Do not rename, duplicate, or delete them without updating the renderer.

## Local development

Use Python 3.9 or newer. Tectonic 0.16.9 and Poppler (`pdfinfo`, `pdftotext`,
and `pdftoppm`) must also be available on `PATH` for real PDF compilation and
resume import. All three poppler binaries ship in `poppler-utils`.

On macOS with Homebrew:

```bash
brew install tectonic poppler
```

Create the environment and install the application:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
```

Configure Groq without writing the key into the repository:

```bash
export LLM_PROVIDER=groq
export LLM_MODEL=llama-3.3-70b-versatile
export GROQ_API_KEY='your-secret-key'
```

Start the API from the repository root:

```bash
PYTHONPATH=backend uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

`PYTHONPATH=backend` is what makes `app.main` importable; running from the root
rather than from inside `backend/` is what lets the server find the frontend
build at `frontend/out`. The Docker image sets the same two things.

### Running the frontend

The frontend is a separate Node application. Needs Node 20 or newer.

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000> — **not** the uvicorn port. In development,
`next dev` proxies `/api/*` to the API (`next.config.ts`, `rewrites`), so the
browser sees a single origin. That is not cosmetic:

- the session cookie is `HttpOnly` and host-only, so it is only sent to the
  origin that set it, and
- the CSRF guard (`origin_allowed` in `backend/app/security.py`) requires a
  state-changing request's `Origin` to match the request host.

Proxying satisfies both, which is why this project needs no CORS middleware
and never has to weaken the cookie to `SameSite=None`. Point the proxy at a
different API port with `API_PROXY_ORIGIN`:

```bash
API_PROXY_ORIGIN=http://127.0.0.1:8000 npm run dev
```

Other frontend commands:

```bash
npm run typecheck   # tsc --noEmit
npm run lint
npm run build       # static export into frontend/out
npm run gen:api     # regenerate lib/api/schema.d.ts from the running API
```

### Developing without a provider key

`LLM_PROVIDER=stub` selects a deterministic in-process client
(`backend/app/llm_stub.py`) instead of a real provider. Resume import and tailoring
then return fixture text, cost nothing, and never touch the network, so the
whole UI can be exercised offline:

```bash
LLM_PROVIDER=stub PYTHONPATH=backend uvicorn app.main:app --port 8000 --reload
```

Generated copy is prefixed `[stub]` so fixture text is never mistaken for a
model's output. The stub is opt-in and unreachable unless that value is set
explicitly. Note it is the *client*, not a selectable provider: in multi-user
mode you still choose a provider and store a key in Settings, exactly as a
real user would — the key is simply never used.

### Verifying a change

There is no automated test suite. The Docker build is the one thing that still
proves the LaTeX pipeline end to end: it renders the configured baseline and
performs a real Tectonic compile, so a broken template or a missing package
fails the build.

For the API, boot it with the offline stub and call it — that exercises the
real routes through the real middleware stack with no provider key:

```bash
LLM_PROVIDER=stub PYTHONPATH=backend uvicorn app.main:app --port 8000 --reload
curl -s localhost:8000/api/health | python3 -m json.tool
```

For the frontend, `npm run typecheck`, `npm run lint` and `npm run build` are
the gate.

## Configuration

| Name | Required | Default | Purpose |
|---|---|---|---|
| `LLM_PROVIDER` | No | — | `groq`, `cerebras`, `gemini`, `openrouter`, `mistral`, `openai`, `anthropic`, `grid`, or `custom` |
| `LLM_MODEL` | No | provider default | Exact provider model ID |
| `${PROVIDER}_API_KEY` | For real providers | — | Preferred provider-specific server credential, such as `GROQ_API_KEY` |
| `${PROVIDER}_BASE_URL` | No | provider default | Override a provider's endpoint, e.g. `GRID_BASE_URL` for a self-hosted gateway |
| `${PROVIDER}_MODEL` | No | registry default | Per-provider model, e.g. `GRID_MODEL`; beats the global `LLM_MODEL` |
| `${PROVIDER}_VISION` | No | registry flag | Whether the provider serves multimodal models, e.g. `GRID_VISION=true` |
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
| `RESUME_DATA_PATH` | No | `backend/resume/data.json` | Canonical seed structured resume file |
| `RESUME_TEMPLATE_PATH` | No | `backend/resume/template.tex` | Locked LaTeX template |
| `RESUME_ASSETS_DIR` | No | `backend/resume/assets` | Approved local template assets |
| `TECTONIC_UNTRUSTED_MODE` | No | `1` in Docker | Disables trusted-only Tectonic features |
| `TECTONIC_CACHE_DIR` | No | Tectonic default locally | Support-file cache; pre-warmed in Docker |
| `MONGODB_URI` | For multi-user mode | — | MongoDB connection string; unset → demo mode (seed tailoring only) |
| `MONGODB_DB` | No | `jd_resume_builder` | Database name |
| `APP_SECRET_KEY` | Recommended | random ephemeral | Derives the Fernet key encrypting user API keys at rest; unset → keys unreadable after restart (`checks.secret_key: "ephemeral"`) |
| `SESSION_TTL_DAYS` | No | `30` | Session lifetime, bounded 1–90 days |
| `COOKIE_SECURE` | No | `auto` | `auto` (Secure when https / `X-Forwarded-Proto: https`), `true`, or `false` |
| `TRUST_PROXY_HEADERS` | No | `false` | Derive the client IP for rate limits and the login throttle from `X-Forwarded-For`. **Enable only behind a proxy that overwrites the header** — otherwise callers forge a fresh bucket per request. Leave off and every visitor behind a proxy shares one bucket instead |
| `TRUSTED_PROXY_HOPS` | No | `1` | How many proxies you run; the client address is read that many entries from the right of `X-Forwarded-For`. Bounded 1–10. Ignored unless `TRUST_PROXY_HEADERS` is on |
| `ALLOW_REGISTRATION` | No | `true` | Allow new account registration |
| `ALLOW_ENV_KEY_FALLBACK` | No | `false` | Let users without a stored key use the operator's env provider keys |
| `REQUIRE_EMAIL_VERIFICATION` | No | `false` | Refuse feature routes until the account's address is confirmed (`403 email_verification_required`). `/api/me`, session management, logout, and the verification routes stay reachable |
| `PUBLIC_BASE_URL` | Once SMTP is set | — | Public origin (`https://host`) used to build one-time links in outbound mail. **Required when `SMTP_HOST` is set**: without it the origin would come from the request `Host` header, which lets an attacker aim a victim's real reset token at their own domain. Non-http(s) values are ignored |
| `MAIL_FROM` | No | `roletex@localhost` | Envelope sender for account mail |
| `SMTP_HOST` | No | — | SMTP server. Unset → console driver: the message (link included) is written to the application log instead of sent. Fine locally, never for a deployment real users reach |
| `SMTP_PORT` | No | `587` | Bounded 1–65535 |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | No | — | SMTP credentials; omit for an unauthenticated relay |
| `SMTP_STARTTLS` | No | `true` | Issue STARTTLS after connecting |
| `SMTP_TIMEOUT_SECONDS` | No | `15` | Per-send socket timeout, bounded 5–120 |
| `PASSWORD_RESET_TTL_MINUTES` | No | `60` | Reset-link lifetime, bounded 5–1440 |
| `EMAIL_VERIFY_TTL_HOURS` | No | `48` | Verification-link lifetime, bounded 1–168 |
| `RATE_LIMIT_EMAIL_CALLS` / `RATE_LIMIT_EMAIL_WINDOW_SECONDS` | No | `5` / `900` | Mail bucket for reset/verification requests, charged against both the caller's IP and the target address; bounded 1–100 / 60–86400 |
| `RATE_LIMIT_LLM_CALLS` / `RATE_LIMIT_LLM_WINDOW_SECONDS` | No | `10` / `300` | Per-user LLM-cost bucket (tailor, imports, recompile); bounded 1–1000 / 10–3600 |
| `RATE_LIMIT_LLM_IP_CALLS` | No | `30` | Per-IP ceiling on the same routes over the same window, so registering fresh accounts cannot mint fresh LLM budget; bounded 1–5000 |
| `RATE_LIMIT_GENERAL_CALLS` / `RATE_LIMIT_GENERAL_WINDOW_SECONDS` | No | `120` / `60` | General authed-API bucket; bounded 10–10000 / 1–3600 |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_SECONDS` | No | `10` / `900` | Failed-login throttle per email+IP; bounded 1–100 / 10–3600 |
| `MAX_RESUMES_PER_USER` | No | `10` | Bounded 1–100 |
| `MAX_VERSIONS_PER_RESUME` | No | `20` | Bounded 1–100 |
| `MAX_VERSIONS_PER_JD` | No | `20` | Archived JD revisions kept per JD, bounded 1–100; oldest pruned |
| `MAX_JDS_PER_USER` | No | `50` | Bounded 1–500 |
| `MAX_RUNS_PER_USER` | No | `200` | Bounded 10–2000; oldest runs pruned |
| `MAX_PDF_UPLOAD_BYTES` | No | `5000000` | PDF upload cap, bounded 1–20 MB |
| `MAX_IMPORT_PDF_PAGES` | No | `3` | Page cap for an imported resume, bounded 1–20 |
| `PDFTOTEXT_BIN` | No | `pdftotext` | poppler binary for PDF text extraction |
| `PDFINFO_BIN` | No | `pdfinfo` | poppler binary for the import page-count check |
| `PDFTOPPM_BIN` | No | `pdftoppm` | poppler binary for rendering PDF pages to images |
| `PDFTOHTML_BIN` | No | `pdftohtml` | poppler binary for recovering hyperlink targets |
| `PDF_EXTRACT_TIMEOUT_SECONDS` | No | `30` | Extraction subprocess timeout, bounded 10–120 |

See `.env.example` for a commented template, and `docker-compose.yml` for a
local MongoDB (`docker compose up -d mongo`, then
`MONGODB_URI=mongodb://localhost:27017`).

Only put API credentials in local environment variables or your hosting
provider's secret store. Never add them to `backend/resume/data.json`, frontend code,
Docker build arguments, or Git.

Provider adapters use separate secrets such as `GROQ_API_KEY`,
`CEREBRAS_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`,
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GRID_API_KEY`. These env keys serve demo mode and
(only when `ALLOW_ENV_KEY_FALLBACK=true`) multi-user requests; in multi-user
mode users normally add their own keys in Settings, stored Fernet-encrypted
and never echoed back. Every request reaches a real provider: there is no
offline stand-in, so nothing can quietly return placeholder facts that read
like a genuine extraction.

## Customize the resume

1. Update only verified facts in `backend/resume/data.json`; it is the authoritative
   source used for every tailored resume.
2. Keep every object and bullet `id` stable. The model refers to those IDs when
   proposing edits.
3. Keep contact information under `identity`; the backend excludes it from the
   LLM request and restores it during deterministic rendering.
4. Add only approved local files to `backend/resume/assets/`.
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

### The frontend is not in the image yet

**Known gap.** The Dockerfile has no Node stage, so it does not build the
frontend. An image built today serves the API and, finding no UI at
`frontend/out`, logs a warning and answers `/` with a short "no UI installed"
page.

Serving the frontend needs a multi-stage build: a `node` stage running
`npm ci && npm run build` in `frontend/`, then a `COPY --from` of
`frontend/out` into the Python image. Two things to get right when adding it:

- Put the Node stage and the `COPY` **after** the Tectonic prewarm layers. The
  prewarm runs several full LaTeX compiles, and the current `COPY . ./` sits
  before it — so as things stand every frontend edit invalidates the cache and
  pays for the whole prewarm again.
- `node_modules`, `.next` and `out` are already in `.dockerignore`, so the
  builder stage must install dependencies itself rather than expect them to be
  copied in.

Until then, a container is API-only. Locally, run `npm run build` and point the
server at the result — `frontend/out` is the default, and `FRONTEND_DIR`
overrides it.

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
Dockerfile using the matching official release asset. Then rebuild — the
prewarm layer compiles the seed resume and every offered font size with the
new binary, so an incompatible release fails the build rather than the first
request. The current image deliberately rejects an ARM build because its
pinned executable is x86-64.
