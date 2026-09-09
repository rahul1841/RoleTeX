"use client";

import * as React from "react";
import { cn } from "cn";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A labelled settings input with its hint, error and aria wiring tied together.
 *
 * Mirrors the shape components/auth/field.tsx uses for the sign-in forms, but
 * kept local: that module is deliberately not exported from the auth barrel
 * (see its header), and settings fields differ in that a hint usually has to
 * survive alongside an error — "the server falls back to the provider default"
 * is still true when the value you typed was rejected.
 *
 * Both ids are derived from one `id` prop so `aria-describedby` cannot drift
 * from what is actually rendered, and the error is announced first because it
 * is the reason the submit failed.
 */
export interface SettingsFieldProps {
  /** Also the base for hint and error ids. Must be unique on the page. */
  id: string;
  label: React.ReactNode;
  /** Presence marks the field invalid; pair with `aria-invalid` on the input. */
  error?: string;
  hint?: React.ReactNode;
  /** Rendered opposite the label — never a control that focuses the input. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function SettingsField({
  id,
  label,
  error,
  hint,
  action,
  children,
  className,
}: SettingsFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {action}
      </div>
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-destructive text-xs text-pretty"
        >
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs text-pretty">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The `aria-describedby` value matching what <SettingsField> will render.
 *
 * Returns undefined rather than "" when there is nothing to describe — an
 * empty `aria-describedby` is a dangling reference some screen readers announce
 * as a missing element.
 */
export function describedBy(
  id: string,
  options: { error?: unknown; hint?: unknown },
): string | undefined {
  const ids = [
    options.error ? `${id}-error` : null,
    options.hint ? `${id}-hint` : null,
  ].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/**
 * A password-type input with a reveal toggle.
 *
 * Used for the two secrets this screen handles — an account password and a
 * provider API key. Revealing is what makes a single field enough: a
 * confirmation field only catches a typo the user cannot see, while showing
 * the value catches it directly and still works with a password manager.
 * `aria-pressed` is what marks the button as a two-state control rather than
 * an action.
 */
export function SecretInput({
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
        className={cn("pr-8 font-mono", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-pressed={visible}
        aria-label={visible ? "Hide value" : "Show value"}
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 -translate-y-1/2"
        onClick={() => setVisible((current) => !current)}
      >
        <Icon aria-hidden="true" />
      </Button>
    </div>
  );
}
