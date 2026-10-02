"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, LoadingState, Spinner } from "@/components/common";
import { useSession } from "@/hooks/use-session";
import { queryKeys } from "@/lib/api/query-keys";
import { AuthPage } from "./auth-page";

/**
 * The two answers an auth screen has to have before it can show a form.
 *
 * BOOTING — `/api/me` has not resolved, so we do not yet know whether this
 * visitor is already signed in. Showing a sign-in form now and a redirect a
 * moment later is worse than showing neither.
 *
 * ALREADY SIGNED IN — only for the screens where that is a contradiction.
 * /reset-password and /verify-email must keep working for a signed-in user
 * (people do change their password while signed in, and a verification link is
 * routinely opened in the session that asked for it), so they leave
 * `redirectWhenAuthenticated` off.
 */
export interface AuthGateProps {
  /**
   * Bounce an authenticated visitor to the app. For /sign-in, /register and
   * /forgot-password, where being signed in makes the screen pointless.
   */
  redirectWhenAuthenticated?: boolean;
  children: React.ReactNode;
}

export function AuthGate({
  redirectWhenAuthenticated = false,
  children,
}: AuthGateProps) {
  const session = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const shouldLeave = redirectWhenAuthenticated && session.isAuthenticated;

  React.useEffect(() => {
    if (!shouldLeave) return;
    router.replace("/tailor");
  }, [shouldLeave, router]);

  const retryBoot = React.useCallback(() => {
    void queryClient.refetchQueries({ queryKey: queryKeys.session.me });
  }, [queryClient]);

  if (session.isLoading) {
    return (
      <LoadingState label="Checking this server…">
        <div aria-hidden="true" className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </LoadingState>
    );
  }

  if (session.bootError) {
    return (
      <AuthPage
        title="Can't reach the server"
        description="RoleTeX could not reach this server, so there is nothing it can safely offer you yet."
      >
        <ErrorState error={session.bootError} onRetry={retryBoot} />
      </AuthPage>
    );
  }

  if (shouldLeave) {
    return (
      <div
        role="status"
        className="text-muted-foreground flex items-center justify-center gap-2.5 py-8 text-sm"
      >
        <Spinner />
        <span>You are already signed in. Taking you to RoleTeX…</span>
      </div>
    );
  }

  return <>{children}</>;
}
