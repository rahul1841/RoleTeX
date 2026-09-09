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
 * through a form this long. The page's single `<h1>` belongs to <PageHeader>,
 * so these start at level 2.
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

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      // The sticky editor rail overlaps the top of the viewport; without this
      // an anchor jump lands with the heading hidden underneath it.
      className={cn("scroll-mt-24", className)}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0"
          />
          <h2
            id={headingId}
            className="font-heading text-sm font-semibold tracking-tight"
          >
            {title}
          </h2>
          {badge ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {badge}
            </span>
          ) : null}
        </div>
        {action}
      </div>
      {description ? (
        <p className="text-muted-foreground mb-3 text-xs text-pretty">
          {description}
        </p>
      ) : null}
      {children}
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
      size="xs"
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
    <p className="border-border/80 text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-xs text-pretty">
      {children}
    </p>
  );
}
