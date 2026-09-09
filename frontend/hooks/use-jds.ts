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
  listJdVersions,
  updateJd,
} from "@/lib/api/endpoints/jds";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  JdCreateRequest,
  JdDetail,
  JdResponse,
  JdSummary,
  JdUpdateRequest,
  JdVersionSummary,
} from "@/lib/api/types";

/**
 * The job-description library's server state.
 *
 * ---------------------------------------------------------------------------
 * INVALIDATION CONTRACT  (the resumes feature mirrors this — keep them in step)
 * ---------------------------------------------------------------------------
 * `queryKeys.jds` is hierarchical: `list` is `["jds","list"]`, `detail(id)` is
 * `["jds","detail",id]`, `versions(id)` is `["jds","versions",id]`. Every write
 * below touches ONLY the keys the server actually changed, never the `jds.all`
 * prefix — invalidating the prefix would refetch the detail of all fifty JDs
 * because one of them was renamed.
 *
 *   create  ->  seed detail(newId) from the response, invalidate list
 *   update  ->  seed detail(id) from the response, invalidate list + versions(id)
 *   delete  ->  REMOVE detail(id) and versions(id), invalidate list
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
 * server derives (`excerpt`, `updated_at`, `version`, and the `updated_at`
 * DESC ordering of the whole list) is not reconstructable on the client.
 *
 * NO OPTIMISTIC UPDATES ANYWHERE HERE, deliberately. Even a title-only `PUT`
 * archives the current revision and increments `version` server-side, so an
 * optimistic patch would have to invent a version number and a history entry.
 * The project rule is that optimism is for renames and toggles; on this API a
 * rename is neither.
 */

/**
 * `GET /api/jds`.
 *
 * The server sorts by `updated_at` DESC (app/db.py `JdStore.list_for_user`),
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

/**
 * `GET /api/jds/{id}/versions` — the archive trail, newest first.
 *
 * ⚠️ Each entry carries only a 160-character `excerpt`, never the archived
 * body. The full text of an old revision is stored but is not exposed by this
 * API, so the UI must not offer "restore" or "view full text" for one.
 */
export function useJdVersions(id: string | null) {
  return useQuery({
    queryKey: queryKeys.jds.versions(id ?? ""),
    queryFn: () => listJdVersions(id as string),
    enabled: Boolean(id),
    select: (response): JdVersionSummary[] => response.versions ?? [],
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
 * `PUT /api/jds/{id}` — which creates a NEW VERSION rather than overwriting.
 *
 * The server archives the current revision, bumps `version`, and prunes the
 * oldest archived snapshots past its per-JD cap. So `versions(id)` is stale the
 * moment this resolves and is invalidated alongside the list.
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
      void queryClient.invalidateQueries({
        queryKey: queryKeys.jds.versions(response.jd.id),
      });
    },
  });
}

/**
 * `DELETE /api/jds/{id}`.
 *
 * The server also deletes every archived version of the JD, so both cached
 * keys are removed rather than invalidated.
 */
export function useDeleteJd() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteJd(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.jds.detail(id) });
      queryClient.removeQueries({ queryKey: queryKeys.jds.versions(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jds.list });
    },
  });
}
