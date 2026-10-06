# Design — RoleTeX

> Contracts and implementation details. Routes and flows: [architecture.md](architecture.md) · Invariants: [rules.md](rules.md) · Decisions: [memory.md](memory.md)

Every model derives from `StrictModel` (`extra="forbid"`): unknown fields are rejected in requests, responses and LLM output alike.

## 1. Tailor API

**`POST /api/tailor`** (`TailorRequest`)

| Field | Constraints |
|---|---|
| `job_description` | 50–20,000 chars; exactly one of this or `jd_id` (else `422 jd_required`) |
| `jd_id` | a saved JD |
| `resume_id` | required; an owned resume |
| `provider` / `model` | optional override, resolved against the user's stored keys |
| `compile` | default `true`; `false` returns everything except the PDF |
| `require_one_page` | default `true`; enables the shortening repair |
| `save_run` | default `true`; stores the run in history |

**Response** (`TailorResponse`): `proposal`, `changes[]` (`{field_id, before, after}`), `unified_diff`, `latex_source`, `pdf_base64`, `page_count`, `filename`, `provider`, `model`, `repaired`, `warnings[]`, `compiler` (attempted, success, page count, text preview, warnings, log), `run_id`.

## 2. LLM contract

**Proposal schema** — the model must return exactly:

```json
{
  "summary": "headline, ≤12 words / 120 chars",
  "bullet_rewrites": [{"id": "existing bullet id", "text": "1–600 chars"}],
  "skills_order": ["exact permutation of existing skills"]
}
```

At most 30 rewrites, a server-side ceiling the prompt never states; `skills_order` capped at 300. The parser tolerates wrappers (a JSON object inside a markdown fence or prose is extracted) but nothing else.

**Providers** (`llm.py`): one `OpenAICompatibleLLM` for `anthropic, groq, cerebras, grid, gemini, openrouter, mistral, openai, custom`. Each has a base URL, key env var, default model and a vision flag (Groq, Cerebras and Grid are text-only by default; `${PROVIDER}_VISION` overrides). Env resolution: `${PROVIDER}_API_KEY` then `LLM_API_KEY`; `${PROVIDER}_MODEL` beats `LLM_MODEL`; `${PROVIDER}_BASE_URL` overrides the endpoint (`LLM_BASE_URL` for `custom`). HTTPS is required unless `ALLOW_INSECURE_LLM_BASE_URL=true`. Retries on 429/5xx; JSON mode falls back to plain completion when a provider rejects it.

**Per-user selection** (`auth.resolve_llm_selection`, used by tailoring and import): provider = the request's `provider`, else the user's `default_provider`. Model = the request's `model`, else the user's model for that provider (`provider_models`, set per provider in Settings), else `${PROVIDER}_MODEL`, else the registry default. `PATCH /api/me` takes `provider_models` as a partial map: a name sets that provider's model, `null` or `""` clears it (≤200 chars, no control characters, else `422 invalid_model`). A pre-existing single `default_model` counts as the model for `default_provider`.

**`LLM_PROVIDER=stub`** selects `llm_stub.py`, a deterministic offline client. It is never a default, and its text is prefixed `[stub]`.

**Prompt:** the JD is untrusted reference data; reword, shorten, emphasize and reorder only; never invent employers, dates, skills, metrics or degrees; use only supplied IDs and skills; return only the schema. The server's validation is the enforcement, not the prompt.

**Repair (one per request):** the first of — (1) semantic: the error summary goes back, the result is re-validated the same way, a second failure is 422; (2) compile: only for `latex_compile_failed`, with an identity-redacted log; (3) shortening: the PDF overflowed and `require_one_page` is set; if it fails, the original PDF is returned.

## 3. Validation (`validate_proposal`)

| Rule | Rejects |
|---|---|
| ID existence / uniqueness | rewrite IDs not in the resume, or repeated |
| Skills permutation | `skills_order` that isn't the exact multiset of existing skills |
| Numeric fabrication | any number in proposed text that isn't in the factual source |
| Length | summary >12 words or >120 chars; bullet >600 chars, >70 words, or >30 chars longer than its source |
| Blank text | empty rewrites |

The fabrication guard only catches numbers (memory G-5).

## 4. Rendering (`resume.py`)

- Each of the 7 tokens is replaced exactly once (plus optional `@@CUSTOM@@`); any leftover token aborts the render.
- `escape_latex` escapes all ten specials (`\ { } $ & % # _ ~ ^`), strips NUL and collapses newlines — applied to every model string.
- URLs: only `http(s)` without control characters, and they come from stored data — the model can't add or change one.
- **Sectioned rendering** (every user resume): each section carries its own heading, so empty sections disappear. Only the Docker prewarm's seed render still uses the classic layout.
- Identity renders into `@@CONTACT@@` from stored data only.

## 5. Import (`importer.py`, `pdftext.py`)

