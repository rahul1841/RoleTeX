"use client";

import * as React from "react";
import { cn } from "cn";
import { useRouteHeadingFocus } from "@/components/layout/route-focus";

/**
 * Landing-page-style screen heading: status chip, large title, one-line
 * description, actions. Owns the page's <h1> and takes focus on navigation.
 */

const CHIP_TONES = {
  default: "bg-card text-muted-foreground ring-foreground/10",
  success:
    "bg-diff-added text-diff-added-foreground ring-diff-added-border font-sans font-medium",
} as const;

export interface PageHeroProps {
  eyebrow: React.ReactNode;
  eyebrowTone?: keyof typeof CHIP_TONES;
  eyebrowIcon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHero({
  eyebrow,
  eyebrowTone = "default",
  eyebrowIcon,
  title,
  description,
  actions,
  className,
}: PageHeroProps) {
  const headingRef = useRouteHeadingFocus<HTMLHeadingElement>();

  return (
    <div
      className={cn(
        "flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-10",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col items-start gap-4">
        <p
          className={cn(
            "inline-flex h-7 items-center gap-2 rounded-full px-3 font-mono text-xs ring-1",
            CHIP_TONES[eyebrowTone],
          )}
        >
          {eyebrowIcon ?? (
            <span aria-hidden="true" className="bg-primary size-1.5 rounded-[2px]" />
          )}
          {eyebrow}
        </p>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading scroll-mt-24 text-[2.25rem] leading-[1.06] font-semibold tracking-[-0.04em] text-balance outline-none sm:text-5xl"
        >
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground max-w-[52rem] text-base leading-7 text-pretty sm:text-lg">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        // `empty:hidden`: an actions component that renders nothing leaves no gap.
        <div className="flex shrink-0 flex-wrap items-center gap-2 empty:hidden">{actions}</div>
      ) : null}
    </div>
  );
}

/** The landing page's dotted background panel. */
export function Canvas({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "bg-muted relative rounded-[1.25rem] border [background-image:radial-gradient(var(--border)_1px,transparent_1.2px)] [background-size:20px_20px]",
        className,
      )}
      {...props}
    />
  );
}
