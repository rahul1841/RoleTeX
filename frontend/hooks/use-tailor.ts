"use client";

/**
 * The tailoring run: everything the workspace needs to start one, watch one,
 * and stop one.
 *
 * `POST /api/tailor` is the most expensive call in the product. One request
 * runs an LLM completion AND a Tectonic compile server-side, so it legitimately
 * takes minutes and costs real provider tokens. Three consequences are baked in
 * here rather than left to each caller:
 *
 *  1. NEVER RETRIED. `retry: false` is already the mutation default in
 *     app/providers.tsx; this hook additionally never re-fires on its own.
 *     A second attempt is always an explicit human decision.
 *  2. CANCELLABLE. The controller lives in a ref rather than in state so
 *     aborting never depends on a re-render having happened first.
 *  3. HONEST ABOUT PROGRESS. The server does not stream, so `useRunProgress`
 *     reports real elapsed time and clearly-labelled *typical* stages. It never
 *     invents a percentage.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listJds } from "@/lib/api/endpoints/jds";
import { listProviders } from "@/lib/api/endpoints/keys";
import { listResumes } from "@/lib/api/endpoints/resumes";
import { tailor } from "@/lib/api/endpoints/tailor";
import { queryKeys } from "@/lib/api/query-keys";
import type { TailorRequest, TailorResponse } from "@/lib/api/types";

/**
 * `TailorRequest.job_description` is `min_length=50, max_length=20_000` in
 * app/schemas.py. Mirrored here so the form rejects what the server would,
 * with copy the user can act on instead of a raw 422.
 */
export const JD_MIN_CHARACTERS = 50;
export const JD_MAX_CHARACTERS = 20_000;

/**
 * True for the DOMException fetch throws when the caller aborts.
 *
 * Not an error condition: the user pressed Cancel. Checked structurally rather
 * than with `instanceof DOMException` so it also holds for the wrapped shapes
 * `AbortSignal.any` can surface.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

// ---------------------------------------------------------------------------
// The inputs a run is assembled from
// ---------------------------------------------------------------------------

/**
 * Saved resumes. `enabled` is false in demo mode, where there is no database
 * and the server tailors its built-in sample resume instead.
 *
 * Deliberately shares `queryKeys.resumes.list` with the resumes screen: same
 * key, same endpoint function, one cache entry. A second key would mean two
 * requests and two versions of the truth.
 */
export function useResumeOptions(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.resumes.list,
    queryFn: listResumes,
    enabled,
  });
}

/** Saved job descriptions. Same storage caveat as `useResumeOptions`. */
export function useJdOptions(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jds.list,
    queryFn: listJds,
    enabled,
  });
}

/**
 * The provider catalog. Public, unauthenticated, and fixed for the life of the
 * server, so it is cached forever rather than refetched per visit.
 */
export function useProviderOptions() {
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: listProviders,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

// ---------------------------------------------------------------------------
// The run itself
// ---------------------------------------------------------------------------

export interface TailorRunState {
  start: (body: TailorRequest) => void;
  cancel: () => void;
  /** Clears the result and any error without touching the form. */
  reset: () => void;
  isRunning: boolean;
  result: TailorResponse | null;
  /** Null while running, after a cancel, and after a successful run. */
  error: unknown;
  /** True from a cancel until the next run starts. */
  cancelled: boolean;
}

export interface TailorRunOptions {
  onSuccess?: (response: TailorResponse) => void;
  /** Never called for a cancellation — that is not a failure. */
  onError?: (error: unknown) => void;
}

export function useTailorRun(options: TailorRunOptions = {}): TailorRunState {
  const queryClient = useQueryClient();
  const abortRef = React.useRef<AbortController | null>(null);
  const [cancelled, setCancelled] = React.useState(false);

  // TanStack re-reads the mutation's options on every render, so inline
  // callbacks are always the current ones — no ref indirection needed.
  const mutation = useMutation({
    mutationFn: (body: TailorRequest) => {
      // Belt and braces against a double-submit that slipped past the disabled
      // button: the previous request is abandoned rather than racing this one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      return tailor(body, controller.signal);
    },
    onSuccess: (response) => {
      // A saved run is new history. Nothing else on the server changed.
      if (response.run_id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.runs.all });
      }
      options.onSuccess?.(response);
    },
    onError: (error) => {
      if (isAbortError(error)) return;
      options.onError?.(error);
    },
  });

  // A run in flight when the workspace unmounts is work nobody will read.
  React.useEffect(() => () => abortRef.current?.abort(), []);

  const { mutate, reset: resetMutation } = mutation;

  const start = React.useCallback(
    (body: TailorRequest) => {
      setCancelled(false);
      mutate(body);
    },
    [mutate],
  );

  const cancel = React.useCallback(() => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    setCancelled(true);
    // The AbortError is not a failure the user needs to see; the cancelled
    // notice says everything worth saying.
    resetMutation();
  }, [resetMutation]);

  const reset = React.useCallback(() => {
    setCancelled(false);
    resetMutation();
  }, [resetMutation]);

  return {
    start,
    cancel,
    reset,
    isRunning: mutation.isPending,
    result: mutation.data ?? null,
    // An abort can still land here if it raced the cancel handler's reset.
    error: mutation.error && !isAbortError(mutation.error) ? mutation.error : null,
    cancelled,
  };
}

