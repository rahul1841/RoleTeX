/**
 * Named aliases over the generated OpenAPI schema.
 *
 * `schema.d.ts` is generated from the running FastAPI app (`npm run gen:api`)
 * and must never be hand-edited. This file only gives its types readable names
 * and documents the traps.
 */

import type { components } from "./schema";

type S = components["schemas"];

// ---------------------------------------------------------------------------
// Session and account
// ---------------------------------------------------------------------------

export type User = S["UserOut"];
export type UserResponse = S["UserResponse"];
export type HealthResponse = S["HealthResponse"];
export type SessionInfo = S["SessionInfo"];
export type SessionListResponse = S["SessionListResponse"];

export type LoginRequest = S["LoginRequest"];
export type RegisterRequest = S["RegisterRequest"];
export type ChangePasswordRequest = S["ChangePasswordRequest"];
export type ForgotPasswordRequest = S["ForgotPasswordRequest"];
export type ResetPasswordRequest = S["ResetPasswordRequest"];
export type VerifyEmailRequest = S["VerifyEmailRequest"];
export type UpdateMeRequest = S["UpdateMeRequest"];
export type DeleteMeRequest = S["DeleteMeRequest"];

/**
 * `GET /api/health` reports which mode the server is in. Nearly every screen
 * branches on this: in `demo` there is no database, so accounts, saved
 * resumes, JDs and history are all unavailable.
 */
export type AppMode = "demo" | "multi_user";

// ---------------------------------------------------------------------------
// Providers and keys
// ---------------------------------------------------------------------------

export type ProviderInfo = S["ProviderInfo"];
export type ProvidersResponse = S["ProvidersResponse"];
export type KeyInfo = S["KeyInfo"];
export type KeysResponse = S["KeysResponse"];
export type PutKeyRequest = S["PutKeyRequest"];
export type PutKeyResponse = S["PutKeyResponse"];

// ---------------------------------------------------------------------------
// Resumes
// ---------------------------------------------------------------------------

/**
 * ⚠️ READ SHAPE. What the server returns for a stored resume.
 *
 * Every entry and bullet carries a server-owned `id`, and bullets are objects
 * (`{ id, text }`), not strings.
 */
export type ResumeData = S["ResumeData"];

/**
 * ⚠️ WRITE SHAPE. What the server accepts when creating or updating a resume.
 *
 * `ResumeDraft` has NO `id` anywhere, and its bullets are plain `string`s.
 * Every request model on this API is Pydantic `extra="forbid"`, so posting a
 * `ResumeData` straight back — the reflexive "fetch, bind to form, PUT it" —
 * is a guaranteed 422 `invalid_request`.
 *
 * Convert with the mappers in `lib/api/mappers.ts`; never cast between them.
 */
export type ResumeDraft = S["ResumeDraft"];

export type ResumeBullet = S["ResumeBullet"];
export type ResumeExperience = S["ResumeExperience"];
export type ResumeProject = S["ResumeProject"];
export type ResumeEducation = S["ResumeEducation"];
export type ResumeSkillCategory = S["ResumeSkillCategory"];
export type ResumeCustomSection = S["ResumeCustomSection"];
export type ResumeIdentity = S["ResumeIdentity"];
export type ResumeLink = S["ResumeLink"];

export type ResumeDraftExperience = S["ResumeDraftExperience"];
export type ResumeDraftProject = S["ResumeDraftProject"];
export type ResumeDraftEducation = S["ResumeDraftEducation"];
export type ResumeDraftSkillCategory = S["ResumeDraftSkillCategory"];
export type ResumeDraftCustomSection = S["ResumeDraftCustomSection"];
export type ResumeDraftIdentity = S["ResumeDraftIdentity"];
export type ResumeDraftLink = S["ResumeDraftLink"];

export type ResumeStyle = S["ResumeStyle"];
export type ResumeStyleInput = S["ResumeStyleInput"];

export type ResumeSummary = S["ResumeSummary"];
export type ResumeDetail = S["ResumeDetail"];
export type ResumeListResponse = S["ResumeListResponse"];
export type ResumeResponse = S["ResumeResponse"];
export type ResumeCreateRequest = S["ResumeCreateRequest"];
export type ResumeCreateResponse = S["ResumeCreateResponse"];
export type ResumeManualCreateRequest = S["ResumeManualCreateRequest"];
export type ResumeContentUpdateRequest = S["ResumeContentUpdateRequest"];
export type ResumeRenameRequest = S["ResumeRenameRequest"];
export type ResumePreviewRequest = S["ResumePreviewRequest"];
export type ResumePreviewResponse = S["ResumePreviewResponse"];
export type ResumeVersionSummary = S["ResumeVersionSummary"];
export type ResumeVersionsResponse = S["ResumeVersionsResponse"];
export type ResumeVersionSourceResponse = S["ResumeVersionSourceResponse"];

// ---------------------------------------------------------------------------
// Job descriptions
// ---------------------------------------------------------------------------

export type JdSummary = S["JdSummary"];
export type JdDetail = S["JdDetail"];
export type JdListResponse = S["JdListResponse"];
export type JdResponse = S["JdResponse"];
export type JdCreateRequest = S["JdCreateRequest"];
export type JdUpdateRequest = S["JdUpdateRequest"];
export type JdVersionSummary = S["JdVersionSummary"];
export type JdVersionsResponse = S["JdVersionsResponse"];

// ---------------------------------------------------------------------------
// Tailoring and runs
// ---------------------------------------------------------------------------

export type TailorRequest = S["TailorRequest"];
export type TailorResponse = S["TailorResponse"];
export type TailorProposal = S["TailorProposal"];
export type BulletRewrite = S["BulletRewrite"];

/**
 * One reviewable edit the model proposed. rules.md R-14 requires the UI to
 * show these alongside the PDF — never silently auto-apply a tailoring.
 */
export type ResumeChange = S["ResumeChange"];

export type RunSummary = S["RunSummary"];
export type RunDetail = S["RunDetail"];
export type RunListResponse = S["RunListResponse"];
export type RunResponse = S["RunResponse"];
export type RunCompileResponse = S["RunCompileResponse"];
export type CompilerReport = S["CompilerReport"];

// ---------------------------------------------------------------------------
// Generic envelopes
// ---------------------------------------------------------------------------

export type OkResponse = S["OkResponse"];
export type RevokedResponse = S["RevokedResponse"];
export type MailDispatchResponse = S["MailDispatchResponse"];
