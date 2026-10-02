# Memory — RoleTeX

> The decisions behind the current code, and the gaps still open. Keep it current (rules.md M-5): edit or remove rows when they change — this is not a changelog.

## 1. Decisions in force

| ID | Decision | Why |
|---|---|---|
| D-1 | The LLM returns structured plain text; the server writes all LaTeX | No injection surface, smaller responses, deterministic rendering |
| D-2 | Token-slot templates: each token replaced exactly once, leftovers rejected | The model never produces LaTeX, so there is nothing to diff or hash-protect |
| D-3 | Tectonic 0.16.9 with `--untrusted --only-cached`, one Docker image, private Hugging Face Space as the target | Free, single binary, cacheable at build time |
| D-4 | One shared LLM repair per request (semantic, compile or page-shortening) | Caps cost and stops repair ping-pong (R-11) |
| D-5 | Import sends the whole document, contact details included, to the LLM; tailoring never does | The user is importing their own document (R-1, R-2) |
| D-6 | Imports are re-rendered into a server-assembled template; the original document is neither stored nor compiled | See §3 — user LaTeX cannot be compiled safely (R-5) |
| D-9 | The backend assigns positional IDs to imported and hand-written resumes; client or model IDs are discarded | IDs are a security contract the model must not control (R-12) |
| D-14 | Rate limits and the login throttle are in-memory, per process | Fits the single-container target (see G-12) |
| D-15 | Mongo failures return `503 database_unavailable`; index creation retries in the background; login runs full PBKDF2 even for unknown emails | The app boots without Mongo, and login timing reveals nothing |
| D-17 | Body size is capped by a pure-ASGI middleware that counts delivered bytes; `X-Forwarded-For` is trusted only when `TRUST_PROXY_HEADERS` is set; LLM routes also have a per-IP ceiling; validation errors never echo the request body | Chunked bodies can't bypass the cap; forged headers can't mint rate-limit buckets; new accounts can't mint LLM budget (R-10) |
| D-18 | Account email: pluggable mailer (SMTP, or console log when `SMTP_HOST` is unset); reset/verify tokens stored as SHA-256 and single-use; `PUBLIC_BASE_URL` required with SMTP; password change signs out other sessions, reset signs out all; `disabled` is checked only after the password | Host-header link poisoning is closed; no account oracle |
| D-19 | Hand-written resumes go through the same normalization as imports; errors name the field but never echo its value; the headline limit is enforced, not truncated; preview takes a draft or a stored id and uses the LLM/compile rate bucket | One trust boundary for every untrusted author; no model or key needed to own a resume |
| D-20 | PDF import sends the text layer, page images and link targets (`pdftohtml`) when the provider can see images; text-only providers get text with a warning; scans go as images only. Capped at 5 MB / 3 pages, checked before extraction | Images fix column order and missing text; the caps bound LLM cost |
| D-21 | The app uses the landing page's visual language (`PageHero`, `Canvas`). The review screen always shows the change list; only the output (PDF / diff / LaTeX) is tabbed. Saved-resume previews are HTML from stored facts, never a compile on mount | R-14, and a library of resumes costs no Tectonic runs |
| D-25 | Settings is one scrolling page, not tabs | Banners and error messages link straight into specific sections |
| D-26 | Every sign-up needs a 6-digit code mailed to the address (10 min, 5 guesses, stored as an HMAC keyed by `APP_SECRET_KEY`); the code endpoint answers the same for registered addresses. New passwords need 8–128 chars, lower/upper/digit/symbol, not a common password, not the email name — checked when set, never at sign-in | Every account starts verified; no registration oracle; existing accounts keep working |
| D-27 | No automated test suite; verification follows rules.md §4 | Deliberate — don't recreate `tests/` |
| D-28 | Users choose the model per provider (`provider_models`); the registry's model names are only fallbacks. Grid is left as is — no model picker, still configured by `GRID_BASE_URL` / `GRID_MODEL` | Model catalogues change faster than releases. Grid is a temporary exception the owner will remove |
| D-29 | MongoDB is required: the server refuses to start without `MONGODB_URI`, and tailoring always needs an owned `resume_id` | Every feature is per-user, so there is nothing to serve without a database |
| D-30 | Resumes and job descriptions are single documents with no version history. A resume: Save overwrites it, "Save as new resume" copies it, and a tailoring result can be kept either way (`POST /api/resumes/{id}/tailored`, re-validated server-side) | Old versions were only visible as raw LaTeX and could not be restored or tailored, so they cost a 20-save cap for no user value; runs keep their own LaTeX |

## 2. Open gaps

🔴 blocks confidence in a core promise · 🟠 fix before a real deployment · 🟡 nice to have

| # | Sev | Gap |
|---|---|---|
| G-1 | 🔴 | No real LLM provider has ever been called (HTTP, retries, JSON mode, extraction, vision). Tailoring quality is unproven |
| G-4 | 🟠 | Docker image, cold start and Hugging Face deploy are unverified; the image has no Node stage, so it serves no frontend; no dependency lockfile |
| G-19 | 🟠 | `SmtpMailer` has never talked to a real SMTP server — and sign-up now depends on it |
| G-5 | 🟠 | The fabrication guard only catches new numbers; an invented employer, tool or credential passes |
| G-12 | 🟠 | Rate-limit state is per process; multiple replicas would need a shared store |
| G-11 | 🟡 | Not built: evaluation harness, provider failover, cover letters |
| G-13 | 🟡 | Rotating `APP_SECRET_KEY` makes every stored user key unreadable; no re-encryption tool |
| G-18 | 🟡 | `default_provider` can be set to `custom`, which has no storable key; public `/api/health` shows provider, model and version |
| G-20 | 🟡 | No admin UI for disabling an account — edit the user document in MongoDB |
| G-21 | 🟡 | The builder requires a phone number and location (shared `ResumeIdentity` schema) |
| G-22 | 🟡 | Editing a resume in the app drops per-bullet links; only the seed resume has any |
| G-24 | 🟡 | `RLIMIT_AS` is Linux-only, so compiles have no memory cap on macOS |

## 3. Rejected

- **Compiling user-supplied LaTeX.** `--untrusted` only disables shell-escape: `\input` of an absolute path still reads any file the process can see (e.g. `/proc/self/environ`, which holds `MONGODB_URI` and `APP_SECRET_KEY`) and `\openout` writes anywhere. Blocklists are bypassable, and `--only-cached` rejects most real templates' packages anyway (`fontawesome5`, `fontspec`, `titlesec`, `paracol`). If layout fidelity is ever needed: a richer bounded style profile, a server-side template gallery, or a client-side WASM compile.
- **Public deployment** — see rules.md M-3.

## 4. Next steps

1. G-1 — one real-provider run (Groq) and a small repeatable eval set.
2. G-19 — send real mail through SMTP; no deployment can sign users up without it.
3. G-4 — build the image with a frontend stage, verify a private deployment, add a lockfile.
4. G-5 — extend the fabrication guard beyond numbers.
