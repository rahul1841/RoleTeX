"use client";

import * as React from "react";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/common";

/**
 * The inside of an auth card: heading, body, and an optional footer link.
 *
 * The heading comes from <PageHeader> rather than a local <h1> for the reason
 * the shell contract gives — it is the app's only <h1> and the element route
 * changes move focus to. An auth screen that rolled its own heading would drop
 * out of that system the moment the user moved between /sign-in and /register.
 *
 * The footer is separated by a hairline instead of floating under the card so
 * the card stays one object: the task inside it, and the way out of it.
 */
export interface AuthPageProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function AuthPage({
  title,
  description,
  children,
  footer,
}: AuthPageProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <div>{children}</div>
      {footer ? (
        <div className="text-muted-foreground border-t pt-4 text-sm text-pretty">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/**
 * An outcome that replaces a form: a link sent, an address confirmed, a token
 * that has expired, a server that will not create accounts.
 *
 * Not <EmptyState>: that is for a list with nothing in it and draws its own
 * dashed container, which reads as "content will appear here". These are
 * terminal states of a completed action, so they get a solid tonal chip and
 * sit directly on the card.
 *
 * `tone` maps onto the app's semantic tokens rather than raw colours —
 * `destructive` stays reserved for failures, `warning` for advisory states
 * (per the shell contract), and success borrows the diff-added pair, which is
 * the same choice Settings' server status already makes for "Available".
 */
const TONES = {
  success: "bg-diff-added text-diff-added-foreground",
  info: "bg-muted text-muted-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
} as const;

export interface AuthStatusProps {
  tone: keyof typeof TONES;
  icon: LucideIcon;
  children: React.ReactNode;
  /** Buttons or links offering the way forward. There should always be one. */
  actions?: React.ReactNode;
  className?: string;
}

export function AuthStatus({
  tone,
  icon: Icon,
  children,
  actions,
  className,
}: AuthStatusProps) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            TONES[tone],
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 space-y-2 text-sm text-pretty">{children}</div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 pl-11">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * Verbatim machine text inside a sentence — an env var name, a URL delimiter.
 *
 * Uses the code tokens rather than a bare <code> so it reads as machine output
 * on both themes and stays consistent with the LaTeX source and compiler logs
 * elsewhere in the app.
 */
export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-code text-code-foreground border-code-border rounded border px-1 py-px font-mono text-[0.8125em]">
      {children}
    </code>
  );
}
