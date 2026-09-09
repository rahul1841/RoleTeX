import * as React from "react";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  /** A lucide icon component, e.g. `FileTextIcon`. Passed, not rendered. */
  icon?: LucideIcon;
  title: React.ReactNode;
  /** Say what the user can do next, not just that the list is empty. */
  description?: React.ReactNode;
  /** Usually the same primary action the page header offers. */
  action?: React.ReactNode;
  /** Rendered under the action — a secondary link, a hint, a keyboard tip. */
  footer?: React.ReactNode;
  className?: string;
  /**
   * `card` (default) draws its own dashed container, for a list or panel that
   * is empty. `bare` drops the container for when the caller already provides
   * one, such as inside a <Card>.
   */
  variant?: "card" | "bare";
}

/**
 * The "there is nothing here yet" state, used by every list in the app.
 *
 * Dashed rather than solid so it reads as a placeholder for content that will
 * arrive, not as a real surface. Not a `role="status"` — an empty list is the
 * page's ordinary content, and announcing it as a live region would interrupt.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  footer,
  className,
  variant = "card",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        variant === "card" &&
          "border-border/80 bg-card/40 rounded-xl border border-dashed",
        className,
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className="bg-muted text-muted-foreground mb-1 flex size-10 items-center justify-center rounded-full"
        >
          <Icon className="size-5" />
        </span>
      ) : null}
      <div className="space-y-1.5">
        {/* A heading, not a paragraph: every list screen renders one of
            these, and as a <p> heading-navigation would land on the page h1
            and then find nothing. */}
        <h2 className="font-heading text-base font-medium text-balance">
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground mx-auto max-w-md text-sm text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
      {footer ? (
        <div className="text-muted-foreground text-xs">{footer}</div>
      ) : null}
    </div>
  );
}
