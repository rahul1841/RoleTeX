"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { setSessionLostHandler } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { UserResponse } from "@/lib/api/types";
import { legacyHashRoute, tokenLinkHref } from "./token-link";

/**
 * The two pieces of auth behaviour that belong to the application as a whole
 * rather than to any auth screen. Renders nothing.
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
 * screen and the "/" landing that legacy email links resolve to, and its
 * lifetime is exactly the window in which either behaviour is wanted.
 */
export function AuthRuntime() {
  useLegacyTokenLinkRedirect();
  useSessionLostHandler();
  return null;
}

/**
 * Rewrite a LEGACY hash link onto its real route, keeping the token in the
 * fragment.
 *
 *   /#/reset-password?token=ABC   ->   /reset-password/#token=ABC
 *
 * Links in that first shape are already in people's inboxes — the backend
 * builds them from RESET_PATH/VERIFY_PATH in app/routes_account.py — and to a
 * server, a router, and `usePathname()` they are all simply "/". Without this
 * they land on the tailor page, and a signed-out visitor is then bounced to
 * /sign-in by the shell with the token dropped on the floor.
 *
 * `location.replace`, not `router.replace`, on purpose:
 *
 *  - It is a real navigation, so it cannot be undone by the shell's own
 *    redirect effect resolving a moment later in the same commit. A soft
 *    navigation would be racing a network response to decide where the user
 *    ends up, and losing that race means losing the token.
 *  - `replace` leaves no history entry, so Back does not return to a URL that
 *    would just redirect again.
 *
 * The cost is one full page load, once, on a link a person clicks from an
 * email. That is the right trade for never dropping a single-use credential.
 */
function useLegacyTokenLinkRedirect() {
  React.useEffect(() => {
    const legacy = legacyHashRoute(window.location.hash);
    if (!legacy) return;
    // The destination's fragment is `#token=…`, which does not start with "/",
    // so this cannot match its own output and loop.
    window.location.replace(tokenLinkHref(legacy.route, legacy.token));
  }, []);
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
