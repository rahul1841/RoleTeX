"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { LockIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NAV_ITEMS, isNavItemActive, type NavItem } from "./nav";

const ITEM_BASE =
  "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** Explains, in the user's terms, why a storage-backed route is unavailable. */
export const DEMO_DISABLED_REASON =
  "Unavailable in demo mode: this server has no database, so nothing can be saved.";

function NavItemLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      // aria-current is what tells assistive tech which item is the page it is
      // on; colour alone would not.
      aria-current={active ? "page" : undefined}
      className={cn(
        ITEM_BASE,
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {/* The one place the accent appears in the nav. Rendered inside the link
          so it cannot drift out of alignment with the row. */}
      {active ? (
        <span
          aria-hidden="true"
          className="bg-primary absolute inset-y-1.5 -left-2 w-0.5 rounded-r-full"
        />
      ) : null}
      <Icon
        aria-hidden="true"
        className={cn("size-4 shrink-0", active && "text-primary")}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function NavItemDisabled({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Tooltip>
      {/* Rendered as a span, not a link: there is nothing to navigate to. It
          keeps tabIndex 0 so keyboard users can reach it and hear the reason —
          a plain `disabled` control would be skipped and the demo-mode
          limitation would be invisible to them. */}
      <TooltipTrigger
        render={<span />}
        tabIndex={0}
        // `aria-disabled` is only honoured on elements with a widget role. On a
        // bare span (implicit role `generic`) assistive tech ignores it and
        // announces plain focusable text, so the disabled state never reaches
        // the user. An explicit role makes it a widget and the state real.
        role="link"
        aria-disabled="true"
        className={cn(
          ITEM_BASE,
          // Not dimmer than /80: these items are deliberately focusable and are
          // the only on-screen explanation of what demo mode removes, so they
          // have to clear the 4.5:1 contrast floor rather than lean on the
          // WCAG exemption for inactive controls.
          "text-muted-foreground/80 cursor-not-allowed select-none",
        )}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">{item.label}</span>
        <LockIcon aria-hidden="true" className="ml-auto size-3.5 shrink-0" />
        {/* The tooltip's aria-describedby only fires on hover/focus of a
            pointer-capable trigger; this guarantees the reason is announced. */}
        <span className="sr-only">{DEMO_DISABLED_REASON}</span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-56">
        {DEMO_DISABLED_REASON}
      </TooltipContent>
    </Tooltip>
  );
}

export interface AppNavProps {
  /**
   * False in demo mode. Items marked `requiresStorage` are then shown disabled
   * with an explanation rather than hidden — the product still has those
   * features, this deployment just cannot offer them.
   */
  storageAvailable: boolean;
  /** Closes the mobile drawer once a destination is chosen. */
  onNavigate?: () => void;
  className?: string;
  /** Labels the landmark. Two navs on one page must not share a name. */
  label?: string;
}

export function AppNav({
  storageAvailable,
  onNavigate,
  className,
  label = "Main",
}: AppNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className={cn("w-full", className)}>
      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const disabled = item.requiresStorage && !storageAvailable;
          return (
            <li key={item.href} className="relative">
              {disabled ? (
                <NavItemDisabled item={item} />
              ) : (
                <NavItemLink
                  item={item}
                  active={isNavItemActive(pathname, item.href)}
                  onNavigate={onNavigate}
                />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
