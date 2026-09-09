"use client";

import { Badge } from "@/components/ui/badge";
import type { AppMode, User } from "@/lib/api/types";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { Wordmark } from "./wordmark";

export interface AppHeaderProps {
  mode: AppMode | null;
  storageAvailable: boolean;
  user: User | null;
  needsEmailVerification: boolean;
  /** False while the session is still resolving, or when it failed to. */
  showNav: boolean;
}

/**
 * The one persistent bar across the top of the app.
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
  mode,
  storageAvailable,
  user,
  needsEmailVerification,
  showNav,
}: AppHeaderProps) {
  return (
    <header className="bg-background/90 supports-backdrop-filter:bg-background/70 sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur sm:px-4">
      {showNav ? (
        <MobileNav storageAvailable={storageAvailable} />
      ) : (
        // Holds the drawer trigger's footprint while the session resolves, so
        // the wordmark does not jump sideways when the nav appears.
        <div aria-hidden="true" className="size-7 lg:hidden" />
      )}

      <Wordmark />

      <div className="ml-auto flex items-center gap-1.5">
        {/* Demo mode has no accounts, so the header says what the server is
            instead of who the user is. */}
        {mode === "demo" ? (
          <Badge variant="outline" className="hidden sm:inline-flex">
            Demo
          </Badge>
        ) : null}

        <ThemeToggle />

        {user ? (
          <UserMenu
            user={user}
            needsEmailVerification={needsEmailVerification}
          />
        ) : null}
      </div>
    </header>
  );
}
