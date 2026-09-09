"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/**
 * Route-change focus management.
 *
 * A client-side navigation swaps the page content without moving focus, so a
 * screen reader or keyboard user is left wherever the old page put them and is
 * never told the page changed. The old vanilla app solved this by focusing the
 * view's heading on every view switch; this reproduces that for the router.
 *
 * The mechanism is split in two because the two halves live in different
 * places: the provider sits in the shell (it is the only thing that sees every
 * navigation), and the hook is used by <PageHeader>, which is the only thing
 * that knows where the <h1> is.
 *
 * The context counts navigations rather than exposing the pathname so that a
 * page which re-mounts its header for its own reasons — finishing a fetch,
 * switching a tab — does not steal focus. Focus moves only when the count
 * actually changes.
 */
const NavigationCountContext = React.createContext(0);

/**
 * Default 0 means "no navigation has happened yet", which is also what a
 * <PageHeader> rendered outside the shell (the auth pages) sees. Those pages
 * then simply never move focus, which is correct: on a first paint the user
 * should land at the top of the document, ahead of the skip link.
 */
export function RouteFocusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navigationCount, setNavigationCount] = React.useState(0);
  const previousPathname = React.useRef(pathname);

  React.useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    setNavigationCount((count) => count + 1);
  }, [pathname]);

  return (
    <NavigationCountContext.Provider value={navigationCount}>
      {children}
    </NavigationCountContext.Provider>
  );
}

/**
 * Returns a ref to put on the page's <h1>. The element must be focusable
 * (`tabIndex={-1}`) for this to do anything — <PageHeader> handles that.
 */
export function useRouteHeadingFocus<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const navigationCount = React.useContext(NavigationCountContext);
  // The count this hook last moved focus for. Without it, a PageHeader that
  // unmounts and remounts mid-page — a list swapping LoadingState for content,
  // a conditional wrapper, an error boundary resetting — runs this effect
  // again with an unchanged, already-handled count and yanks focus back to the
  // heading from wherever the user actually was.
  const focusedForCount = React.useRef<number | null>(null);

  React.useEffect(() => {
    // 0 is first paint, not a navigation: focusing here would skip past the
    // skip-link before the user can use it.
    if (navigationCount === 0) return;
    if (focusedForCount.current === navigationCount) return;
    focusedForCount.current = navigationCount;
    // Scrolling is intentionally left to the browser: the heading carries
    // `scroll-mt` so the sticky header does not end up covering it.
    ref.current?.focus();
  }, [navigationCount]);

  return ref;
}
