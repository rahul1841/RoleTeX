/** Job-watch setup: preferences and the company list. */

import { api } from "../client";
import type {
  CompanyCreateRequest,
  CompanyImportResponse,
  CompanyListResponse,
  CompanyRefreshResponse,
  CompanyResponse,
  CompanyUpdateRequest,
  JobPrefs,
  JobPrefsResponse,
  OkResponse,
} from "../types";

const base = "/api/companies";
const one = (id: string) => `${base}/${encodeURIComponent(id)}`;

export const getJobPrefs = () => api.get<JobPrefsResponse>("/api/job-prefs");

export const putJobPrefs = (body: JobPrefs) =>
  api.put<JobPrefsResponse>("/api/job-prefs", body);

export const listCompanies = () => api.get<CompanyListResponse>(base);

export const createCompany = (body: CompanyCreateRequest) =>
  api.post<CompanyResponse>(base, body);

export const updateCompany = (id: string, body: CompanyUpdateRequest) =>
  api.patch<CompanyResponse>(one(id), body);

export const deleteCompany = (id: string) => api.delete<OkResponse>(one(id));

/** CSV, Excel (.xlsx) or PDF; the server detects the format from the bytes. */
export const importCompanies = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.upload<CompanyImportResponse>(`${base}/import`, form);
};

export const refreshCompanies = () =>
  api.post<CompanyRefreshResponse>(`${base}/refresh`);
