"use client";

import * as React from "react";
import { cn } from "cn";
import { Label } from "@/components/ui/label";

/**
 * A labelled control with its hint, its error, and the aria wiring between
 * them derived from one id.
 *
 * The same shape as components/auth/field.tsx, and deliberately a second copy
 * rather than a cross-feature import: that one is internal to the auth screens
 * and is not on their barrel. If a third feature needs it, the right move is
 * to promote one of them into components/common — not to reach into another
 * feature's directory.
 *
 * Only ONE of hint and error is described at a time and the error wins, so a
 * screen reader does not bury the reason a submit failed under advice the user
 * has already read.
 */
export interface FormFieldProps {
  /** The control's id, and the stem for the hint and error ids. */
  id: string;
  label: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  /**
   * Rendered opposite the label — the job-description source switch. A sibling
   * of the <label>, never a child: a control inside a label steals its clicks.
   */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function fieldErrorId(id: string): string {
  return `${id}-error`;
}

export function fieldHintId(id: string): string {
  return `${id}-hint`;
}

/**
 * The `aria-describedby` value matching what <FormField> will render.
 *
 * Undefined rather than "" when there is nothing to point at: an empty
 * `aria-describedby` is a dangling reference.
 */
export function describedBy(
  id: string,
  options: { error?: unknown; hint?: unknown },
): string | undefined {
  if (options.error) return fieldErrorId(id);
  if (options.hint) return fieldHintId(id);
  return undefined;
}

export function FormField({
  id,
  label,
  error,
  hint,
  action,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {action}
      </div>
      {children}
      {error ? (
        <p
          id={fieldErrorId(id)}
          // `alert`, not a polite region: this appears in response to a submit
          // the user just made, so interrupting is the right level.
          role="alert"
          className="text-destructive text-xs text-pretty"
        >
          {error}
        </p>
      ) : hint ? (
        <div
          id={fieldHintId(id)}
          className="text-muted-foreground text-xs text-pretty"
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}
