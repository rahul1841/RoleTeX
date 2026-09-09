"use client";

import * as React from "react";
import { tokenFromFragment } from "./token-link";

/**
 * The URL fragment, as an external store.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` for the reason
 * components/layout/theme-toggle.tsx gives for the same shape: it returns the
 * server snapshot during prerender and hydration and the client snapshot
 * immediately after, without a state update inside an effect and the cascading
 * render that causes.
 *
 * The server snapshot is `null` — not `""` — and that distinction is the whole
 * reason this is a store at all. `output: "export"` prerenders these pages at
 * build time, where there is no `window` and no fragment, so "" would be a lie
 * that renders as "this link has no token" for one frame to someone whose link
 * is perfectly good. `null` says "not known yet" instead.
 */
function subscribeToHash(onStoreChange: () => void): () => void {
  window.addEventListener("hashchange", onStoreChange);
  return () => window.removeEventListener("hashchange", onStoreChange);
}

function getHashSnapshot(): string {
  return window.location.hash;
}

function getServerHashSnapshot(): null {
  return null;
}

/**
 * The one-time token in this page's URL fragment.
 *
 *   undefined  the fragment has not been read yet (prerender and hydration)
 *   null       there is no token in it
 *   string     the token
 *
 * Three states rather than two so a page can hold still for that first frame
 * instead of flashing "this link is missing its token".
 */
export function useFragmentToken(): string | null | undefined {
  const hash = React.useSyncExternalStore(
    subscribeToHash,
    getHashSnapshot,
    getServerHashSnapshot,
  );
  return hash === null ? undefined : tokenFromFragment(hash);
}

/**
 * Drop a spent token from the address bar without touching the session.
 *
 * Called only AFTER redemption, never on mount. The token is single-use, so by
 * then it is worthless and all that is left is a URL which looks live enough to
 * be bookmarked, screenshotted or pasted into a chat. Stripping it earlier
 * would be worse than useless: a refresh would lose a token that still worked,
 * and the user would have to request a whole new link.
 *
 * `replaceState` rather than assigning `location.hash`, which would push a new
 * history entry. It deliberately fires no `hashchange`, so the hook above keeps
 * reporting the token it already handed out and the page does not re-render
 * itself back into its "no token" state.
 */
export function clearFragmentToken(): void {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", `${pathname}${search}`);
}
