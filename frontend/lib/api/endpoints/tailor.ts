/**
 * The product's core operation: tailor a resume to a job description.
 *
 * One call runs an LLM completion AND (unless `compile: false`) a Tectonic
 * compile, so it legitimately takes minutes and always uses the long timeout.
 *
 * The response carries the change list and unified diff alongside the PDF.
 * rules.md R-14 makes showing those mandatory — never auto-apply silently.
 */

import { api, LONG_REQUEST_TIMEOUT_MS } from "../client";
import type { TailorRequest, TailorResponse } from "../types";

export const tailor = (body: TailorRequest, signal?: AbortSignal) =>
  api.post<TailorResponse>("/api/tailor", body, {
    timeoutMs: LONG_REQUEST_TIMEOUT_MS,
    signal,
  });
