/**
 * Job description endpoints.
 *
 * JDs are versioned: PUT replaces the current text and records a new version
 * rather than overwriting history, so `listJdVersions` can show the trail.
 */

import { api } from "../client";
import type {
  JdCreateRequest,
  JdListResponse,
  JdResponse,
  JdUpdateRequest,
  JdVersionsResponse,
  OkResponse,
} from "../types";

const base = "/api/jds";
const one = (id: string) => `${base}/${encodeURIComponent(id)}`;

export const listJds = () => api.get<JdListResponse>(base);

export const getJd = (id: string) => api.get<JdResponse>(one(id));

export const createJd = (body: JdCreateRequest) =>
  api.post<JdResponse>(base, body);

/** Editing an existing JD creates a new version of it. */
export const updateJd = (id: string, body: JdUpdateRequest) =>
  api.put<JdResponse>(one(id), body);

export const deleteJd = (id: string) => api.delete<OkResponse>(one(id));

export const listJdVersions = (id: string) =>
  api.get<JdVersionsResponse>(`${one(id)}/versions`);
