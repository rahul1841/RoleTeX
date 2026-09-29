"use client";

import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { z } from "zod";

/**
 * Password rules for new passwords. Mirrors `password_policy_error` in
 * backend/app/security.py — keep them identical; the server stays the authority.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  { id: "lower", label: "A lowercase letter", test: (password) => /[a-z]/.test(password) },
  { id: "upper", label: "An uppercase letter", test: (password) => /[A-Z]/.test(password) },
  { id: "digit", label: "A number", test: (password) => /[0-9]/.test(password) },
  {
    id: "symbol",
    label: "A symbol, like ! @ # or $",
    test: (password) => /[^A-Za-z0-9\s]/.test(password),
  },
];

export function passwordRuleError(password: string): string | null {
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (password !== password.trim()) {
    return "Remove the space at the start or end";
  }
  const unmet = PASSWORD_RULES.find((rule) => !rule.test(password));
  return unmet ? `Your password needs ${unmet.label.toLowerCase()}` : null;
}

/** Zod field for a new password: required and every rule met. */
export function newPasswordField(requiredMessage: string) {
  return z
    .string()
    .min(1, requiredMessage)
    .superRefine((password, ctx) => {
      if (!password) return;
      const error = passwordRuleError(password);
      if (error) ctx.addIssue({ code: "custom", message: error });
    });
}

/** Live checklist; only the "N of 5 met" summary is announced to screen readers. */
export function PasswordChecklist({
  password,
  id,
  className,
}: {
  password: string;
  id?: string;
  className?: string;
}) {
  const met = PASSWORD_RULES.filter((rule) => rule.test(password)).length;

  return (
    <div id={id} className={cn("space-y-2", className)}>
      <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(password);
          return (
            <li
              key={rule.id}
              className={cn(
                "flex items-center gap-2 text-xs transition-colors",
                ok ? "text-diff-added-foreground" : "text-muted-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full transition-colors",
                  ok
                    ? "bg-diff-added text-diff-added-foreground ring-diff-added-border ring-1"
                    : "ring-input ring-[1.5px] ring-inset",
                )}
              >
                {ok ? <CheckIcon className="size-2.5" strokeWidth={3.5} /> : null}
              </span>
              <span>
                {rule.label}
                <span className="sr-only">{ok ? " — met" : " — not yet"}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="sr-only">
        {met} of {PASSWORD_RULES.length} password requirements met
      </p>
    </div>
  );
}
