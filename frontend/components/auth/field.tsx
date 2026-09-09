"use client";

import * as React from "react";
import { cn } from "cn";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A labelled input with its error and hint wired up.
 *
 * Every auth form needs the same four things around an <Input>: a real <label
 * htmlFor>, an optional hint, an error message, and the aria wiring that ties
 * them together. Doing that by hand five times is how one of them ends up
 * missing `aria-describedby` and the error becomes invisible to a screen
 * reader. The ids are derived from one `id` prop so they cannot drift.
 *
 * Only ONE of hint and error is described at a time, and the error wins: a
 * screen reader that reads both would bury the reason the submit failed under
 * advice the user has already read.
 */
export interface FieldProps {
  /** Also the base for the hint and error ids. Must be unique on the page. */
  id: string;
  label: React.ReactNode;
  /** Server or client validation message. Presence marks the field invalid. */
  error?: string;
  /** Guidance shown while the field is valid. */
  hint?: React.ReactNode;
  /**
   * Rendered opposite the label — "Forgot your password?", for instance.
   * Deliberately a sibling of the <label> rather than a child of it: a link
   * inside a label inherits the label's click-forwarding and focuses the input
   * instead of following the href.
   */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Field({
  id,
  label,
  error,
  hint,
  action,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {action}
      </div>
      {children}
      {error ? (
        <p
          id={errorId(id)}
          // `alert` rather than a polite region: this appears in response to a
          // submit the user just made, so interrupting is the correct level.
          role="alert"
          className="text-destructive text-xs text-pretty"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={hintId(id)} className="text-muted-foreground text-xs text-pretty">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function errorId(id: string): string {
  return `${id}-error`;
}

export function hintId(id: string): string {
  return `${id}-hint`;
}

/**
 * The `aria-describedby` value matching what <Field> will actually render.
 *
 * Returns undefined rather than "" when there is nothing to describe —
 * `aria-describedby=""` is a dangling reference and some screen readers
 * announce it as a missing element.
 */
export function describedBy(
  id: string,
  options: { error?: unknown; hint?: unknown },
): string | undefined {
  if (options.error) return errorId(id);
  if (options.hint) return hintId(id);
  return undefined;
}

/**
 * A password input with a reveal toggle.
 *
 * The toggle is why none of these forms ask the user to type a password twice.
 * A confirmation field only catches a typo the user cannot see; letting them
 * see it catches the typo directly, works for a password manager, and removes
 * a field from every form. `aria-pressed` is what tells assistive tech the
 * button is a two-state control rather than an action.
 *
 * `ref`, `name`, `onChange` and `onBlur` from `register()` pass straight
 * through to the real input, so react-hook-form's focus-first-invalid-field
 * behaviour still lands here.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false);
  const Icon = visible ? EyeOffIcon : EyeIcon;

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("pr-8", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 -translate-y-1/2"
        onClick={() => setVisible((current) => !current)}
      >
        <Icon aria-hidden="true" />
      </Button>
    </div>
  );
}
