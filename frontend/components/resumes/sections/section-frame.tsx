"use client";

import * as React from "react";
import { cn } from "cn";
import { PlusIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The frame every builder section sits in.
 *
 * A real `<section aria-labelledby>` with an `<h2>`, so the resume's structure
 * is navigable by heading — which is how anyone using a screen reader moves
 * through a form this long. The page's single `<h1>` belongs to the screen's
 * <PageHero>, so these start at level 2.
 *
 * The id is also the scroll anchor the section rail links to, which is why it
 * is required rather than generated.
 */
export interface FormSectionProps {
  /** Stable slug: the heading id, and the `#anchor` the rail scrolls to. */
  id: string;
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** Right-aligned in the header — usually an Add button. */
  action?: React.ReactNode;
  /** Shown next to the title, e.g. the number of entries. */
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Display numbers by section id; keep in the order <ResumeBuilder> renders. */
const SECTION_NUMBERS: Record<string, string> = {
  identity: "01",
  experience: "02",
  projects: "03",
  education: "04",
  skills: "05",
  achievements: "06",
  custom: "07",
  style: "08",
};

export function FormSection({
  id,
  icon: Icon,
  title,
  description,
  action,
  badge,
  children,
  className,
}: FormSectionProps) {
  const headingId = `${id}-heading`;
  const number = SECTION_NUMBERS[id];

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      // Clears the sticky header and section bar on anchor jumps.
      className={cn(
        "bg-card scroll-mt-40 rounded-[1.25rem] ring-1 ring-foreground/10",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-6 pb-4 sm:px-7">
        <div className="flex min-w-0 gap-4">
          {number ? (
            <span
              aria-hidden="true"
              className="text-muted-foreground w-6 shrink-0 pt-1 font-mono text-xs"
            >
              {number}
            </span>
          ) : null}
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Icon
                aria-hidden="true"
                className="text-muted-foreground size-4 shrink-0"
              />
              <h2
                id={headingId}
                className="font-heading text-[1.0625rem] leading-7 font-semibold tracking-tight"
              >
                {title}
              </h2>
              {badge ? (
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-mono text-[0.6875rem] tabular-nums">
                  {badge}
                </span>
              ) : null}
            </div>
            {description ? (
              <p className="text-muted-foreground max-w-2xl text-sm leading-6 text-pretty">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      <div className="px-5 pb-6 sm:px-7 sm:pl-[4.25rem]">{children}</div>
    </section>
  );
}

/** The "Add …" control in a section header, with its own limit handling. */
export function AddEntryButton({
  label,
  onClick,
  disabled,
  limitReached,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  limitReached?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-lg"
      onClick={onClick}
      disabled={disabled || limitReached}
      // A disabled button gives no reason on its own; the title says why.
      title={limitReached ? "You have reached the limit for this section." : undefined}
    >
      <PlusIcon data-icon="inline-start" />
      {label}
    </Button>
  );
}

/** What a section shows before anything has been added to it. */
export function SectionEmpty({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <p className="border-border/80 text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-sm text-pretty">
      {children}
    </p>
  );
}
