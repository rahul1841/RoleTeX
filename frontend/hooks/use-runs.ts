"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  compileRun,
  deleteRun,
  getRun,
  listRuns,
} from "@/lib/api/endpoints/runs";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  RunCompileResponse,
  RunDetail,
  RunListResponse,
  RunResponse,
  RunSummary,
} from "@/lib/api/types";

/**
 * Tailoring history: the list, one run, and the two writes it supports.
 *
 * A run is an immutable record — the server writes it once when the tailor
 * completes and never touches it again. Re-compiling reads the stored LaTeX
 * and returns a PDF without updating the document, and deleting removes it
 * outright. That shape decides the caching below: the detail is cached
 * forever, and only the delete invalidates anything.
 */

/**
 * Newest first, defensively.
 *
 * `GET /api/runs` already returns descending order, but the list is the
 * screen's spine — a server change to that ordering should not silently
 * scramble the history. Runs with no `created_at` sort last rather than
 * jumping to the top on `NaN`.
 */
function selectRuns(response: RunListResponse): RunSummary[] {
  const runs = [...(response.runs ?? [])];
  runs.sort((a, b) => runTime(b) - runTime(a));
  return runs;
}

function runTime(run: RunSummary): number {
  if (!run.created_at) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(run.created_at);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function selectRun(response: RunResponse): RunDetail {
  return response.run;
}

/** `GET /api/runs`. Multi-user only; the page gates on storage before mounting. */
export function useRuns() {
  return useQuery({
    queryKey: queryKeys.runs.list,
    queryFn: listRuns,
    select: selectRuns,
  });
}

/**
 * `GET /api/runs/{id}` for the run named in `?run=`.
 *
 * Disabled while nothing is selected, so the two-pane screen does not fire a
 * request for `undefined` on first paint. `staleTime: Infinity` because a
 * stored run cannot change — refetching it on every reselect would re-download
 * the whole LaTeX source to redraw identical bytes.
 */
export function useRun(runId: string | null) {
  return useQuery({
    queryKey: queryKeys.runs.detail(runId ?? ""),
    queryFn: () => getRun(runId as string),
    enabled: Boolean(runId),
    select: selectRun,
    staleTime: Infinity,
  });
}

/**
 * `POST /api/runs/{id}/compile` — re-render the stored LaTeX to a fresh PDF.
 *
 * No LLM call and no tokens spent, but Tectonic runs for real, so the endpoint
 * helper uses the long timeout and this is never retried or fired optimistically.
 * Nothing is invalidated: the run document is not modified by a re-compile.
 *
 * The failure modes the caller must tell apart all arrive as `ApiError.code`:
 * `run_has_no_latex` (nothing to compile), `latex_compile_failed` (the source
 * is bad), `compiler_not_found` (this deployment has no Tectonic at all).
 */
export function useCompileRun() {
  return useMutation<RunCompileResponse, Error, string>({
    mutationFn: (runId: string) => compileRun(runId),
  });
}

/**
 * `DELETE /api/runs/{id}`.
 *
 * Not optimistic: the list is the record of work already done, and briefly
 * showing a run as gone when the server refused would be worse than the
 * moment of latency. The caller owns the failure message — <ConfirmDialog>
 * reports nothing when `onConfirm` rejects.
 */
export function useDeleteRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: string) => deleteRun(runId),
    onSuccess: (_data, runId) => {
      queryClient.removeQueries({ queryKey: queryKeys.runs.detail(runId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.list });
    },
  });
}
