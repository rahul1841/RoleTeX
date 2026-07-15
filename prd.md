# PRD — JD Resume Builder ("RoleTeX")

> **Status:** Living document. Reflects the codebase as of 2026-07-14 (~80% of MVP complete, 87/87 tests passing).
> **Companion docs:** [architecture.md](architecture.md) · [design.md](design.md) · [rules.md](rules.md) · [memory.md](memory.md) · [plan.md](plan.md) (original validated feasibility plan)

---

## 1. Problem

Tailoring a resume to each job description is high-value but tedious, and doing it with an LLM naively is dangerous: models fabricate facts, mangle LaTeX, and require sending personal contact details to third-party APIs. Existing tools either give the model free rein over the whole document or produce untrustworthy output that still needs manual review.

**RoleTeX** solves this with a *constrained* tailoring pipeline: the LLM may only propose plain-text edits to a fixed set of editable fields; the server validates every proposal against a safety contract, renders it into a locked LaTeX template, and compiles the PDF itself in a sandbox.

## 2. One-line description

Paste a job description → an LLM proposes structured, fact-preserving edits (summary, ≤6 bullet rewrites, skills reordering) → the server validates, renders into a locked LaTeX template, compiles a one-page PDF with sandboxed Tectonic → the user reviews a before/after diff and downloads the PDF.

## 3. Goals

| # | Goal |
|---|---|
| G1 | Produce a genuinely tailored, ATS-readable, one-page PDF resume per JD |
| G2 | **Never** send identity/PII (name, email, phone, location, links) to the LLM during tailoring |
| G3 | Make fabrication structurally hard: unknown IDs, invented skills, and new numeric claims are rejected server-side |
| G4 | Make LaTeX injection impossible: the model returns plain text only; the server owns all LaTeX |
| G5 | Compile untrusted output safely: unique temp dir, `--untrusted`, `--only-cached`, timeouts, resource limits |
| G6 | Run at ~$0: free-tier LLM providers (Groq recommended; the code default is the offline `mock` provider), free compiler (Tectonic), free hosting (private Hugging Face Docker Space) |
| G7 | Let a user import their own LaTeX resume as a private per-user profile and tailor against it (multi-user extension) |

## 4. Non-goals

- A collaborative Overleaf-style LaTeX editor (explicitly out of scope in plan.md §1).
- Compiling arbitrary user-supplied LaTeX. Imported resumes are re-rendered into a **server-controlled** template; the raw paste is stored but never compiled.
- Public, unauthenticated deployment. The app assumes a private deployment (private HF Space or local).
- A real ATS score. Keyword/text checks are heuristics only.
- Durable PDF history (host disk is ephemeral).

## 5. Users

- **Primary:** the repo owner running a private instance with their own seed resume (`resume/data.json` + `resume/template.tex`).
- **Secondary (added beyond original plan):** additional users who import their own LaTeX resume via `POST /api/import` and receive a private UUID-keyed profile under `data/<uuid>/`.

## 6. User flows

### 6.1 Tailor (core flow)
1. User pastes a JD (50–20,000 chars) into the web UI, optionally with a stored `resume_id`.
2. Backend builds an LLM payload from editable resume facts — **identity excluded**.
3. LLM returns a structured proposal: `summary`, `bullet_rewrites` (≤6, each ≤600 chars), `skills_order`.
4. Server validates the proposal (see design.md §3). One semantic repair attempt is allowed on failure.
5. Server renders the locked template deterministically and compiles it with sandboxed Tectonic.
6. If the PDF exceeds the page target or compilation fails, one constrained repair may run (shared single-repair budget).
7. UI shows a before/after change list + embedded PDF preview (the API also returns a unified diff, which the UI does not currently render); user downloads the PDF or `.tex`.

### 6.2 Import (multi-user flow)
1. User pastes their full LaTeX resume (40–200,000 chars).
2. The **whole paste, including contact details, is sent to the LLM** — a deliberate, documented exception scoped to import only (the user is importing their own document).
3. LLM extracts structured facts + bounded style hints; the backend discards model-proposed IDs, assigns its own stable positional IDs, clamps style values to whitelists, and assembles a fully server-controlled template.
4. Profile persisted at `data/<uuid>/` (`data.json`, `template.tex`, `source.tex`, `meta.json`); the UUID is returned and kept in browser `localStorage`.
5. Subsequent tailor requests pass `resume_id` to use the imported profile (sectioned rendering).

