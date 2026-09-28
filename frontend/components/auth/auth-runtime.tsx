"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { setSessionLostHandler } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { UserResponse } from "@/lib/api/types";

/**
 * The auth behaviour that belongs to the application as a whole rather than
 * to any auth screen. Renders nothing.
 *
 * Mounted exactly once, in app/(app)/layout.tsx. That placement is the whole
 * design, so it is worth being explicit about why it is not anywhere else:
 *
 *  - NOT app/layout.tsx or app/providers.tsx. Both are off limits, and both are
 *    server-rendered ground the auth feature has no business editing.
 *  - NOT the (auth) layout. A session can only be lost by a request that
 *    carried one, and every such request is made from a screen inside the app
 *    shell. Arming the handler on the sign-in page would mean the ordinary
 *    signed-out `GET /api/me` 401 could trigger a "you have been signed out"
 *    reaction on the very page that exists to fix it.
 *  - NOT inside <AppShell>. `setSessionLostHandler` is a single module-level
 *    slot: two mounts means whichever ran last silently wins and the other's
 *    cleanup can null out the survivor. One owner, one call, one cleanup.
 *  - NOT a root template.tsx, which would be global but remounts the entire
 *    tree on every navigation.
 *
 * The (app) layout is the narrowest scope that covers every session-bearing
 * screen, and its lifetime is exactly the window in which this is wanted.
 */
export function AuthRuntime() {
  useSessionLostHandler();
  return null;
}

/**
 * React to a session that died mid-visit.
 *
 * `lib/api/client.ts` calls this back whenever a response satisfies
 * `ApiError.isSessionLost` — a 401 `not_authenticated` (the cookie expired, or
 * a password change elsewhere revoked every other session) or a 403
 * `account_disabled`. The slot is module-level and was previously unwired, so
 * nothing in the app reacted to either.
 *
 * The important subtlety is that the ordinary signed-out boot ALSO produces a
 * 401 from `GET /api/me`, and treating that as a lost session would greet a
 * first-time visitor with "you have been signed out". So the handler acts only
 * when the cache actually holds a user: that is the difference between "your
 * session ended" and "you never had one", and it is the only place that
 * difference is knowable.
 */
function useSessionLostHandler() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const handled = React.useRef(false);

  React.useEffect(() => {
    setSessionLostHandler(() => {
      const cached = queryClient.getQueryData<UserResponse>(
        queryKeys.session.me,
      );
      // Never signed in here: the shell's own redirect owns this case, and it
      // does it without an alarming toast.
      if (!cached?.user) return;

      // A page can have several queries in flight and every one of them will
      // fail the same way. One toast, one navigation.
      if (handled.current) return;
      handled.current = true;

      // Everything except `health` belonged to the session that just ended.
      // Removing the session query is also what makes `useSession()` report
      // signed out; the refetch it triggers 401s again, and the guard above
      // absorbs it.
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== queryKeys.health[0],
      });

      toast.error("You have been signed out", {
        description:
          "This session expired or was revoked. Sign in again to continue.",
      });

      router.replace("/sign-in");
    });

    // The slot has one owner. Releasing it on unmount is what keeps that true
    // across a remount, and it is why the handler must not be installed from a
    // second place.
    return () => setSessionLostHandler(null);
  }, [queryClient, router]);
}
