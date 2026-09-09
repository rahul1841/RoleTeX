import * as React from "react";
import { cn } from "cn";
import { Label } from "@/components/ui/label";

/**
 * A labelled control with its hint, its error and the aria wiring between them.
 *
 * Deliberately local to this feature rather than imported from
 * `components/auth/field.tsx`: that file belongs to the auth screens and is
 * shaped around them (it ships a password reveal), and several features are
 * being built in parallel against it. A twenty-line wrapper is cheaper than a
 * cross-feature dependency on a file somebody else owns.
 *
 * `meter` is the one addition over the usual shape — the JD form needs a live
 * character/byte readout sitting opposite the label, where it is visible while
 * the user types rather than buried under a textarea they have scrolled past.
 *
 * Only ONE of hint and error is ever described, and the error wins: a reader
 * that announced both would bury the reason the submit failed under advice.
 */
export interface JdFieldProps {
  /** Also the stem for the hint and error ids, so they cannot drift apart. */
  id: string;
  label: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  /** Rendered opposite the label. */
  meter?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function JdField({
  id,
  label,
  error,
  hint,
  meter,
  children,
  className,
}: JdFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {meter}
      </div>
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          // `alert`, not a polite region: this appears in response to a submit
          // the user just pressed, so interrupting is the right level.
          role="alert"
          className="text-destructive text-xs text-pretty"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs text-pretty">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The `aria-describedby` value matching what <JdField> will actually render.
 *
 * Returns undefined rather than "" when there is nothing to describe:
 * `aria-describedby=""` is a dangling reference and some screen readers
 * announce it as a missing element.
 */
export function jdDescribedBy(
  id: string,
  options: { error?: unknown; hint?: unknown },
): string | undefined {
  if (options.error) return `${id}-error`;
  if (options.hint) return `${id}-hint`;
  return undefined;
}
