# Job watch — research and plan

> Status: **built (phases 1–4), 2026-10-06.** This is the plan the feature was built from; the contracts as built are in [docs/design.md §9](../../../docs/design.md) and [docs/architecture.md §5a](../../../docs/architecture.md), and the decisions are D-31–D-36 in [docs/memory.md](../../../docs/memory.md).
>
> **Where the build differs from this plan:**
> - `CRAWL_MAX_RESPONSE_BYTES` defaults to 20 MB (1–50 MB), not 5 MB: OpenAI's Ashby board alone is ~14 MB.
> - Keka and Recruitee adapters are not built (phase 5); Darwinbox, iCIMS and JS-only sites stay `unsupported`.
> - Workday and SmartRecruiters fetch per-posting details only for postings some watcher could want, up to 150 per source per crawl. A 2,000-posting Workday board takes about three minutes to list.
> - An "Intern" title outranks a stray "2+ years" in the text.
> - `/jobs` has two tabs, Matches and Saved. Opening a job marks it seen; Dismiss hides it.
> - "Refresh now" is limited to once per 30 minutes per user.
> - Live checks: all six adapters were run against real boards (Airbnb, Palantir, OpenAI, Hugging Face, Equinox, NVIDIA).

**In one line:** the user uploads their companies **with careers-page links** (CSV / Excel / PDF) and picks what they want: job type (Engineering, Sales, …), an experience range (e.g. 0–3 years), an extra margin (e.g. 6 months) and, optionally, locations. A scheduled crawler reads every link. When the crawl finishes, openings that match show on a Jobs page and go to the user's Telegram as one message.

What the system does **not** do: guess or search for careers pages (the user supplies every link), or read anything from the resume to decide matches (the user types their preferences).

---

## 1. Flow

```text
 /companies — setup route (per user, saved in DB)
   ├─ Job type        [Engineering ▾] [Data & AI ▾] …   multi-select dropdown
   ├─ Experience      from [0] to [3] years
   ├─ Extra margin    [6] months
   ├─ Location        [Bengaluru] [Pune] …  [x] Remote    optional; empty = anywhere
   └─ Upload CSV / Excel / PDF   (company, careers link)   or add one row by hand
                │
                ▼
   watchlist (per user)  ──►  read each link once: which kind of source is it?
                               ATS board (Greenhouse, Lever, Ashby, Workday…)  → ready
                               own careers page with embedded ATS / JobPosting data → ready
                               nothing machine-readable → "unsupported" (user can paste a better link)
                │
                ▼
   career_sources ── every N hours, one runner (Mongo lease) ──► crawl
                │
                ▼
   jobs  (upsert by source + job id; new / closed tracked; description as plain text)
     • category from department + title    (Engineering, Sales, …)
     • experience required from the text   (3-5 years → 36–60 months)
                │
                ▼
   match against each watcher's saved preferences
     job type ∩ chosen types   AND   experience inside range (+ margin)   AND   location (if set)
                │
                ▼   when the whole crawl cycle has finished
        ┌───────┴────────┐
        ▼                ▼
   /jobs page       one Telegram digest per user (new matches only)
   Open · Tailor · Dismiss
        │
        ▼
   "Tailor" → saves the posting as a JD → existing /tailor flow
```

## 2. What already exists and gets reused

| Need | Already in the repo | How it's reused |
|---|---|---|
| PDF text and links | `pdftext.extract_pdf_text` and `pdftext.extract_pdf_links` (poppler, sandboxed, capped) | Reading a company list uploaded as PDF, including links hidden behind words like "Careers" |
| One-time tokens | `AuthTokenStore` (SHA-256 hash, TTL, atomic `consume`) | Telegram link token, new `purpose="telegram_link"` |
| Pluggable transport | `Mailer` / `ConsoleMailer` pattern | `Notifier` / `ConsoleNotifier` (logs instead of sending when no bot token is set) |
| Background task in the app | `_ensure_indexes_with_retry` in the FastAPI lifespan | Crawl loop and Telegram poller |
| Rate limits, CSRF, body caps, quotas | `main.py` middleware, `config.py` clamps | New routes slot into the same buckets and caps |
| JD library + tailoring | `POST /api/jds`, `/tailor?jd=…` | "Tailor for this job" button |

Facts from the code that shape the plan:

