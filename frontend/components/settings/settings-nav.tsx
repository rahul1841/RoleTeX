"use client";

import * as React from "react";
import { cn } from "cn";

export interface SettingsNavItem {
  id: string;
  label: string;
}

/**
 * The in-page section index.
 *
 * Settings is one scrolling document rather than a set of tabs, so this is
 * navigation, not state: the links are real fragment anchors that work with
 * middle-click, Back, and a page the browser has restored mid-scroll. Nothing
 * is hidden behind a click, which matters here because two of the sections —
 * email verification and account deletion — are things a user arrives at from
 * elsewhere (the global "verify your email" banner links straight to
 * /settings) and must not have to hunt for.
 *
 * The highlight is derived from what is actually on screen. The observer's
 * `rootMargin` shrinks the viewport to a band just under the sticky header, so
 * the active item is the section the reader is looking at rather than whichever
 * one happens to touch the bottom edge.
 */
export function SettingsNav({
  items,
  className,
}: {
  items: readonly SettingsNavItem[];
  className?: string;
}) {
  const [active, setActive] = React.useState<string>(items[0]?.id ?? "");

  React.useEffect(() => {
    const ids = items.map((item) => item.id);
    const nodes = ids
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null);
    if (nodes.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // Document order, not observer order: with two sections in the band the
        // upper one is the one being read.
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: "-96px 0px -55% 0px" },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav
      aria-label="Settings sections"
      className={cn("sticky top-20 self-start", className)}
    >
      <ul className="space-y-0.5 text-sm">
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "focus-visible:ring-ring/50 block rounded-md px-2 py-1 transition-colors outline-none focus-visible:ring-2",
                  isActive
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
