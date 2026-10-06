"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCompany,
  deleteCompany,
  getJobPrefs,
  importCompanies,
  listCompanies,
  putJobPrefs,
  refreshCompanies,
  updateCompany,
} from "@/lib/api/endpoints/companies";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  Company,
  CompanyCreateRequest,
  CompanyUpdateRequest,
  JobPrefs,
} from "@/lib/api/types";

/**
 * Job-watch setup state: preferences and the company list.
 *
 * INVALIDATION CONTRACT
 *   save prefs        ->  seed jobPrefs, invalidate jobs (the server recomputed matches)
 *   add / import      ->  invalidate companies and jobs
 *   edit / delete     ->  invalidate companies and jobs
 *   refresh           ->  invalidate companies (the crawl runs in the background)
 *
 * Crawling happens after the request returns, so `useCompanies` polls while a
 * company is still being read for the first time (see `refetchInterval`), and
 * the screen keeps polling for a short while after a refresh.
 */

const POLL_MS = 5_000;

function stillCrawling(companies: Company[]): boolean {
  return companies.some(
    (company) =>
      company.status === "checking" ||
      (company.status === "ready" && !company.last_crawled_at),
  );
}

export function useJobPrefs() {
  return useQuery({ queryKey: queryKeys.jobPrefs, queryFn: getJobPrefs });
}

export function useSaveJobPrefs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: JobPrefs) => putJobPrefs(body),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.jobPrefs, response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

/** `pollUntil` keeps polling until that time even when nothing looks pending. */
export function useCompanies(pollUntil = 0) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.companies,
    queryFn: async () => {
      const response = await listCompanies();
      // A finished crawl can have produced matches; the Jobs screen should
      // not wait for its own refetch to show them.
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      return response;
    },
    select: (response): Company[] => response.companies ?? [],
    refetchInterval: (query) => {
      const companies = query.state.data?.companies ?? [];
      return stillCrawling(companies) || Date.now() < pollUntil ? POLL_MS : false;
    },
  });
}

function useInvalidateAfterWrite() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies });
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
  };
}

export function useCreateCompany() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: (body: CompanyCreateRequest) => createCompany(body),
    onSuccess: invalidate,
  });
}

export function useImportCompanies() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: (file: File) => importCompanies(file),
    onSuccess: invalidate,
  });
}

export function useUpdateCompany() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CompanyUpdateRequest }) =>
      updateCompany(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteCompany() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: (id: string) => deleteCompany(id),
    onSuccess: invalidate,
  });
}

export function useRefreshCompanies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refreshCompanies,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies });
    },
  });
}
