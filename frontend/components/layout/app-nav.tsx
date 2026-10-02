"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
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

export interface AppNavProps {
  /** Closes the mobile drawer once a destination is chosen. */
  onNavigate?: () => void;
  className?: string;
  /** Labels the landmark. Two navs on one page must not share a name. */
  label?: string;
  /** `vertical` in the mobile drawer, `horizontal` in the desktop header. */
  orientation?: Orientation;
}

export function AppNav({
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
        {NAV_ITEMS.map((item) => (
          <li key={item.href} className="relative">
            <NavItemLink
              item={item}
              active={isNavItemActive(pathname, item.href)}
              orientation={orientation}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
