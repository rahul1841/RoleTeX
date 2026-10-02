/** Job description endpoints. PUT overwrites the stored text. */

import { api } from "../client";
import type {
  JdCreateRequest,
  JdListResponse,
  JdResponse,
  JdUpdateRequest,
  OkResponse,
} from "../types";

const base = "/api/jds";
const one = (id: string) => `${base}/${encodeURIComponent(id)}`;

export const listJds = () => api.get<JdListResponse>(base);

export const getJd = (id: string) => api.get<JdResponse>(one(id));

export const createJd = (body: JdCreateRequest) =>
  api.post<JdResponse>(base, body);

export const updateJd = (id: string, body: JdUpdateRequest) =>
  api.put<JdResponse>(one(id), body);

export const deleteJd = (id: string) => api.delete<OkResponse>(one(id));
