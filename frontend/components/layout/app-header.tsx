"use client";

import { Skeleton } from "@/components/ui/skeleton";
import type { User } from "@/lib/api/types";
import { AppNav } from "./app-nav";
import { MobileNav } from "./mobile-nav";
import { NAV_ITEMS } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { Wordmark } from "./wordmark";

export interface AppHeaderProps {
  user: User | null;
  needsEmailVerification: boolean;
  /** False while the session is still resolving, or when it failed to. */
  showNav: boolean;
  /** Show nav skeletons while the session resolves. */
  loading?: boolean;
}

/**
 * The top bar; from `lg` up it also holds the navigation (a drawer below).
 *
 * It renders in every shell state — booting, failed, signed out, ready — so the
 * product identity and the theme control never disappear. Only the parts that
 * genuinely depend on the session (the mobile nav trigger, the account menu)
 * are conditional.
 *
 * Translucent with a blur rather than opaque so long documents visibly pass
 * under it; the fallback background is opaque for browsers without
 * backdrop-filter.
 */
export function AppHeader({
  user,
  needsEmailVerification,
  showNav,
  loading = false,
}: AppHeaderProps) {
  return (
    <header className="bg-background/90 supports-backdrop-filter:bg-background/70 sticky top-0 z-40 shrink-0 border-b backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[96rem] items-center gap-2 px-4 sm:px-6 lg:h-18 lg:gap-10 lg:px-8">
      {showNav ? (
        <MobileNav />
      ) : (
        // Holds the drawer trigger's footprint while the session resolves, so
        // the wordmark does not jump sideways when the nav appears.
        <div aria-hidden="true" className="size-7 lg:hidden" />
      )}

      <Wordmark href="/tailor" />

      {showNav ? (
        <AppNav
          orientation="horizontal"
          className="hidden lg:block"
        />
      ) : loading ? (
        <div aria-hidden="true" className="hidden items-center gap-5 px-3 lg:flex">
          {NAV_ITEMS.map((item) => (
            <Skeleton key={item.href} className="h-3.5 w-16" />
          ))}
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />

        {user ? (
          <UserMenu
            user={user}
            needsEmailVerification={needsEmailVerification}
          />
        ) : null}
      </div>
      </div>
    </header>
  );
}
