/** Matched jobs and the Telegram link. */

import { api } from "../client";
import type {
  JobMatchListResponse,
  JobMatchResponse,
  JobMatchUpdateRequest,
  JobSaveJdResponse,
  OkResponse,
  TelegramLinkResponse,
  TelegramStatus,
} from "../types";

const base = "/api/jobs";
const one = (id: string) => `${base}/${encodeURIComponent(id)}`;

/** `all` is every match not dismissed; closed postings show only when saved. */
export const listJobs = (state: "all" | "saved") =>
  api.get<JobMatchListResponse>(`${base}?state=${state}`);

export const getJob = (id: string) => api.get<JobMatchResponse>(one(id));

export const updateJob = (id: string, body: JobMatchUpdateRequest) =>
  api.patch<JobMatchResponse>(one(id), body);

/** Copies the posting into the JD library; tailoring then works as usual. */
export const saveJobAsJd = (id: string) =>
  api.post<JobSaveJdResponse>(`${one(id)}/jd`);

export const getTelegram = () => api.get<TelegramStatus>("/api/telegram");

export const linkTelegram = () =>
  api.post<TelegramLinkResponse>("/api/telegram/link");

export const unlinkTelegram = () => api.delete<OkResponse>("/api/telegram");
