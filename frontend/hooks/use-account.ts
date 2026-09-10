"use client";

import { useRouter } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  changePassword,
  deleteMe,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  updateMe,
} from "@/lib/api/endpoints/session";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  ChangePasswordRequest,
  DeleteMeRequest,
  UpdateMeRequest,
  UserResponse,
} from "@/lib/api/types";

/**
 * Everything Settings writes about the account itself.
 *
 * The read side stays `useSession()`; nothing here keeps a second copy of who
 * is signed in. Each mutation's only job is to leave the cache in the state the
 * server is now in — usually by writing the `UserResponse` the endpoint already
 * returned rather than invalidating and refetching a fact we were just told.
 */

/** Query keys describing the deployment rather than the person using it. */
function isServerScopedKey(key: readonly unknown[]): boolean {
  return key[0] === queryKeys.health[0];
}

/**
 * Drop every cached thing this account could see.
 *
 * Mirrors `clearSession` in use-auth.ts. `removeQueries`, not invalidation:
 * after the account is gone there is nothing to refetch, and keeping the data
 * on screen while the app navigates would show a deleted user their own
 * resumes.
 */
function clearAccountCache(queryClient: QueryClient): void {
  queryClient.removeQueries({
    predicate: (query) => !isServerScopedKey(query.queryKey),
  });
}

// ---------------------------------------------------------------------------
// Profile and defaults
// ---------------------------------------------------------------------------

/**
 * `PATCH /api/me`.
 *
 * ⚠️ OMITTED IS NOT NULL. backend/app/auth.py checks `model_fields_set`, so a key that
 * is absent from the JSON leaves the stored value alone, while an explicit
 * `null` clears it. `JSON.stringify` drops `undefined` properties, which means
 * the difference the server cares about is exactly the difference between
 * passing `undefined` and passing `null` from here — and callers that want
 * "clear my default" MUST pass `null`. See `buildDefaultsPatch` in
 * components/settings/default-provider-form.tsx, which is where that decision
 * is made explicit.
 *
 * `name` is the exception and behaves differently on the server: it is applied
 * only when non-null, so `null` is a no-op and `""` is how a display name is
 * removed.
 *
 * The response is the full refreshed user, so it is written straight into the
 * session query. Invalidating instead would blank the form for a round trip.
 */
export function useUpdateMe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateMeRequest) => updateMe(body),
    onSuccess: (response: UserResponse) => {
      queryClient.setQueryData(queryKeys.session.me, response);
    },
  });
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

/**
 * `POST /api/auth/password`.
 *
 * The server treats a password change as a suspected compromise: it destroys
 * every OTHER session for the account and every outstanding reset link, keeping
 * only the one that made the request. So the session list is invalidated — it
 * is now shorter, and a stale list would invite the user to revoke sessions
 * that no longer exist.
 *
 * ⚠️ The endpoint helper is declared `api.post<OkResponse>`, but the route's
 * `response_model` is `UserResponse` and the running server returns
 * `{"user": {...}}` — verified against 127.0.0.1:8011. The response is ignored
 * here and the session query invalidated instead, so the mistyped value is
 * never read. See the report note about correcting that type in lib/api.
 */
export function useChangePassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ChangePasswordRequest) => changePassword(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.session.list });
    },
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * `GET /api/sessions` — every session token currently valid for this account.
 *
 * This is a security readout, so it is deliberately NOT cached aggressively:
 * a revocation made on another device should be visible here on the next look,
 * not minutes later. Refetched when the window regains focus for the same
 * reason.
 */
export function useSessions(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.session.list,
    queryFn: listSessions,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * `DELETE /api/sessions/{id}` — revoke one other session.
 *
 * Not optimistic: a row that vanishes before the server has agreed is a lie on
 * a screen whose entire purpose is telling the truth about who is signed in.
 */
export function useRevokeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => revokeSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session.list });
    },
  });
}

/** `DELETE /api/sessions` — revoke every session except this one. */
export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session.list });
    },
  });
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

/**
 * `DELETE /api/me` — with a body.
 *
 * The current password travels in the request body (`DeleteMeRequest`), which
 * is why `lib/api/client.ts` gives DELETE a body parameter at all. A wrong
 * password comes back as 403 `invalid_credentials` and nothing is deleted.
 *
 * On success the server has already dropped every session, every stored key,
 * every resume, JD and run, and cleared the cookie in the response. There is
 * nothing left to fetch, so the cache is emptied and the browser sent to the
 * sign-in screen; the toast is what stops that navigation from reading as an
 * unexplained sign-out.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (body: DeleteMeRequest) => deleteMe(body),
    onSuccess: () => {
      clearAccountCache(queryClient);
      toast.success("Account deleted", {
        description:
          "Your resumes, job descriptions, run history and stored API keys are gone.",
      });
      router.replace("/sign-in");
    },
  });
}
