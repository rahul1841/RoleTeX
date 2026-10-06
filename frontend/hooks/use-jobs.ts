"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getJob,
  getTelegram,
  linkTelegram,
  listJobs,
  saveJobAsJd,
  unlinkTelegram,
  updateJob,
} from "@/lib/api/endpoints/jobs";
import { queryKeys } from "@/lib/api/query-keys";
import type { JobMatch, JobMatchDetail, JobMatchUpdateRequest } from "@/lib/api/types";

/**
 * Matched jobs and the Telegram link.
 *
 * INVALIDATION CONTRACT
 *   state change  ->  seed detail(id) from the response, invalidate both lists
 *   save as JD    ->  invalidate the JD list (a new JD exists)
 *   link/unlink   ->  invalidate telegram
 */

export function useJobs(state: "all" | "saved") {
  return useQuery({
    queryKey: queryKeys.jobs.list(state),
    queryFn: () => listJobs(state),
    select: (response): JobMatch[] => response.jobs ?? [],
  });
}

export function useJob(id: string | null) {
  return useQuery({
    queryKey: queryKeys.jobs.detail(id ?? ""),
    queryFn: () => getJob(id as string),
    enabled: Boolean(id),
    select: (response): JobMatchDetail => response.job,
  });
}

export function useUpdateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: JobMatchUpdateRequest }) =>
      updateJob(id, body),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.jobs.detail(response.job.id), response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.list("all") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.list("saved") });
    },
  });
}

export function useSaveJobAsJd() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => saveJobAsJd(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jds.list });
    },
  });
}

/** Polls while a link is pending so the screen flips to "connected" by itself. */
export function useTelegram(pollWhilePending = false) {
  return useQuery({
    queryKey: queryKeys.telegram,
    queryFn: getTelegram,
    refetchInterval: (query) =>
      pollWhilePending && !query.state.data?.linked ? 3_000 : false,
  });
}

export function useLinkTelegram() {
  return useMutation({ mutationFn: linkTelegram });
}

export function useUnlinkTelegram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unlinkTelegram,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.telegram });
    },
  });
}
