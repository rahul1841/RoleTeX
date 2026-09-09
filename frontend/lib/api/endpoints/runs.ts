/**
 * Tailoring runs: the history of every tailor the user has performed.
 *
 * A run stores the proposal, the change list, the rendered LaTeX source and
 * the JD excerpt, so an old run can be re-compiled without re-running the LLM.
 */

import { api, LONG_REQUEST_TIMEOUT_MS } from "../client";
import type {
  OkResponse,
  RunCompileResponse,
  RunListResponse,
  RunResponse,
} from "../types";

const base = "/api/runs";
const one = (id: string) => `${base}/${encodeURIComponent(id)}`;

export const listRuns = () => api.get<RunListResponse>(base);

export const getRun = (id: string) => api.get<RunResponse>(one(id));

export const deleteRun = (id: string) => api.delete<OkResponse>(one(id));

/**
 * Re-compile a stored run's LaTeX to a fresh PDF. No LLM call — but Tectonic
 * still runs, so this uses the long timeout.
 */
export const compileRun = (id: string, signal?: AbortSignal) =>
  api.post<RunCompileResponse>(`${one(id)}/compile`, undefined, {
    timeoutMs: LONG_REQUEST_TIMEOUT_MS,
    signal,
  });
