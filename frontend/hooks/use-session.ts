"use client";

import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/lib/api/endpoints/session";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { User } from "@/lib/api/types";

export interface SessionState {
  isLoading: boolean;
  /** The server could not be reached; the app cannot start. */
  bootError: Error | null;
  user: User | null;
  isAuthenticated: boolean;
  /** The server requires email verification before feature use. */
  needsEmailVerification: boolean;
}

/**
 * The app's single source of truth for "who is using this and what can they do".
 *
 * Boots from `/api/me`. A 401 there is the normal signed-out state, so it
 * resolves to `user: null` rather than an error.
 */
export function useSession(): SessionState {
  const me = useQuery({
    queryKey: queryKeys.session.me,
    queryFn: getMe,
    retry: false,
  });

  // A 401 is "signed out", not a failure. Any other error is a real problem
  // and is surfaced through `bootError`.
  const meIsSignedOut =
    me.isError && isApiError(me.error) && me.error.status === 401;
  const meRealError = me.isError && !meIsSignedOut ? (me.error as Error) : null;

  const user = me.data?.user ?? null;

  return {
    isLoading: me.isLoading,
    bootError: meRealError,
    user,
    isAuthenticated: Boolean(user),
    needsEmailVerification: Boolean(
      user?.verification_required && !user?.email_verified,
    ),
  };
}