- **LaTeX:** `POST /api/resumes` — `latex` (40–200,000 chars), optional `name` / `provider` / `model`.
- **PDF:** `POST /api/resumes/pdf` — multipart `file` plus the same options; ≤`MAX_PDF_UPLOAD_BYTES` (5 MB) and ≤`MAX_IMPORT_PDF_PAGES` (3). The text layer, page images (`pdftoppm`, ~2,000 image tokens per page) and link targets (`pdftohtml -xml`, since linked labels like "GitHub" hide their URLs) go to the model together when it can see images — images fix column order and text the layer drops. Text-only providers get text only, with a warning. A scan (no text layer) goes as images only and is stored as `pdf_scanned`.
- **Normalization:** model IDs discarded, positional IDs assigned (R-12); `sanitize_style` forces A4, whitelists font size (10/11/12pt, default 10), clamps margin to 1.0–3.0 cm (default 2.0), accepts an optional 6-hex accent. Headlines are trimmed to 12 words.
- **Template:** fully server-authored, embedding only the clamped style. The original document is neither stored nor compiled.
- Every import response carries a "review your import" warning. Quota: `409 resume_quota_exceeded`.

## 6. Compiler (`compiler.py`)

- `tectonic -X compile --untrusted [--only-cached] --outdir <job> <job>/resume.tex`, argument list, output captured.
- Fresh `TemporaryDirectory(prefix="resume-job-")` per compile, approved assets copied in, always removed.
- Timeout 10–180 s (default 90); `RLIMIT_CPU/FSIZE/NOFILE`, plus `RLIMIT_AS` on Linux; semaphore of 1–4.
- After compiling: `pdfinfo` page count (warning above `MAX_PDF_PAGES`), `pdftotext` for an ATS check and preview, log stripped of temp paths and capped.
- Failures: `compiler_not_found` / `compiler_start_failed` → 503, `compile_timeout` → 504, `latex_compile_failed` → 422 (repairable).

## 7. Accounts

