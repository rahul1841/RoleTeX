"use client";

import { useQuery } from "@tanstack/react-query";
import { getHealth, getMe } from "@/lib/api/endpoints/session";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { AppMode, HealthResponse, User } from "@/lib/api/types";

/**
 * Server mode and subsystem health.
 *
 * This gates the entire app: in `demo` there is no database, so there are no
 * accounts, saved resumes, JDs or history. Fetched once and kept — a running
 * server does not change modes.
 */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: getHealth,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export interface SessionState {
  isLoading: boolean;
  /** Health could not be reached; the app cannot start. */
  bootError: Error | null;
  mode: AppMode | null;
  health: HealthResponse | null;
  user: User | null;
  isAuthenticated: boolean;
  /** Multi-user server that requires email verification before feature use. */
  needsEmailVerification: boolean;
}

/**
 * The app's single source of truth for "who is using this and what can they do".
 *
 * Mirrors the old two-step boot: health decides the mode, and only in
 * multi-user mode is `/api/me` consulted. A 401 there is the normal
 * signed-out state, so it resolves to `user: null` rather than an error.
 */
export function useSession(): SessionState {
  const health = useHealth();
  const mode: AppMode | null =
    health.data?.mode === "multi_user" ? "multi_user" : health.data ? "demo" : null;

  const me = useQuery({
    queryKey: queryKeys.session.me,
    queryFn: getMe,
    // Demo mode has no accounts, so asking would always 401.
    enabled: mode === "multi_user",
    retry: false,
  });

  // A 401 is "signed out", not a failure. Any other error is a real problem
  // and is surfaced through `bootError`.
  const meIsSignedOut =
    me.isError && isApiError(me.error) && me.error.status === 401;
  const meRealError = me.isError && !meIsSignedOut ? (me.error as Error) : null;

  const user = me.data?.user ?? null;

  return {
    isLoading: health.isLoading || (mode === "multi_user" && me.isLoading),
    bootError: (health.error as Error | null) ?? meRealError,
    mode,
    health: health.data ?? null,
    user,
    isAuthenticated: Boolean(user),
    needsEmailVerification: Boolean(
      user?.verification_required && !user?.email_verified,
    ),
  };
}
