/**
 * Resume endpoints: list, create (three ways), edit, save a tailored result,
 * preview, delete.
 *
 * ⚠️ Read/write asymmetry. `GET` returns `ResumeData` (server-owned ids on every
 * entry; bullets are `{ id, text }` objects). Writes take `ResumeDraft` (no ids
 * anywhere; bullets are plain strings). Request models are Pydantic
 * `extra="forbid"`, so sending a `ResumeData` back is a 422 `invalid_request`.
 * Convert with `lib/api/mappers.ts`.
 */

import { api, LONG_REQUEST_TIMEOUT_MS } from "../client";
import type {
  OkResponse,
  ResumeContentUpdateRequest,
  ResumeCreateRequest,
  ResumeCreateResponse,
  ResumeListResponse,
  ResumeManualCreateRequest,
  ResumePreviewRequest,
  ResumePreviewResponse,
  ResumeRenameRequest,
  ResumeResponse,
  TailoredResumeSaveRequest,
} from "../types";

const base = "/api/resumes";
const one = (id: string) => `${base}/${encodeURIComponent(id)}`;

export const listResumes = () => api.get<ResumeListResponse>(base);

export const getResume = (id: string) => api.get<ResumeResponse>(one(id));

/**
 * Import from pasted LaTeX. Runs an LLM extraction, so it needs the long
 * timeout and a configured provider key.
 */
export const createResumeFromLatex = (body: ResumeCreateRequest) =>
  api.post<ResumeCreateResponse>(base, body, {
    timeoutMs: LONG_REQUEST_TIMEOUT_MS,
  });

/** Create from the builder form. No LLM call, so no provider key is required. */
export const createResumeManual = (body: ResumeManualCreateRequest) =>
  api.post<ResumeCreateResponse>(`${base}/manual`, body);

export interface PdfImportOptions {
  file: File;
  /** Optional display name; the server derives one when omitted. */
  name?: string;
  provider?: string;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Import from an uploaded PDF (multipart). The server re-checks size, magic
 * bytes and page count, then extracts text (and page images for vision-capable
 * providers) before the LLM call.
 */
export const createResumeFromPdf = ({
  file,
  name,
  provider,
  model,
  signal,
}: PdfImportOptions) => {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  if (provider) form.append("provider", provider);
  if (model) form.append("model", model);
  return api.upload<ResumeCreateResponse>(`${base}/pdf`, form, { signal });
};

/** Rename only. Content changes go through `updateResumeContent`. */
export const renameResume = (id: string, body: ResumeRenameRequest) =>
  api.patch<ResumeResponse>(one(id), body);

export const deleteResume = (id: string) => api.delete<OkResponse>(one(id));

/** Overwrites an existing resume's content. */
export const updateResumeContent = (
  id: string,
  body: ResumeContentUpdateRequest,
) => api.put<ResumeCreateResponse>(`${one(id)}/content`, body);

/**
 * Keep a tailoring result: as a new resume (`mode: "new"`) or by overwriting
 * the resume it was tailored from. The server re-validates the proposal, so a
 * resume edited since the run answers 409 `resume_changed`.
 */
export const saveTailoredResume = (id: string, body: TailoredResumeSaveRequest) =>
  api.post<ResumeCreateResponse>(`${one(id)}/tailored`, body);

/**
 * Compile a preview PDF. Accepts either a stored `resume_id` or an unsaved
 * `resume` draft, so the builder can preview before anything is saved.
 * Runs Tectonic, so it uses the long timeout.
 */
export const previewResume = (
  body: ResumePreviewRequest,
  signal?: AbortSignal,
) =>
  api.post<ResumePreviewResponse>(`${base}/preview`, body, {
    timeoutMs: LONG_REQUEST_TIMEOUT_MS,
    signal,
  });
