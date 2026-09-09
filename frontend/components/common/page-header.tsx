"use client";

import * as React from "react";
import { cn } from "cn";
import { useRouteHeadingFocus } from "@/components/layout/route-focus";

export interface PageHeaderProps {
  title: React.ReactNode;
  /** One or two lines saying what this screen is for. Optional but preferred. */
  description?: React.ReactNode;
  /** Primary actions for the screen, right-aligned on wide viewports. */
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The heading block every page starts with.
 *
 * Two jobs beyond looking right:
 *
 *  1. It owns the page's single <h1>. Pages must not render their own, or the
 *     document ends up with two top-level headings.
 *  2. The <h1> is programmatically focusable and receives focus after every
 *     client-side navigation (see components/layout/route-focus.tsx), which is
 *     what tells assistive tech that the page changed. `tabIndex={-1}` makes it
 *     focusable by script only — it never joins the tab order — and the focus
 *     ring is suppressed because focus here is announced, not solicited.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: PageHeaderProps) {
  const headingRef = useRouteHeadingFocus<HTMLHeadingElement>();

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1.5">
          <h1
            ref={headingRef}
            tabIndex={-1}
            // scroll-mt keeps the sticky header from covering the heading when
            // focusing it scrolls it into view.
            className="font-heading scroll-mt-24 text-xl font-semibold tracking-tight text-balance outline-none sm:text-2xl"
          >
            {title}
          </h1>
          {description ? (
            <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