- **Sign-up:** `POST /api/auth/register/code` mails a 6-digit code (10 minutes, 5 wrong guesses, stored as an HMAC keyed by `APP_SECRET_KEY`); a registered address gets a "you already have an account" email and the same response. `POST /api/auth/register` checks the password policy first (so a weak password doesn't use up the code), redeems the code atomically, creates the account verified and opens a session.
- **Password policy** (`security.password_policy_error`, mirrored in `frontend/components/auth/password-rules.tsx`): 8–128 characters; a lowercase, an uppercase, a number and a symbol; no leading or trailing space; not a common password; not containing the email name. Checked when a password is set, never at sign-in.
- **Reset / verify tokens:** 256-bit, stored as SHA-256, single-use via a conditional update; links need `PUBLIC_BASE_URL` once SMTP is configured. A password change signs out other sessions; a reset signs out all of them.

## 8. Frontend (`frontend/`)

Next.js App Router, React, TypeScript, Tailwind, shadcn/ui on Base UI — built to a static export and served by FastAPI. Client-rendered: every screen sits behind the HttpOnly session cookie.

- **Routes:** `/` (landing), `/tailor`, `/jobs`, `/companies`, `/resumes`, `/jds`, `/history`, `/settings`; signed-out `/sign-in`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`; anything else is `404.html`. A signed-out visitor is sent to `/sign-in`.
- **Selection is a query parameter** (`/resumes?id=…`, `/history?run=…`, `/tailor?resume=…&jd=…`) — a static export can't prerender per-user `[id]` routes.
- **API layer:** `lib/api/client.ts` is the only `fetch`, same-origin with the cookie, so no CORS and no `SameSite=None`. `schema.d.ts` is generated from OpenAPI (`npm run gen:api`); `mappers.ts` converts between read models (`ResumeData`, with IDs) and write models (`ResumeDraft`, without).
- **Server state:** TanStack Query, keys in `lib/api/query-keys.ts`. Mutations never auto-retry; queries never retry a 4xx or a timeout.
- **Look:** a top bar with text-tab navigation (a drawer on small screens); screens share `PageHero` and the dotted `Canvas` from `components/common`. Resume thumbnails and the tailor screen's resume preview are HTML typeset from stored facts, never a compile.
- **Tailor screen:** setup → running (a real clock; stages estimated from it, since the API streams nothing) → review. The change list is always visible; the PDF, unified diff and LaTeX sit beside it in tabs (R-14).
- **PDF preview:** `pdfjs-dist`, loaded client-side on demand.
- **Accessibility:** skip link; one `<h1>` per page, focused on navigation; `aria-current` in the nav; labelled inputs with `aria-invalid` / `aria-describedby`; focus traps from Base UI.

## 9. Job watch (`backend/app/crawler/`)

**Inputs (user-supplied, never inferred).** Every company row needs a careers link; nothing is searched or guessed. Preferences are typed on `/companies`: `categories` (≥1 of the fixed list in `classify.CATEGORIES`), `exp_from_years` ≤ `exp_to_years` (0–30, half-years), `margin_months` (0–24, default 6), `locations` (≤10 cities or regions) and `include_remote`. Invalid input is `422 invalid_job_prefs` with field-addressed errors.

**Links → sources** (`sources.py`). A link is normalized (http(s), standard port, no credentials, no private/loopback IP literal, no job aggregator) and mapped to a shared source key: `greenhouse:<token>`, `lever:<site>` (`lever-eu:` for the EU instance), `ashby:<board>`, `workable:<slug>`, `smartrecruiters:<company>`, `workday:<tenant>.<wdN>/<site>`, or `page:<url>` for anything else. Any URL form of a board (board page, posting, embed script, API) gives the same key, so the same board pasted twice is a duplicate. A page is read once: an embedded board repoints its watchers to that board; JobPosting JSON-LD makes it a page source; otherwise `unsupported`.

**Feeds** (`ats.py`, all public and keyless): Greenhouse `boards-api…/jobs?content=true`; Lever `api.lever.co/v0/postings/<site>?mode=json`; Ashby `api.ashbyhq.com/posting-api/job-board/<board>`; Workable `apply.workable.com/api/v1/widget/accounts/<slug>?details=true`; SmartRecruiters `api.smartrecruiters.com/v1/companies/<c>/postings` (+ one detail per posting); Workday `POST …/wday/cxs/<tenant>/<site>/jobs` with `limit` 20 (+ one detail per posting; the feed stops at 2,000, so jobs are never closed past that). Per-posting details are fetched only for postings some watcher could want (category and location pre-check), at most `DETAIL_BUDGET` per source per crawl; the rest stay incomplete and are never matched until fetched.

**Fetcher** (`fetch.py`, R-16): http(s) on 80/443 only; every DNS answer must be public (IPv4-mapped and 6to4 unwrapped); the request goes to the checked IP with `Host` and TLS SNI set to the name; one connection pool per hostname; redirects followed by hand (≤5), each re-checked; body streamed and cut at `CRAWL_MAX_RESPONSE_BYTES` after decompression; one request at a time per host, 1 s apart; robots.txt honoured for HTML pages (a 5xx robots.txt means disallowed).

**Facts per job** (`classify.py`), computed once when stored:
- *Category*: title keywords decide; the department (or Workable/SmartRecruiters function) only when the title matches nothing. A title can carry two ("Sales Engineer"). No category → never matched.
- *Experience* `(min, max)` months, first hit wins: an intern title or intern flag → 0–12; JSON-LD `monthsOfExperience`; patterns in the text (`3-5 years`, `5+ yrs`, `minimum 2 years`, `6 months of experience`, `Experience: 2 years`, number words; the largest stated minimum wins; "freshers" sets the minimum to 0; company-age sentences and numbers over 25 years are ignored); title words (`senior` 48, `lead` 60, `staff`/`principal` 84, `director`/`head of`/`vp` 120, `junior`/`associate` 0–24, labelled "from title"); else unknown.
- *Location*: the feed's location strings, normalized; `remote` from the feed's flag or "remote / work from home / anywhere" (not "hybrid").

**Match rule** (`match.py`), with A = from×12, B = to×12, G = margin: shown when a category matches, `min ≤ B + G` (or unknown), `max ≥ A` (or unknown), and the location fits (no location preference; a city alias such as Bengaluru = Bangalore, or a region such as Delhi NCR; remote when ticked; jobs with no location pass). Label: `fits` when `min ≤ B`, `stretch` inside the margin, `unstated` when unknown. The Jobs list orders fits → stretch → unstated, newest first, and hides dismissed matches and closed postings (except saved ones).

**Notifications** (`telegram.py`, `service.py`). Linking: a 256-bit one-time token (SHA-256 stored, `TELEGRAM_LINK_TTL_MINUTES`) in `t.me/<bot>?start=<token>`; the bot binds the chat on `/start <token>` from a private chat and unbinds on `/stop`; a chat belongs to one account. Updates come by `getUpdates` long polling behind a Mongo lease (webhooks can't reach a private Space). When a cycle has crawled everything, each user with unsent matches gets one digest (≤30 listed, then "and N more", plus a line for matches from newly added companies); HTML-escaped; ~1 message a second per chat; 403 / chat-not-found unlinks the chat. Users without a linked chat have their matches marked sent, so linking later never replays a backlog.

**Schedule.** `CRAWLER_ENABLED` marks every watched source due each `CRAWL_INTERVAL_HOURS` (the last run is stored in Mongo, so a restart or a sleeping Space catches up on wake). Adding companies and "Refresh now" (one per user per 30 minutes) crawl on demand either way. A cycle runs under the `crawler` lease, so one process crawls at a time.