## 7. Functional requirements

| ID | Requirement | Status |
|---|---|---|
| FR-1 | `POST /api/tailor` — JD in, validated proposal + diff + compiled PDF out | ✅ Done, tested |
| FR-2 | `POST /api/import` — pasted LaTeX in, private profile + extracted resume out | ✅ Done, tested |
| FR-3 | `GET /api/health` — resume validity, compiler availability, LLM config checks | ✅ Done, tested |
| FR-4 | `GET /api/resume/{id}` — fetch stored profile | ✅ Done, **untested** |
| FR-5 | Web UI: JD textarea, import pane, diff cards, PDF preview, PDF/.tex download | ✅ Done, **no automated coverage** |
| FR-6 | Provider adapter: mock, groq, cerebras, gemini, openrouter, mistral, openai, custom | ✅ Implemented; real-provider path **unexercised by tests** |
| FR-7 | One shared repair budget per request (semantic OR compile/page repair, never both) | ✅ Done, tested |
| FR-8 | Deterministic mock provider for offline dev/tests | ✅ Done, tested |
| FR-9 | Profile lifecycle (list/delete/TTL/quota) | ❌ Not built |
| FR-10 | Evaluation harness (compile success, fact preservation, keyword coverage across JDs) | ❌ Not built |
| FR-11 | Automatic provider failover | ❌ Not built (providers selectable, no fallback chain) |
| FR-12 | Cover letter generation | ❌ Not built |

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **PII:** identity never in LLM tailoring payloads; compiler diagnostics identity-redacted before any repair prompt; `data/` git-ignored and docker-ignored |
| NFR-2 | **Injection:** JD treated as untrusted data; strict response schema (`extra="forbid"`); server-side LaTeX escaping of all model text |
| NFR-3 | **Sandbox:** per-request temp dir, `tectonic --untrusted --only-cached`, bounded timeout (10–180s), POSIX rlimits, concurrency semaphore (1–4) |
| NFR-4 | **Availability:** graceful degraded health, structured API errors, 413 body guards (64KB API / 260KB import) |
| NFR-5 | **Cost:** runs within free tiers; no database; single Docker container |
| NFR-6 | **Compatibility:** Python 3.9+ (dev venv is 3.9), Pydantic v2 (≥2.9; the `validate_model`/`dump_model` shims keep call sites version-agnostic), ATS-readable PDF output |

## 9. Acceptance criteria (from plan.md §7, current status)

| Criterion | Status |
|---|---|
| Original template compiles unchanged | ✅ (verified manually with real Tectonic; suite mocks the compiler) |
| LLM cannot change preamble/contact header | ✅ (token-slot model; model never emits LaTeX) |
| Unknown IDs and skills rejected | ✅ tested |
| LaTeX special characters cannot break compilation | ✅ escaper unit-tested; end-to-end path manual only |
| Malicious JD instruction cannot change output schema | 🟡 architecture enforces it; no adversarial-JD test exists |
| Failed compile does not destroy last working source | 🟡 guaranteed by stateless design; not directly tested |
| Repair retry cannot modify protected regions | ✅ tested |
| Concurrent requests use different directories | ✅ tested |
| PDF remains ATS-readable | ✅ verified manually via `pdftotext` |
| User sees a diff before accepting | 🟡 server + UI implemented; UI untested, no hard accept-gate |

## 10. Current status & remaining work

**~80% of the MVP is complete.** The security-critical core (validation, rendering, sandboxed compile, PII handling) is built and tested; both the tailor and import flows have been verified end-to-end locally with a real Tectonic compile producing a valid one-page PDF.

Biggest remaining items, in priority order:
1. Prove the real-provider LLM path (Groq et al.) with at least one integration/eval run.
2. A Tectonic-gated real-compile test so CI can exercise the actual pipeline.
3. Frontend coverage (or at minimum a scripted browser smoke test).
4. Verified Docker build + HF deployment (cold start, cached compile, secrets, privacy).
5. Import storage lifecycle (list/delete/TTL/quota) and multi-file write atomicity.
6. Extend the fabrication guard beyond numeric claims.

See [memory.md](memory.md) for the full gap register and decision log.
