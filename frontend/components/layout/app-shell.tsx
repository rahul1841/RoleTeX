"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState, PageContainer, Spinner } from "@/components/common";
import { useSession } from "@/hooks/use-session";
import { queryKeys } from "@/lib/api/query-keys";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { BootError } from "./boot-error";
import { GlobalBanners } from "./global-banners";
import { RouteFocusProvider } from "./route-focus";

/**
 * The application frame: header, navigation, banners, and the main landmark
 * every page renders into.
 *
 * It owns the four states the app can be in before a page is meaningful, and
 * renders all of them inside the same frame rather than replacing the screen —
 * so the header and its theme control stay put and nothing jumps when the
 * session resolves:
 *
 *   booting          skeleton nav + skeleton content
 *   boot failed      no nav, a recoverable error with a refetching retry
 *   signed out       no nav, redirect to /sign-in (multi-user servers only)
 *   ready            the real nav and the page
 *
 * NOTE FOR THE AUTH WORK: this shell deliberately does not call
 * `setSessionLostHandler()` from lib/api/client.ts. That is a single
 * module-level slot and the auth provider is the right owner; wiring it here
 * too would mean whichever mounted last silently won.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Storage exists only where a database does. This is the single fact the nav
  // and every list screen gate on.
  const storageAvailable = session.mode === "multi_user";

  const mustSignIn =
    session.mode === "multi_user" &&
    !session.isLoading &&
    !session.bootError &&
    !session.isAuthenticated;

  React.useEffect(() => {
    if (!mustSignIn) return;
    // `replace`, not `push`: a signed-out user should not be able to press Back
    // into a shell that will immediately bounce them out again.
    router.replace("/sign-in");
  }, [mustSignIn, router]);

  const retryBoot = React.useCallback(
    () =>
      // refetch, not invalidate: health is `staleTime: Infinity`, so marking it
      // stale would not actually send a request.
      Promise.all([
        queryClient.refetchQueries({ queryKey: queryKeys.health }),
        queryClient.refetchQueries({ queryKey: queryKeys.session.me }),
      ]),
    [queryClient],
  );

  const ready = !session.isLoading && !session.bootError && !mustSignIn;

  let body: React.ReactNode;
  if (session.isLoading) {
    body = <ShellContentSkeleton />;
  } else if (session.bootError) {
    body = <BootError error={session.bootError} onRetry={retryBoot} />;
  } else if (mustSignIn) {
    body = <RedirectingToSignIn />;
  } else {
    body = children;
  }

  return (
    // Mounted above every branch so the navigation counter survives the
    // transition out of the loading state — otherwise a slow boot would look
    // like a navigation and steal focus on first paint.
    <RouteFocusProvider>
      <div className="flex min-h-svh flex-1 flex-col">
        <AppHeader
          mode={session.mode}
          storageAvailable={storageAvailable}
          user={ready ? session.user : null}
          needsEmailVerification={session.needsEmailVerification}
          showNav={ready}
        />

        {ready ? (
          <GlobalBanners
            mode={session.mode}
            needsEmailVerification={session.needsEmailVerification}
          />
        ) : null}

        <div className="flex flex-1">
          {session.isLoading || ready ? (
            <AppSidebar
              storageAvailable={storageAvailable}
              loading={session.isLoading}
            />
          ) : null}

          {/* The skip link in app/layout.tsx targets this id, and it is
              focusable so the jump actually lands rather than only scrolling. */}
          <main
            id="main-content"
            tabIndex={-1}
            // Focus-visible only: activating the skip link must visibly
            // confirm that focus moved, while a plain click into the region
            // should not draw a ring.
            className="focus-visible:ring-ring/50 min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2"
          >
            {body}
          </main>
        </div>
      </div>
    </RouteFocusProvider>
  );
}

/** Shaped like a page header over a list, which is what most screens are. */
function ShellContentSkeleton() {
  return (
    <LoadingState label="Starting RoleTeX…">
      <PageContainer>
        <div aria-hidden="true" className="space-y-8">
          <div className="space-y-2.5">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        </div>
      </PageContainer>
    </LoadingState>
  );
}

/**
 * Shown for the frame or two between deciding the user is signed out and the
 * router arriving at /sign-in. The link is the fallback for the case where the
 * programmatic navigation cannot happen at all.
 */
function RedirectingToSignIn() {
  return (
    <div
      role="status"
      className="text-muted-foreground mx-auto flex w-full max-w-sm flex-col items-center gap-3 px-4 py-24 text-center text-sm"
    >
      <Spinner className="size-5" />
      <p>
        Taking you to{" "}
        <Link href="/sign-in" className="text-foreground underline underline-offset-3">
          sign in
        </Link>
        …
      </p>
    </div>
  );
}
