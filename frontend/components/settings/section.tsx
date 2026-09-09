import * as React from "react";
import { cn } from "cn";

export interface SettingsSectionProps {
  /** Anchor target and the id the in-page nav links to. */
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Section-level action, right-aligned against the heading. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * One band of the settings screen.
 *
 * Every section is a real landmark with a real <h2>, so heading navigation and
 * the in-page nav describe the same structure. `scroll-mt` is what stops the
 * sticky application header from covering a heading when an anchor link jumps
 * to it.
 *
 * Deliberately NOT a <Card>: cards imply peers of equal weight, and settings
 * are a sequence of unrelated decisions read top to bottom. A ruled heading
 * with flush content stays denser and lets each section choose its own body —
 * a table for sessions, a form for defaults, a bordered warning for deletion.
 */
export function SettingsSection({
  id,
  title,
  description,
  actions,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn("scroll-mt-24", className)}
    >
      <div className="border-border/70 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b pb-2.5">
        <div className="min-w-0 space-y-1">
          <h2
            id={`${id}-heading`}
            className="font-heading text-[0.95rem] leading-none font-semibold tracking-tight"
          >
            {title}
          </h2>
          {description ? (
            <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * A flush-bordered surface for a section's body.
 *
 * `divide` splits it into rows that share one outline instead of stacking
 * separate boxes — the right shape for a provider list or a session list, where
 * the rows are variants of one thing.
 */
export function SettingsPanel({
  className,
  divide = false,
  ...props
}: React.ComponentProps<"div"> & { divide?: boolean }) {
  return (
    <div
      className={cn(
        "bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10",
        divide && "divide-border/70 divide-y",
        className,
      )}
      {...props}
    />
  );
}
