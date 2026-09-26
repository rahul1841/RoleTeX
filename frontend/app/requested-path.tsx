"use client";

import * as React from "react";

const subscribe = () => () => {};
const getPath = (): string | null => window.location.pathname;
const getServerPath = (): string | null => null;

/**
 * The address that was not found, drawn as a removed diff line — the app's own
 * way of saying "this is not here".
 *
 * Read from `window.location` rather than `usePathname()`: the not-found page
 * is prerendered once as 404.html and served for every unknown address, so the
 * real path only exists in the browser. Nothing renders during prerendering or
 * the first hydration pass, which keeps the two in step.
 */
export function RequestedPath() {
  const path = React.useSyncExternalStore(subscribe, getPath, getServerPath);
  if (!path) return null;

  return (
    <p className="bg-diff-removed text-diff-removed-foreground border-diff-removed-border grid grid-cols-[1rem_1fr] items-start gap-x-1 rounded-md border-l-2 py-1.5 pr-2.5 font-mono text-xs leading-[1.125rem] break-all">
      <span aria-hidden="true" className="text-center opacity-60 select-none">
        −
      </span>
      <span>
        <span className="sr-only">Requested address: </span>
        {path}
      </span>
    </p>
  );
}