// ---------------------------------------------------------------------------
// Progress for a request that does not report any
// ---------------------------------------------------------------------------

export interface RunStage {
  id: string;
  label: string;
  detail: string;
  /** Elapsed milliseconds at which this stage typically begins. */
  startsAtMs: number;
}

const REQUEST_STAGE: RunStage = {
  id: "request",
  label: "Sending the request",
  detail: "Your resume and the job description are on their way to the server.",
  startsAtMs: 0,
};

const MODEL_STAGE: RunStage = {
  id: "model",
  label: "The model is drafting changes",
  detail:
    "Only the factual parts of your resume are sent — never your name, email, phone or links.",
  startsAtMs: 2_000,
};

const VALIDATE_STAGE: RunStage = {
  id: "validate",
  label: "Checking the proposal",
  detail:
    "The server rejects invented numbers, unknown bullets and reordered skills that do not match your resume.",
  startsAtMs: 20_000,
};

const COMPILE_STAGE: RunStage = {
  id: "compile",
  label: "Compiling the PDF",
  detail: "Tectonic renders the locked LaTeX template in a sandbox.",
  startsAtMs: 35_000,
};

const LONG_STAGE: RunStage = {
  id: "long",
  label: "Still working",
  detail:
    "Long jobs are normal — a slow provider or a one-page repair can push a run past two minutes. Cancelling is safe.",
  startsAtMs: 90_000,
};

function buildStages(compile: boolean): RunStage[] {
  return compile
    ? [REQUEST_STAGE, MODEL_STAGE, VALIDATE_STAGE, COMPILE_STAGE, LONG_STAGE]
    : [REQUEST_STAGE, MODEL_STAGE, VALIDATE_STAGE, LONG_STAGE];
}

export interface RunProgress {
  elapsedMs: number;
  stages: RunStage[];
  currentIndex: number;
}

/**
 * Elapsed time plus the stage a run of this age is *usually* in.
 *
 * `POST /api/tailor` returns one JSON body at the end and reports nothing
 * before that, so the stage is an estimate and the UI says so. The elapsed
 * clock is the honest half.
 *
 * Mount this only while a run is in flight; the clock starts on mount.
 */
export function useRunProgress(compile: boolean): RunProgress {
  const [elapsedMs, setElapsedMs] = React.useState(0);

  // The clock starts when the caller mounts, which is when the run starts —
  // <RunProgress> is rendered only while a request is in flight. Ticking from
  // a captured timestamp rather than accumulating per tick means a throttled
  // background tab cannot make a two-minute run look like a thirty-second one.
  React.useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => window.clearInterval(id);
  }, []);

  const stages = React.useMemo(() => buildStages(compile), [compile]);

  let currentIndex = 0;
  for (let index = 0; index < stages.length; index += 1) {
    if (elapsedMs >= stages[index].startsAtMs) currentIndex = index;
  }

  return { elapsedMs, stages, currentIndex };
}

/** `0:07`, `1:42`, `12:03`. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
