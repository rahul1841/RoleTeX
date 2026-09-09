"use client";

import { useRouter } from "next/navigation";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  confirmVerification,
  forgotPassword,
  login,
  logout,
  register,
  requestVerification,
  resetPassword,
} from "@/lib/api/endpoints/session";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  UserResponse,
  VerifyEmailRequest,
} from "@/lib/api/types";

/**
 * Every write that changes who is signed in.
 *
 * `useSession()` is the read side and stays the single source of truth; these
 * hooks only ever move the cache into a state `useSession()` will report
 * correctly, then navigate. Nothing here holds auth state of its own — a
 * second copy of "am I signed in" is how a shell and a form end up disagreeing.
 *
 * CACHE RULES, applied by the two helpers below:
 *
 *  - Signing in or registering ADOPTS a session: every cached query that
 *    belonged to the previous occupant of this browser tab is dropped before
 *    the new identity is written, so a stale resume list can never flash under
 *    a different account's name.
 *  - Signing out, or having a session revoked underneath us, CLEARS the
 *    session: the same drop, without a replacement.
 *
 * `health` survives both. It describes the server, not the user, and it is
 * cached with `staleTime: Infinity` precisely because a running server does
 * not change modes — refetching it on every sign-in would be pure noise.
 */

/** Query keys that describe the deployment rather than the person using it. */
function isServerScopedKey(key: readonly unknown[]): boolean {
  return key[0] === queryKeys.health[0];
}

/**
 * Drop everything the previous user could see.
 *
 * `removeQueries` rather than `invalidateQueries`: invalidation keeps the data
 * and refetches, which means the old account's resumes stay on screen until
 * the new request lands. Removal empties them immediately.
 */
function clearSession(queryClient: QueryClient): void {
  queryClient.removeQueries({
    predicate: (query) => !isServerScopedKey(query.queryKey),
  });
}

/**
 * Install a freshly authenticated user.
 *
 * The session query is written directly from the login/register response
 * instead of being invalidated, so the shell re-renders as authenticated on
 * the same tick and the user is not shown a loading frame for a fact the
 * server just told us. `session.list` (active sessions) IS invalidated,
 * because signing in created a new one.
 */
function adoptSession(queryClient: QueryClient, response: UserResponse): void {
  queryClient.removeQueries({
    predicate: (query) =>
      !isServerScopedKey(query.queryKey) &&
      query.queryKey[0] !== queryKeys.session.all[0],
  });
  queryClient.setQueryData(queryKeys.session.me, response);
  void queryClient.invalidateQueries({ queryKey: queryKeys.session.list });
}

/**
 * `POST /api/auth/login`.
 *
 * Failures are left to the caller: a form can tell 401 `invalid_credentials`
 * (retype the password) from 429 `too_many_attempts` (wait) from 403
 * `account_disabled` (contact the admin), and a toast fired from here would
 * flatten all three into the same noise.
 */
export function useLogin() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (body: LoginRequest) => login(body),
    onSuccess: (response) => {
      adoptSession(queryClient, response);
      // `replace`, so Back does not return to a sign-in form that would
      // immediately bounce the now-authenticated user back out.
      router.replace("/");
    },
  });
}

/**
 * `POST /api/auth/register`. The server opens a session on success, so this is
 * identical to a sign-in from the cache's point of view.
 */
export function useRegister() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (body: RegisterRequest) => register(body),
    onSuccess: (response) => {
      adoptSession(queryClient, response);
      router.replace("/");
    },
  });
}

/**
 * `POST /api/auth/logout`.
 *
 * The error path deliberately does not clear the cache: the cookie may still
 * be valid, and wiping local state while the server still considers the
 * session live would show a signed-out UI to a signed-in user. The next
 * `/api/me` settles it either way.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      clearSession(queryClient);
      router.replace("/sign-in");
    },
    onError: () => {
      toast.error("Could not sign out", {
        description: "Check your connection and try again.",
      });
    },
  });
}

/**
 * `POST /api/auth/password/forgot`.
 *
 * The response is intentionally identical for an address with an account and
 * one without (app/routes_account.py refuses to be an account oracle), so the
 * caller must not phrase its success state as confirmation that mail was sent
 * to that person. `delivered` reports only whether this SERVER has a real mail
 * transport at all — with the console driver it is false and the link is in
 * the server log.
 */
export function useForgotPassword() {
  return useMutation({
    mutationFn: (body: ForgotPasswordRequest) => forgotPassword(body),
  });
}

/**
 * `POST /api/auth/password/reset`.
 *
 * The server revokes EVERY session for the account, including any this browser
 * held, and clears the cookie in the response — nobody proved possession of
 * the old password here. So the local cache must be dropped and the user sent
 * to sign in; the toast exists because that navigation would otherwise look
 * like the reset silently failed.
 */
export function useResetPassword() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (body: ResetPasswordRequest) => resetPassword(body),
    onSuccess: () => {
      clearSession(queryClient);
      toast.success("Password changed", {
        description: "Sign in with your new password.",
      });
      router.replace("/sign-in");
    },
  });
}

/**
 * `POST /api/auth/verify/request` — send this account a new confirmation link.
 * Requires a session; unverified users may call it (that is the point).
 */
export function useRequestVerification() {
  return useMutation({
    mutationFn: requestVerification,
  });
}

/**
 * `POST /api/auth/verify/confirm` — redeem a one-time link.
 *
 * Deliberately unauthenticated on the server, because the link is usually
 * opened in a different browser from the one that asked for it. The token is
 * the proof.
 *
 * ⚠️ The endpoint helper in lib/api/endpoints/session.ts is declared
 * `api.post<UserResponse>`, but the route's `response_model` is `OkResponse`
 * and the running server returns `{"ok": true}` — verified against
 * 127.0.0.1:8011. The response is therefore ignored and the session query is
 * invalidated instead, which is also what a signed-out redemption needs. See
 * the report note about correcting that type.
 */
export function useConfirmVerification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: VerifyEmailRequest) => confirmVerification(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session.me });
    },
  });
}
