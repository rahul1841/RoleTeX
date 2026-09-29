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
  "group relative flex items-center rounded-lg text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** Drawer: rows with icons. Header: a line of text tabs. */
const ORIENTATION = {
  vertical: {
    list: "flex flex-col gap-0.5",
    item: "w-full gap-2.5 px-2.5 py-2",
    active: "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
    idle: "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
  },
  horizontal: {
    list: "flex items-center gap-1",
    item: "h-9 gap-2 px-3 whitespace-nowrap",
    active: "bg-muted text-foreground font-medium",
    idle: "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
  },
} as const;

type Orientation = keyof typeof ORIENTATION;

/** Explains, in the user's terms, why a storage-backed route is unavailable. */
export const DEMO_DISABLED_REASON =
  "Unavailable in demo mode: this server has no database, so nothing can be saved.";

function NavItemLink({
  item,
  active,
  orientation,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  orientation: Orientation;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const style = ORIENTATION[orientation];
  const vertical = orientation === "vertical";
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      // aria-current is what tells assistive tech which item is the page it is
      // on; colour alone would not.
      aria-current={active ? "page" : undefined}
      className={cn(ITEM_BASE, style.item, active ? style.active : style.idle)}
    >
      {/* The one place the accent appears in the drawer. Rendered inside the
          link so it cannot drift out of alignment with the row. */}
      {active && vertical ? (
        <span
          aria-hidden="true"
          className="bg-primary absolute inset-y-1.5 -left-2 w-0.5 rounded-r-full"
        />
      ) : null}
      {vertical ? (
        <Icon
          aria-hidden="true"
          className={cn("size-4 shrink-0", active && "text-primary")}
        />
      ) : null}
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function NavItemDisabled({
  item,
  orientation,
}: {
  item: NavItem;
  orientation: Orientation;
}) {
  const Icon = item.icon;
  const vertical = orientation === "vertical";
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
          ORIENTATION[orientation].item,
          // Not dimmer than /80: these items are deliberately focusable and are
          // the only on-screen explanation of what demo mode removes, so they
          // have to clear the 4.5:1 contrast floor rather than lean on the
          // WCAG exemption for inactive controls.
          "text-muted-foreground/80 cursor-not-allowed select-none",
        )}
      >
        {vertical ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
        <span className="truncate">{item.label}</span>
        <LockIcon
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", vertical && "ml-auto")}
        />
        {/* The tooltip's aria-describedby only fires on hover/focus of a
            pointer-capable trigger; this guarantees the reason is announced. */}
        <span className="sr-only">{DEMO_DISABLED_REASON}</span>
      </TooltipTrigger>
      <TooltipContent side={vertical ? "right" : "bottom"} className="max-w-56">
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
  /** `vertical` in the mobile drawer, `horizontal` in the desktop header. */
  orientation?: Orientation;
}

export function AppNav({
  storageAvailable,
  onNavigate,
  className,
  label = "Main",
  orientation = "vertical",
}: AppNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={label}
      className={cn(orientation === "vertical" && "w-full", className)}
    >
      <ul className={ORIENTATION[orientation].list}>
        {NAV_ITEMS.map((item) => {
          const disabled = item.requiresStorage && !storageAvailable;
          return (
            <li key={item.href} className="relative">
              {disabled ? (
                <NavItemDisabled item={item} orientation={orientation} />
              ) : (
                <NavItemLink
                  item={item}
                  active={isNavItemActive(pathname, item.href)}
                  orientation={orientation}
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