- **No LLM is needed anywhere in v1.** Links, preferences and matching are all deterministic, so the feature costs $0 and needs no provider key.
- `JdCreateRequest.content` must be 50–20,000 chars, and `MAX_JDS_PER_USER` is 50. Saving a posting as a JD truncates to 20,000 chars and respects that quota.
- The deployment target is a **private** Hugging Face Space. That rules out Telegram webhooks (§8).
- `architecture.md`: "MongoDB is the only store; there is no queue." The crawler keeps that: all coordination goes through Mongo documents.

## 3. Step 1 — Setup: preferences + company list

### 3.1 Preferences (asked on the setup screen, saved per user)

| Field | Input | Stored as | Server-side validation |
|---|---|---|---|
| Job type | multi-select dropdown from a fixed list (§6.1) | `categories: ["engineering", "data_ai"]` | every value in the whitelist, at least one |
| Experience | two number inputs, "from" and "to", in years (half-years allowed) | `exp_from_years: 0`, `exp_to_years: 3` | `0 ≤ from ≤ to ≤ 30` |
| Extra margin | one number input in months, prefilled with 6 | `margin_months: 6` | `0–24` |
| Location (optional) | a tag input for cities plus a "Remote" checkbox; left empty means anywhere | `locations: ["Bengaluru", "Pune"]`, `include_remote: true` | ≤ 10 cities, each ≤ 80 chars, no control characters |

Preferences are editable at any time. Saving them **recomputes matches over the jobs already crawled**, so no new crawl is needed. That backlog shows on the website but is not pushed to Telegram as a flood (§8.4).

Following the project's minimal-UI rule: no explainer copy, and limits are enforced by the server, not restated in the UI.

### 3.2 Company list

**Every row needs a careers link.** The company name is optional: without one, it's derived from the link (Greenhouse board token, Lever site name, or host name).

| Format | Parser | Notes |
|---|---|---|
| CSV | stdlib `csv` + `csv.Sniffer` for the delimiter | Decode `utf-8-sig`, fall back to `cp1252`. Google Sheets "Download → CSV" works as is |
| Excel (.xlsx) | `openpyxl` (new dependency) + `defusedxml` | openpyxl doesn't guard against XML bombs unless `defusedxml` is installed. Use normal (not `read_only`) mode, because read-only cells drop **hyperlinks**, and a "Careers" cell is often a link. The upload cap bounds memory. First sheet only |
| PDF | existing `pdftotext` + `pdftohtml` link extraction, page cap ~10 | URLs in the text are found by regex. Linked words come from `extract_pdf_links`. The text before a URL on the same line is the name. Scanned PDFs are not supported |

**Column detection** (case-insensitive header aliases):

- name ← `company`, `company name`, `name`, `organisation`, `organization`, `employer`
- link ← `careers`, `career page`, `careers url`, `careers link`, `jobs`, `job link`, `link`, `url`
- With no header row: the first URL cell is the link, and the first non-URL text cell is the name.

**Row checks:** the link must be `http(s)` with no credentials. Job aggregators are refused (`linkedin.com`, `naukri.com`, `indeed.*`, `glassdoor.*`, `foundit.in`, `instahyre.com`, `wellfound.com`, `cutshort.io`), because their terms forbid scraping and they block bots. Duplicates are dropped by normalized link, within the file and against the existing watchlist.

**Response:** `{added, duplicates, skipped: [{row, reason}]}`, with reasons such as `missing link`, `not a web link` or `job aggregator`. Each added company shows a status: `ready (Greenhouse)`, `checking`, `unsupported`, or `error`. The link can be edited at any time.

**Limits (server-side):** `MAX_COMPANIES_PER_USER` (e.g. 100), upload ≤ 2 MB, ≤ 1,000 rows read.

## 4. Step 2 — Reading the link (what kind of source is it?)

No guessing and no searching: the crawler only works out **how to read the link the user gave**.

1. **The link is an ATS board** (an applicant tracking system such as Greenhouse or Workday). The URL pattern alone identifies it (table below) and the source is `ready` at once.
2. **The link is the company's own careers page.** Fetch it once and look for:
   - **an embedded ATS** in its links, iframes or scripts, e.g. `boards.greenhouse.io/embed/job_board?for=<token>`, `jobs.lever.co/<site>`, `jobs.ashbyhq.com/<name>`, `*.myworkdayjobs.com/…`. If found, the source becomes that ATS board, which is much more reliable than the HTML.
   - **`JobPosting` structured data** (`<script type="application/ld+json">`, the markup Google for Jobs reads). If found, the source is the page itself.
3. **Neither** → `unsupported`. The page is probably a JavaScript app. The user can paste the job-board link instead (the "View all jobs" / "Apply" link usually reveals it).

