"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { DatabaseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, LoadingState, Spinner } from "@/components/common";
import { useSession } from "@/hooks/use-session";
import { queryKeys } from "@/lib/api/query-keys";
import { AuthPage, AuthStatus } from "./auth-page";

/**
 * The three answers an auth screen has to have before it can show a form.
 *
 * BOOTING — health has not resolved, so we do not yet know whether this server
 * even has accounts. Showing a sign-in form now and an "accounts unavailable"
 * message a moment later is worse than showing neither.
 *
 * DEMO MODE — `GET /api/health` reports `mode: "demo"`, which means no
 * database: no users, no sessions, nothing to sign in to. Every auth route is
 * meaningless and says so, rather than offering a form whose every submission
 * would 503. This is the auth-side counterpart to <RequiresStorage>.
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
    router.replace("/");
  }, [shouldLeave, router]);

  const retryBoot = React.useCallback(() => {
    // refetch, not invalidate: health is `staleTime: Infinity`, so marking it
    // stale would never actually send a request.
    void Promise.all([
      queryClient.refetchQueries({ queryKey: queryKeys.health }),
      queryClient.refetchQueries({ queryKey: queryKeys.session.me }),
    ]);
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
        description="RoleTeX could not read this deployment's status, so there is nothing it can safely offer you yet."
      >
        <ErrorState error={session.bootError} onRetry={retryBoot} />
      </AuthPage>
    );
  }

  if (session.mode === "demo") {
    return (
      <AuthPage
        title="This server has no accounts"
        description="It is running in demo mode with no database configured."
      >
        <AuthStatus
          tone="info"
          icon={DatabaseIcon}
          actions={
            <Button render={<Link href="/" />} size="sm">
              Go to RoleTeX
            </Button>
          }
        >
          <p>
            Signing in, registering and password resets all need the database,
            so none of them exist here. You can still tailor the built-in sample
            resume and download the PDF.
          </p>
        </AuthStatus>
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
