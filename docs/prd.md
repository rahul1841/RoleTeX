# PRD — RoleTeX

> What the product does and why. How it works: [architecture.md](architecture.md) · [design.md](design.md). Invariants: [rules.md](rules.md). Open gaps: [memory.md](memory.md).

## 1. Problem

Tailoring a resume to each job is valuable but tedious, and doing it naively with an LLM is risky: models invent facts, break LaTeX, and need your contact details. RoleTeX constrains the model to plain-text edits of fields that already exist, validates every edit on the server, renders into a locked LaTeX template, and compiles the PDF itself in a sandbox.

**In one line:** paste a job description → the model proposes a new headline, bullet rewrites and a skill order → the server validates, renders and compiles a one-page PDF → you review every change and download.

## 2. Goals

| # | Goal |
|---|---|
| G1 | A tailored, ATS-readable, one-page PDF per job description |
| G2 | Never send contact details to the LLM while tailoring |
| G3 | Make fabrication hard: unknown IDs, invented skills and new numbers are rejected |
| G4 | Make LaTeX injection impossible: the model returns plain text; the server writes all LaTeX |
| G5 | Compile safely: temp dir per job, `--untrusted`, `--only-cached`, timeouts, resource limits |
| G6 | Run at ~$0: free-tier LLMs, Tectonic, free MongoDB tier, a private Hugging Face Space |
| G7 | Import an existing resume (LaTeX or PDF) into a private, versioned library |
| G8 | Write a resume in the app and get a PDF with no AI key |

## 3. Non-goals

- A collaborative Overleaf-style editor.
- Compiling user-supplied LaTeX — imports are re-rendered into a server-controlled template.
- A real ATS score (keyword checks are heuristics).
- Storing PDFs — runs keep the LaTeX and recompile on demand.

## 4. Users

Email + password accounts, stored in MongoDB (`MONGODB_URI` is required). Each user has private resume and job-description libraries, tailoring history, and their own provider keys (encrypted at rest).

## 5. Flows

- **Sign up** — details → a 6-digit code emailed to the address → account created, already verified. Passwords need 8–128 characters with a lowercase letter, an uppercase letter, a number and a symbol.
- **Write a resume** — contact details, a one-line headline, experience, projects, education, skills, achievements, custom sections, plus font size, margins and accent colour (always A4); live PDF preview; no model call.
- **Import a resume** — paste LaTeX or upload a PDF (≤5 MB, ≤3 pages). **The whole document, contact details included, is sent to the LLM** to extract structured fields — the one deliberate exception to G2, scoped to import only. The result is reviewed and edited like a hand-written resume.
- **Save job descriptions** — a library with version history.
- **Tailor** — pick a resume and a job description (saved or pasted) → the model proposes edits → the server validates, renders and compiles → the review shows every change beside the PDF, unified diff and LaTeX (R-14). Runs are saved to history.
- **History** — reopen any run, re-read its changes, and recompile its PDF without an LLM call.
- **Account** — change password, reset by email, verify email, delete the account.

## 6. Requirements

**Built:** everything in §5; provider keys for Groq, Cerebras, Gemini, OpenRouter, Mistral, OpenAI, Anthropic, Grid and a custom endpoint; per-user and per-IP rate limits, a login throttle and a CSRF origin check; quotas on resumes, versions, job descriptions and runs; an offline stub LLM for development.

**Not built:** evaluation harness, automatic provider failover, cover letters, an admin UI for disabling accounts.

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Privacy | No contact details in tailoring prompts; compiler logs redacted before any repair prompt; resume data lives only in MongoDB |
| Injection | The job description is untrusted data; strict response schema; all model text escaped |
| Sandbox | Temp dir per compile, `tectonic --untrusted --only-cached`, 10–180 s timeout, POSIX resource limits, 1–4 concurrent compiles |
| Robustness | Structured JSON errors; health reports `degraded` rather than failing; request bodies capped (64 KB API, 260 KB import, 5 MB + overhead PDF) |
| Cost | Free tiers; one Docker container |
| Compatibility | Python 3.9+; Pydantic v2; Node 20.9+ for the frontend; ATS-readable PDF output |