If two users add the same link, it's stored once in `career_sources` and crawled once. Each user still has their own watchlist row.

### 4.1 Supported sources

Endpoints below were checked against public docs or write-ups, except where marked *verify*.

| ATS | Link looks like | Jobs endpoint (public, no key) | Notes |
|---|---|---|---|
| Greenhouse | `boards.greenhouse.io/<token>`, `job-boards.greenhouse.io/<token>` | `GET https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true` | One call includes descriptions (HTML-escaped) and `departments` |
| Lever | `jobs.lever.co/<site>` (EU: `jobs.eu.lever.co`) | `GET https://api.lever.co/v0/postings/<site>?mode=json` (EU: `api.eu.lever.co`) | `descriptionPlain`, `categories.team/department/location/commitment`, `workplaceType`; `skip`/`limit` paging |
| Ashby | `jobs.ashbyhq.com/<name>` | `GET https://api.ashbyhq.com/posting-api/job-board/<name>?includeCompensation=true` | `descriptionPlain`, `department`, `team`, `employmentType` (incl. `Intern`), `isRemote` |
| Workable | `apply.workable.com/<slug>` | `GET https://apply.workable.com/api/v1/widget/accounts/<slug>?details=true` | `details=true` adds descriptions |
| SmartRecruiters | `careers.smartrecruiters.com/<Company>` | `GET https://api.smartrecruiters.com/v1/companies/<Company>/postings` | Only if the company enabled the public feed (lower plans don't); detail per posting |
| Workday | `<tenant>.wd<N>.myworkdayjobs.com/<site>` | `POST https://<tenant>.wd<N>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs` with `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}` | Big companies use it. `limit` above 20 silently returns **zero** jobs. No department field, so the category comes from the title. Detail is a GET per job, so fetch details for **new** jobs only |
| Keka (common in India) | `<tenant>.keka.com/careers` | `GET https://<tenant>.keka.com/careers/api/jobs/default/active` | *verify*: seen in an open-source scraper, not in official docs |
| Recruitee | `<slug>.recruitee.com` | `GET https://<slug>.recruitee.com/api/offers/` | *verify* |
| Any careers page with JSON-LD | — | `JobPosting` blocks on the page; if the list page has none, follow job-detail links on the same host (bounded count) and read theirs | May carry `experienceRequirements.monthsOfExperience` |
| Darwinbox, iCIMS, Taleo, SuccessFactors, Oracle, custom JS apps | — | — | `unsupported` in v1 unless they embed JSON-LD. A headless browser (Playwright) would cover them, but adds a few hundred MB to the image and heavy CPU on a free Space. Later phase |

## 5. Step 3 — The crawler

**One cycle:**

1. Take the lease: an atomic `find_one_and_update` on a `system_state` doc `{_id: "crawler_lease", holder, expires_at}`. Only one runner crawls, even with `--reload` or more than one process.
2. Pick due sources: `next_crawl_at <= now` and at least one watcher.
3. Crawl them through a bounded worker pool. Global concurrency is about 8, with **one request at a time per host** and about 1 s between requests to the same host.
4. Per source, upsert every job by `(source_id, external_id)` with `last_seen_at = now`. Jobs not seen this time get `closed_at`. Description detail is fetched only for new jobs.
5. For new jobs: clean the description to text, then compute **categories** (§6.1), **experience required** (§6.2) and **locations / remote** (§6.4) once, and store them on the job.
6. Match new jobs against each watcher's preferences (§6.3) and set `next_crawl_at = now + interval` (backed off on failure).
7. **After every due source is done**, send one Telegram digest per user with new matches (§8.4), then release the lease.

**Politeness and robustness:**

- Identify the crawler with a `User-Agent` like `RoleTeXBot/0.1 (+<PUBLIC_BASE_URL>)`.
- Honour `robots.txt` for HTML pages. Fetch it through the safe fetcher below, then hand it to `urllib.robotparser.RobotFileParser.parse()`. Never use `RobotFileParser.read()`, which bypasses the SSRF guard.
- Cap timeouts at 15 s, responses at 5 MB and redirects at 5. Retry with backoff on 429/5xx and honour `Retry-After`.
- After N consecutive failures, mark the source `error`; it shows in the user's company list.
- Clean descriptions to **plain text on the server**: stdlib `html.parser`, keeping paragraph and list breaks, capped at 20,000 chars. The UI never renders posting HTML, so a hostile posting can't inject script.

**SSRF (server-side request forgery) guard.** Users type the links and our server fetches them, so this is mandatory:

- Allow only `http`/`https` on ports 80/443, with no userinfo.
- Resolve DNS and refuse private, loopback, link-local, multicast and reserved addresses. That covers `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (cloud metadata), `::1` and `fc00::/7`.
- Follow redirects **manually** and re-check every hop.
- Connect to the IP that was checked, so DNS rebinding can't swap it.
- Send no cookies and no auth headers.

The guard lives in one module, and every outbound crawl request goes through it.

**Scale and cost at v1 sizes:** 100 companies × 1–3 requests × 4 cycles/day is about 1,200 requests/day, free (public ATS APIs). Mongo Atlas free tier is 512 MB. Descriptions are capped and closed jobs are pruned after `JOB_RETENTION_DAYS`, so tens of thousands of jobs fit.

## 6. Step 4 — Matching against the user's preferences

All deterministic: computed once per job at crawl time, compared per user at match time.

### 6.1 Job type (category)

The dropdown offers a **fixed list** (server-owned whitelist). Proposed:

`Engineering` · `Data & AI` · `Product` · `Design` · `Sales` · `Marketing` · `Customer success & support` · `Operations` · `Finance` · `People / HR` · `Legal`

Each job gets one or more categories from its **department/team** (Greenhouse, Lever, Ashby, Workable and SmartRecruiters give one) and its **title**, using a keyword table matched on whole words:

| Category | Department / title keywords (examples) |
|---|---|
| Engineering | engineering, tech, R&D · engineer, developer, SDE, SWE, programmer, backend, frontend, full stack, android, iOS, mobile, DevOps, SRE, QA, test, platform, infrastructure, security engineer, architect |
| Data & AI | data, analytics, ML · data scientist, data analyst, data engineer, machine learning, AI, analytics, BI |
| Product | product · product manager, product owner |
| Design | design · designer, UX, UI, user researcher |
| Sales | sales, business development · sales, account executive, BDR, SDR, account manager, presales, partnerships |
| Marketing | marketing, growth · marketing, growth, SEO, content, brand, communications |
| Customer success & support | support, customer success, CX · customer success, support, customer experience, onboarding |
| Operations | operations, supply chain · operations, logistics, program manager, project manager |
| Finance | finance, accounting · accountant, finance, audit, tax, treasury, FP&A |
| People / HR | people, HR, talent · recruiter, talent acquisition, HR, people partner, payroll |
| Legal | legal, compliance · counsel, legal, compliance, paralegal |

A title can hit two categories: "Sales Engineer" → Sales + Engineering; "Data Engineer" → Data & AI + Engineering. That's intended: a job shows if **any** of its categories is one the user picked. A job the table can't place gets no category and never matches. `Other` is not offered for now (§12), and extending the keyword table is the fix when a real job slips through.

### 6.2 Experience the job asks for (M = minimum months, X = maximum, if stated)

First hit wins:

1. **Structured:** JSON-LD `experienceRequirements.monthsOfExperience`. Ashby `employmentType: Intern` → 0.
2. **Description text:** only sentences that mention `experience` / `exp` / `yrs` / `years`:
   - `3-5 years`, `3 to 5 yrs` → M=36, X=60
   - `5+ years`, `5 years or more` → M=60
   - `minimum 2 years`, `at least 2 years`, `min. 2 yrs` → M=24
   - `6 months of experience` → M=6; `3.5 years` → 42; number words (`two years`) are handled too
   - `fresher`, `0-1 years`, `new grad` → M=0, X=12
   - ignore numbers > 30, `years ago`, `years old`, and sentences without an experience word (e.g. "a 20-year-old company")
   - several mentions ("5+ years overall, 2+ years in Go") → take the **largest minimum** (60)
3. **Title, when the text says nothing:** `Intern`/`Trainee` → 0–12; `Senior` → M=48; `Staff`/`Principal`/`Lead` → M=84. Labelled "estimated from title", since levels vary by company.
4. **Unknown** → M and X are null.

### 6.3 The match rule

From the user's preferences: **A** = `exp_from_years × 12`, **B** = `exp_to_years × 12`, **G** = `margin_months`.

A job is shown when **all** of these hold:

1. **Category:** at least one of the job's categories is in the user's chosen categories.
2. **Not too senior:** M is unknown, or **M ≤ B + G**. The margin extends only the top of the range, which is the "+6 months".
3. **Not too junior:** X is unknown, or **X ≥ A**. A "0–1 years" role doesn't show to someone who asked for 3–6.
4. **Location** (§6.4): the user set none, or the job's location matches one of their cities, or the job is remote and they ticked Remote.

Label shown on the website and in Telegram:

| Condition | Label |
|---|---|
| M ≤ B | `fits` |
| B < M ≤ B + G | `stretch` (inside the margin) |
| M unknown | `experience not stated` (ranked last) |

**Worked example.** Preferences: Engineering, 0 to 3 years, margin 6 months, so the ceiling is 36 + 6 = **42 months**.

| Posting | M / X | Result |
|---|---|---|
| Backend Engineer, "0-1 years" | 0 / 12 | shown · `fits` |
| SDE-2, "2-4 years" | 24 / 48 | shown · `fits` |
| Software Engineer, "3+ years" | 36 / — | shown · `fits` |
| Platform Engineer, "minimum 3.5 years" | 42 / — | shown · `stretch` |
| Senior Engineer, "4+ years" | 48 / — | hidden (48 > 42) |
| Android Developer, nothing stated | — / — | shown · `experience not stated` |
| Account Executive, "1-2 years" | 12 / 24 | hidden (Sales not chosen) |

With locations set to Bengaluru + Remote, a "2-4 years" engineering role in "Bangalore, India" shows (synonym), one in "Hyderabad" is hidden, and one marked remote shows.

**Ranking on the Jobs page:** `fits` → `stretch` → `not stated`, then newest first.

### 6.4 Location

- **The job's location comes from the source.** Greenhouse uses `location.name` (and `offices` with `content=true`). Lever uses `categories.location` and `workplaceType`. Ashby uses `location`, `secondaryLocations`, `isRemote` and `workplaceType`. Workable, SmartRecruiters and Workday each have a location field. JSON-LD uses `jobLocation` and `jobLocationType: TELECOMMUTE`.
- **Stored on the job:** `locations[]` (normalized city names) and `remote` (true when the source says remote, or the location text says `Remote`, `Work from home` or `Anywhere`).
- **City matching** is a lowercase whole-word compare after a small synonym table. Examples: `bengaluru` = `bangalore` = `blr`, `gurugram` = `gurgaon`, `mumbai` = `bombay`, `chennai` = `madras`, `kolkata` = `calcutta`. `delhi ncr` covers `new delhi`, `noida`, `gurugram` and `faridabad`. A user's city with no synonym entry is compared as typed, so any city works.
- **Hybrid** roles count as their city, not as remote.
- **A job with no location** passes, the same rule as an unstated experience requirement.

## 7. Step 5 — In the website

- **Nav:** two new routes, built the same way as `/jds` (`app/(app)/<route>/page.tsx`, a `components/<feature>/` folder with its workspace, list and detail pieces, a `hooks/use-….ts`, a `lib/api/endpoints/….ts`, and keys in `query-keys.ts`). Selection is a query parameter (`?id=…`), as the static export requires.
  - **`/companies`** — the setup route:
    - the preference inputs from §3.1;
    - upload, and add one row by hand;
    - the company list with status, edit link, remove, and "Refresh now" (rate-limited).
  - **`/jobs`** — the matches.
- **Matches (`/jobs`):** a list with New / Saved / All. Each row shows company, title, location, `2–4 yrs · fits`, and the date first seen. Actions:
  - **Open ↗** opens the posting.
  - **Tailor** saves the posting as a JD (`POST /api/jobs/{id}/jd`, truncated to 20,000 chars, JD quota applies) and opens `/tailor?jd=<new jd>`, where the user picks a resume.
  - **Dismiss**.
- **Settings:** a **Telegram** section (Connect / Disconnect, linked state).
- Keep it minimal: no explainer copy, no unused fields, limits enforced on the server.

## 8. Step 6 — Telegram

### 8.1 Setup (operator, once)

Create a bot with **@BotFather**. That gives `TELEGRAM_BOT_TOKEN` (a secret, env only, rule R-9) and the bot's username (`TELEGRAM_BOT_USERNAME`). Without a token, a `ConsoleNotifier` logs messages instead, like `ConsoleMailer`.

### 8.2 Linking a user (deep link, no typing codes)

1. Settings → **Connect Telegram** → `POST /api/telegram/link`. The server mints a random token (32 bytes, base64url, 43 chars: the `start` parameter allows `A-Z a-z 0-9 _ -`, ≤ 64 chars). Only its SHA-256 is stored in `auth_tokens` (`purpose="telegram_link"`, 10-minute TTL).
2. The UI opens `https://t.me/<bot>?start=<token>`. The user taps **Start** in Telegram.
3. The bot receives `/start <token>` → `AuthTokenStore.consume` (atomic, single use) → save `message.chat.id` on the user → reply "Connected. New matches will arrive here. Send /stop to disconnect."
4. `/stop` in Telegram or **Disconnect** in Settings clears the chat id.

A bot can only message users who started it, which this flow guarantees.

### 8.3 Receiving updates: long polling, not webhooks

A webhook needs Telegram to reach our URL. A **private** Hugging Face Space only answers requests carrying an HF token, which Telegram can't send. So the app uses **`getUpdates` long polling** from a background task:

- `timeout=50`, `allowed_updates=["message"]`.
- The `offset` is stored in Mongo; an update counts as confirmed once `getUpdates` is called with a higher offset.
- Call `deleteWebhook` once at start, because polling doesn't work while a webhook is set.
- The same Mongo lease as the crawler ensures one poller.
- This also works on a laptop with no public URL. Telegram keeps undelivered updates for **24 hours**, so a restart loses nothing.
- If the app is ever deployed publicly, switch to `setWebhook` with `secret_token` and check the `X-Telegram-Bot-Api-Secret-Token` header.

### 8.4 Sending

- **Sent when the crawl finishes.** Nothing goes out while the cycle is running. Once every due source has been crawled (say all 100 of a user's companies), each user gets **one** digest with every new match from that cycle, across all their companies. Only matches with `notified_at = null` are included, and users with no new matches get nothing. "Refresh now" works the same way: the digest goes out when that crawl finishes.
- **No floods.** A company's first crawl after it's added, and a recompute after the user changes preferences, mark their matches as already notified. They send one summary line instead ("23 matching openings — see RoleTeX").
- `sendMessage` with `parse_mode=HTML`: escape `& < >` in every posting string. Text is limited to 4,096 chars, so send about 10 jobs per message, then "and N more" with a link to `<PUBLIC_BASE_URL>/jobs`. Disable link previews.
- Respect the limits: ≤ 1 message/second per chat and about 30/second overall. On 429, wait for `retry_after`.
- **403** (user blocked the bot) or **400** chat not found → unlink automatically; Settings shows "Telegram disconnected".
- Set `notified_at` after a successful send, so a failure retries next cycle and nothing is sent twice.
- Messages carry job data only.

Example:

```text
3 new openings for you

Razorpay — Backend Engineer (SDE-2)
Bengaluru · 2–4 yrs · fits
https://jobs.lever.co/razorpay/…

Acme — Platform Engineer
Remote · 3.5+ yrs · stretch
https://boards.greenhouse.io/acme/jobs/…

All matches: https://<your RoleTeX>/jobs
```

## 9. Data model (MongoDB)

| Collection | Scope | Shape (main fields) | Indexes |
|---|---|---|---|
| `watchlist` | per user | `user_id, company_name, link, link_key` (normalized), `source_id?, status` (`checking`/`ready`/`unsupported`/`error`), `created_at, updated_at` | unique `(user_id, link_key)`; `source_id` |
| `career_sources` | shared | `key` (`greenhouse:razorpay`, `workday:acme.wd5/External`, `jsonld:https://…`), `kind, endpoint fields, next_crawl_at, last_crawled_at, last_status, consecutive_failures, open_jobs` | unique `key`; `next_crawl_at` |
| `jobs` | shared | `source_id, external_id, title, location` (as the source shows it), `locations[]` (normalized), `remote, department, url, description` (plain text ≤ 20k), `categories[], exp_min_months?, exp_max_months?, exp_basis` (`structured`/`text`/`title`/`none`), `first_seen_at, last_seen_at, closed_at?` | unique `(source_id, external_id)`; `(source_id, closed_at)` |
| `job_matches` | per user | `user_id, job_id, source_id, label` (`fits`/`stretch`/`unstated`), `state` (`new`/`seen`/`saved`/`dismissed`), `created_at, notified_at?` | unique `(user_id, job_id)`; `(user_id, state, created_at)` |
| `system_state` | global | `{_id: "crawler_lease"}`, `{_id: "telegram_offset"}` | — |
| `users` (fields added) | per user | `job_prefs: {categories[], exp_from_years, exp_to_years, margin_months, locations[], include_remote}`, `telegram: {chat_id, linked_at}` | — |
| `auth_tokens` (reused) | per user | `purpose="telegram_link"` | existing |

Every per-user query stays scoped by `user_id` inside the Mongo filter, as `db.py` does today. `DELETE /api/me` must also delete the user's `watchlist`, `job_matches`, Telegram link and link tokens. A periodic sweep removes `career_sources` nobody watches and their jobs.

## 10. API surface (proposed)

| Route | Purpose | Bucket |
|---|---|---|
| `GET /api/job-prefs` · `PUT /api/job-prefs` | read / save `{categories, exp_from_years, exp_to_years, margin_months, locations, include_remote}`; saving recomputes matches | general |
| `GET /api/job-categories` | the dropdown's fixed list | general |
| `GET /api/companies` · `POST /api/companies` | list / add one `{link, name?}` | general |
| `POST /api/companies/import` | multipart CSV/XLSX/PDF → `{added, duplicates, skipped[]}` | general; needs its own body cap in `_body_size_limit` |
| `PATCH /api/companies/{id}` · `DELETE /api/companies/{id}` | change link or name / remove | general |
| `POST /api/companies/refresh` | mark the user's sources due now | own small limit (e.g. once per 30 min) |
| `GET /api/jobs?state=` · `PATCH /api/jobs/{match_id}` | list matches / set `seen`/`saved`/`dismissed` | general |
| `POST /api/jobs/{match_id}/jd` | save the posting into the JD library → `{jd_id}` | general (JD quota) |
| `POST /api/telegram/link` · `DELETE /api/telegram` | deep link / unlink | general |

Errors follow the `{code, message}` contract (C-4): `invalid_job_prefs`, `company_quota_exceeded`, `invalid_company_file`, `unsupported_link`, `blocked_host`, `match_not_found`, `telegram_not_configured`, and so on. `/api/health` gains `crawler` (last cycle time) and `telegram` (`ok` / `not_configured`).

## 11. Where the code lives and how it runs

**Code location (decided):** `backend/app/crawler/`. It shares `db.py`, `config.py` and `security.py` with no import-path changes. This root `crawler/` folder only holds this plan; move the doc next to the code when building starts.

**Code shape:** a pure-Python package with no FastAPI in it.

- `fetch` — the SSRF-safe fetcher.
- `importers` — CSV/XLSX/PDF rows.
- `sources` — reading a link (§4).
- `ats/` — one small adapter per ATS: `detect(url)`, `list_jobs(source)`.
- `jsonld` — the generic page path.
- `classify` — categories and experience parsing.
- `match` — the §6.3 rule.
- `telegram` — notifier and poller.
- `cycle` — `run_cycle()`.

The backend adds the routes. Rules that apply: Python 3.9-compatible syntax (C-1); the fetcher, notifier and clock injectable through `create_app` (C-3) so everything runs offline with fixtures (T-1); bounded env config with README rows (C-5).

**Running it:**

| Option | Pros | Cons |
|---|---|---|
| **A. In-process loop** in the FastAPI lifespan (behind `CRAWLER_ENABLED`) — **chosen for v1** | One container (matches the architecture). "Refresh now" and the Telegram poller just work. $0 | A free HF Space **sleeps after 48 h without visits**, and crawls/alerts stop until someone opens it |
| B. `python -m … run-once` from a GitHub Actions cron | Independent of Space sleep; free minutes on the free plan | Telegram linking/polling and "refresh now" still need the app running; secrets (Mongo, bot token) also live in GitHub |
| C. Separate always-on worker host | Cleanest | Costs money or a free tier that may vanish; second deployment |

Building A. The same `run-once` entry point makes B a small add-on if Space sleep becomes a problem.

**Settings** (provisional names, all clamped per C-5):

| Name | Default | Range | Notes |
|---|---|---|---|
| `CRAWLER_ENABLED` | `false` | — | Off by default so dev servers don't crawl |
| `CRAWL_INTERVAL_HOURS` | `6` | 1–48 | |
| `CRAWL_CONCURRENCY` | `8` | 1–32 | global; per-host is always 1 |
| `CRAWL_TIMEOUT_SECONDS` | `15` | 5–60 | |
| `CRAWL_MAX_RESPONSE_BYTES` | `5000000` | 1–20 MB | |
| `MAX_COMPANIES_PER_USER` | `100` | 1–500 | |
| `MAX_COMPANY_IMPORT_BYTES` | `2000000` | 0.1–5 MB | |
| `JOB_RETENTION_DAYS` | `30` | 7–180 | closed jobs pruned after this |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | — | — | secret / public; unset → console notifier |
| `TELEGRAM_LINK_TTL_MINUTES` | `10` | 5–60 | |

The margin is a per-user preference (default 6), not an env setting. New dependencies: `openpyxl`, `defusedxml`. Everything else uses what's installed (`httpx`, `motor`) or the stdlib (`csv`, `html.parser`, `ipaddress`, `urllib.robotparser`).

## 12. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Who supplies careers links? | The user, in every row of the CSV / Excel / PDF. No discovery or guessing |
| 2 | Where do job type, experience and margin come from? | The user's inputs on `/companies`, saved per user. Not read from the resume |
| 3 | Job-type list | The §6.1 list as is. `Other` is not selectable for now |
| 4 | Location filter | Yes: optional cities + Remote (§6.4) |
| 5 | When does Telegram send? | When a crawl cycle finishes: one digest per user with all new matches from that run (§8.4) |
| 6 | Companies per user | 100 (`MAX_COMPANIES_PER_USER`) |
| 7 | Code location | `backend/app/crawler/` |
| 8 | Where the crawler runs | Inside the app (option A, §11) |
| 9 | Setup screen | Its own route, `/companies`, built like `/jds`; matches on `/jobs` |

Nothing is left open that blocks building phase 1.

## 13. Build phases

| Phase | Delivers |
|---|---|
| 1 | `/companies` route: preferences (job type, experience range, margin, location) + companies: watchlist model, CSV/XLSX/PDF/manual import, link → source detection, statuses |
| 2 | Crawler: SSRF-safe fetcher, lease, Greenhouse/Lever/Ashby/Workable/SmartRecruiters/Workday adapters, JSON-LD path, jobs upsert/close/prune, "refresh now" |
| 3 | Matching: category classification, experience parsing, §6.3 rule, Jobs page, "Tailor" → JD |
| 4 | Telegram: link/unlink, poller, digests, auto-unlink on 403 |
| 5 | Coverage: Keka/Recruitee after verifying their endpoints; Playwright for JS-only careers sites if needed |

Verification follows `docs/rules.md` §4. There is no test suite: drive the real routes with `httpx.ASGITransport` against `create_app()`, using a fixture fetcher (saved ATS JSON) and the console notifier, on a scratch `mongo:7`. The SSRF guard and HTML-to-text cleaning each get an explicit driven check (T-2). When this ships, update `docs/prd.md`, `architecture.md`, `design.md` and `memory.md`, plus the root README config table (M-5, C-5).

## 14. Risks

- **Coverage:** links to JS-only or bespoke career sites can't be read in v1. The `unsupported` status makes that visible instead of silently empty, and the user can swap in the job-board link.
- **Heuristics:** categories and experience come from keyword and pattern rules. Expect some `experience not stated` and an occasional wrong category. The label on every match (`2–4 yrs · fits`) keeps it explainable, and the keyword table is easy to extend.
- **Blocking:** big ATS hosts may throttle datacenter IPs. Low request volume, per-host serialization and backoff keep the footprint small.
- **Free-tier sleep:** with option A, alerts pause while the Space sleeps (§11).
- **ToS:** only official ATS feeds and the company's own pages are crawled; job aggregators are refused at import.

## Sources

- Telegram: [Bot features — deep linking](https://core.telegram.org/bots/features) · [Bot FAQ — rate limits, webhooks vs polling](https://core.telegram.org/bots/faq) · [Bot API — getUpdates, 24 h update retention](https://core.telegram.org/bots/api)
- ATS APIs: [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html) · [Lever postings API](https://github.com/lever/postings-api) · [Ashby public job posting API](https://developers.ashbyhq.com/docs/public-job-posting-api) · [SmartRecruiters Posting API](https://developers.smartrecruiters.com/docs/posting-api) · [Workable public jobs API (write-up)](https://dev.to/zsevic/integration-with-workable-public-jobs-api-3nk4) · [Workday CXS API page-size cap (write-up)](https://dev.to/juancarlosguti/ask-workdays-public-api-for-100-jobs-and-you-get-zero-with-no-error-54b2) · [Keka keyless jobs endpoint (open-source PR)](https://github.com/sarthakjain004/headstart/pull/529)
- Markup: [schema.org JobPosting](https://schema.org/JobPosting) · [Google job posting structured data](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
- Hosting: [HF Spaces sleep on free hardware](https://huggingface.co/docs/huggingface_hub/main/en/guides/manage-spaces) · [Private Spaces need a token](https://huggingface.co/docs/hub/spaces-api-endpoints)
