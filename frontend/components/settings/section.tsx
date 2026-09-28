import * as React from "react";
import { cn } from "cn";

export interface SettingsSectionProps {
  /** Anchor target and the id the in-page nav links to. */
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Section-level action, right-aligned against the heading. */
  actions?: React.ReactNode;
  /** The section's place on the page — "01" — shown as the landing page numbers steps. */
  number?: string;
  tone?: "default" | "danger";
  children: React.ReactNode;
  className?: string;
}

/**
 * One section of the settings screen, as a numbered card — the same shape the
 * landing page, the tailor screen and the resume builder use for a step.
 *
 * Every section is a real landmark with a real <h2>, so heading navigation and
 * the in-page nav describe the same structure. `scroll-mt` is what stops the
 * sticky application header from covering a heading when an anchor link jumps
 * to it.
 *
 * The page stays one scrolling document (see settings-screen.tsx); the cards
 * only separate unrelated decisions visually. `tone="danger"` is for the one
 * section whose actions cannot be undone.
 */
export function SettingsSection({
  id,
  number,
  title,
  description,
  actions,
  tone = "default",
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn(
        "bg-card scroll-mt-28 rounded-[1.25rem] ring-1",
        tone === "danger" ? "ring-destructive/25" : "ring-foreground/10",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-6 pb-4 sm:px-7">
        <div className="flex min-w-0 gap-4">
          {number ? (
            <span
              aria-hidden="true"
              className={cn(
                "w-6 shrink-0 pt-1 font-mono text-xs",
                tone === "danger" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {number}
            </span>
          ) : null}
          <div className="min-w-0 space-y-1">
            <h2
              id={`${id}-heading`}
              className={cn(
                "font-heading text-[1.0625rem] leading-7 font-semibold tracking-tight",
                tone === "danger" && "text-destructive",
              )}
            >
              {title}
            </h2>
            {description ? (
              <p className="text-muted-foreground max-w-2xl text-sm leading-6 text-pretty">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className={cn("px-5 pb-6 sm:px-7", number && "sm:pl-[4.25rem]")}>
        {children}
      </div>
    </section>
  );
}

/**
 * A flush-bordered surface for a section's body, nested inside the section's
 * card — so a quieter tint and a hairline rather than a second card.
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
        "bg-muted/30 overflow-hidden rounded-xl border",
        divide && "divide-border/70 divide-y",
        className,
      )}
      {...props}
    />
  );
}
