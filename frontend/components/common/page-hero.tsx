"use client";

import * as React from "react";
import { cn } from "cn";
import { useRouteHeadingFocus } from "@/components/layout/route-focus";

/**
 * A screen heading in the landing page's voice: a small mono status chip, a
 * large tight headline, one line of plain explanation, and the screen's
 * actions on the right.
 *
 * The redesigned screens (tailor, resumes) use this in place of <PageHeader>.
 * The tailor screen renders one per state, because its heading follows the
 * run — "Tailor a resume", then "Tailoring your resume", then "4 changes to
 * review". Like <PageHeader> it owns the page's single <h1> and takes focus
 * after a client-side navigation.
 */

const CHIP_TONES = {
  default: "bg-card text-muted-foreground ring-foreground/10",
  success:
    "bg-diff-added text-diff-added-foreground ring-diff-added-border font-sans font-medium",
} as const;

export interface PageHeroProps {
  /** The status chip above the title: "New run", "3 resumes". */
  eyebrow: React.ReactNode;
  eyebrowTone?: keyof typeof CHIP_TONES;
  /** Leading icon for the chip; a small square in the accent by default. */
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
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * The dotted "desk" the landing page draws its product pictures on. In the app
 * it holds real things — a resume, a run's placeholder page, a review, a live
 * preview — so the app reads as the same product as its front door.
 */
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
