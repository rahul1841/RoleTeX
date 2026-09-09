"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { NAV_ITEMS } from "./nav";
import { AppNav } from "./app-nav";

/**
 * The desktop navigation rail.
 *
 * Sticky under the header and scrollable on its own so a long page never
 * carries the nav off-screen. Hidden below `lg`, where <MobileNav> takes over.
 *
 * `loading` renders the same row geometry the real nav will occupy, so the
 * shell does not reflow when the session resolves.
 */
export function AppSidebar({
  storageAvailable,
  loading = false,
}: {
  storageAvailable: boolean;
  loading?: boolean;
}) {
  return (
    <aside className="bg-sidebar sticky top-14 hidden h-[calc(100svh-3.5rem)] w-56 shrink-0 border-r px-3 py-4 lg:block">
      {loading ? (
        <div aria-hidden="true" className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <div key={item.href} className="flex items-center gap-2.5 px-2.5 py-2">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          ))}
        </div>
      ) : (
        <AppNav storageAvailable={storageAvailable} />
      )}
    </aside>
  );
}
