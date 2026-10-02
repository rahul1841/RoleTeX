"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  createJd,
  deleteJd,
  getJd,
  listJds,
  updateJd,
} from "@/lib/api/endpoints/jds";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  JdCreateRequest,
  JdDetail,
  JdResponse,
  JdSummary,
  JdUpdateRequest,
} from "@/lib/api/types";

/**
 * The job-description library's server state.
 *
 * ---------------------------------------------------------------------------
 * INVALIDATION CONTRACT  (the resumes feature mirrors this — keep them in step)
 * ---------------------------------------------------------------------------
 * `queryKeys.jds` is hierarchical: `list` is `["jds","list"]` and `detail(id)`
 * is `["jds","detail",id]`. Every write
 * below touches ONLY the keys the server actually changed, never the `jds.all`
 * prefix — invalidating the prefix would refetch the detail of all fifty JDs
 * because one of them was renamed.
 *
 *   create  ->  seed detail(newId) from the response, invalidate list
 *   update  ->  seed detail(id) from the response, invalidate list
 *   delete  ->  REMOVE detail(id), invalidate list
 *
 * Two rules behind that shape:
 *
 *  1. SEED, DON'T INVALIDATE, WHAT THE RESPONSE ALREADY CONTAINS. `POST` and
 *     `PUT` both return the complete `JdDetail`. Writing it into the cache with
 *     `setQueryData` means opening `/jds?id=…` straight after a save renders
 *     the saved text on the same tick instead of flashing a skeleton for a
 *     round trip that would return the bytes we are already holding.
 *  2. REMOVE, DON'T INVALIDATE, WHAT IS GONE. After a delete the detail query
 *     would 404; invalidation would fire that request and leave a cached error
 *     behind. `removeQueries` drops it silently.
 *
 * `list` is always invalidated rather than patched, because the summary the
 * server derives (`excerpt`, `updated_at`, and the `updated_at` DESC ordering
 * of the whole list) is not reconstructable on the client.
 */

/**
 * `GET /api/jds`.
 *
 * The server sorts by `updated_at` DESC (backend/app/db.py `JdStore.list_for_user`),
 * which is the order the UI presents by default; any other sort is applied on
 * the loaded array, since the API takes no sort or filter parameters.
 */
export function useJds() {
  return useQuery({
    queryKey: queryKeys.jds.list,
    queryFn: listJds,
    // `jds` is optional in the schema (`List[...] = Field(default_factory=list)`
    // serializes as a present key, but the generated type marks it optional),
    // so normalize here instead of at every call site.
    select: (response): JdSummary[] => response.jds ?? [],
  });
}

/**
 * `GET /api/jds/{id}` for the JD named by the `?id=` query parameter.
 *
 * `id` is nullable because selection lives in the URL and "nothing selected" is
 * a normal state. The key still has to be a stable array, so a disabled query
 * parks on `detail("")` — a key nothing ever writes to and no request is ever
 * made for.
 */
export function useJd(id: string | null) {
  return useQuery({
    queryKey: queryKeys.jds.detail(id ?? ""),
    // Safe: `enabled` guarantees this only runs with a non-empty id.
    queryFn: () => getJd(id as string),
    enabled: Boolean(id),
    select: (response): JdDetail => response.jd,
  });
}

/** Seed the detail cache from a write response. See the contract above. */
function cacheJdDetail(queryClient: QueryClient, response: JdResponse): void {
  queryClient.setQueryData(queryKeys.jds.detail(response.jd.id), response);
}

/**
 * `POST /api/jds`.
 *
 * Errors are left entirely to the caller. The three this route really returns
 * — 409 `jd_quota_exceeded`, 413 `request_too_large`, 422 `invalid_request` —
 * each need different words and a different next step, and a toast fired from
 * here would flatten them into one.
 */
export function useCreateJd() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: JdCreateRequest) => createJd(body),
    onSuccess: (response) => {
      cacheJdDetail(queryClient, response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jds.list });
    },
  });
}

/**
 * `PUT /api/jds/{id}` — overwrites the stored title and/or text.
 *
 * Send only the fields that actually changed: an unchanged field still counts
 * as an edit to the route, and sending both when only the title moved makes the
 * request needlessly large against the 64 KB body cap.
 */
export function useUpdateJd() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: JdUpdateRequest }) =>
      updateJd(id, body),
    onSuccess: (response) => {
      cacheJdDetail(queryClient, response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jds.list });
    },
  });
}

/** `DELETE /api/jds/{id}`. The cached detail is removed rather than invalidated. */
export function useDeleteJd() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteJd(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.jds.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jds.list });
    },
  });
}
