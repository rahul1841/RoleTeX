"use client";

import * as React from "react";
import { cn } from "cn";
import {
  useFormContext,
  type FieldPath,
  type RegisterOptions,
} from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ResumeFormValues } from "./resume-form";

export type ResumeFieldName = FieldPath<ResumeFormValues>;

/**
 * The builder's labelled inputs.
 *
 * The builder has, on a full resume, well over a hundred inputs. Each one
 * needs a real `<label for>`, an `aria-invalid` flag, and an
 * `aria-describedby` pointing at whichever of hint/error is actually rendered.
 * Doing that by hand a hundred times guarantees some of them are wrong, and a
 * wrong one is invisible: the field looks fine and simply never announces its
 * error. So it is done once, here, and every section uses these.
 *
 * These read react-hook-form through context rather than taking `register` as
 * a prop. With eight section components and three levels of nesting, passing
 * it down is a lot of plumbing for no benefit — and `getFieldState` needs the
 * live `formState` anyway, which context provides correctly.
 */

interface FieldFrameProps {
  id: string;
  label: React.ReactNode;
  /** Visually hide the label but keep it for assistive tech. */
  hideLabel?: boolean;
  hint?: React.ReactNode;
  error?: string;
  /** Rendered opposite the label — a character counter, a remove button. */
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

function FieldFrame({
  id,
  label,
  hideLabel,
  hint,
  error,
  action,
  className,
  children,
}: FieldFrameProps) {
  return (
    <div className={cn("space-y-1", className)}>
      <div
        className={cn(
          "flex items-center justify-between gap-3",
          hideLabel && !action && "sr-only",
        )}
      >
        <Label htmlFor={id} className={cn(hideLabel && "sr-only")}>
          {label}
        </Label>
        {action}
      </div>
      {children}
      {/* Only one of the two is described at a time and the error wins: a
          reader that hears both buries the reason the save failed under advice
          the user has already read. */}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-destructive text-xs text-pretty"
        >
          {error}
        </p>
      ) : hint ? (
        <p
          id={`${id}-hint`}
          className="text-muted-foreground text-xs text-pretty"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(
  id: string,
  error: string | undefined,
  hint: React.ReactNode,
): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

/** Everything the two field components share. */
interface BaseFieldProps {
  name: ResumeFieldName;
  label: React.ReactNode;
  hideLabel?: boolean;
  hint?: React.ReactNode;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
  inputClassName?: string;
  action?: React.ReactNode;
  registerOptions?: RegisterOptions<ResumeFormValues, ResumeFieldName>;
}

export function TextField({
  name,
  label,
  hideLabel,
  hint,
  placeholder,
  autoComplete,
  className,
  inputClassName,
  action,
  registerOptions,
  type = "text",
  inputMode,
}: BaseFieldProps & {
  type?: "text" | "email" | "tel" | "url";
  inputMode?: React.ComponentProps<"input">["inputMode"];
}) {
  const form = useFormContext<ResumeFormValues>();
  const generatedId = React.useId();
  const id = `${generatedId}-${name}`;
  const { error } = form.getFieldState(name, form.formState);
  const message = error?.message;

  return (
    <FieldFrame
      id={id}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={message}
      action={action}
      className={className}
    >
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(id, message, hint)}
        className={inputClassName}
        {...form.register(name, registerOptions)}
      />
    </FieldFrame>
  );
}

export function TextAreaField({
  name,
  label,
  hideLabel,
  hint,
  placeholder,
  className,
  inputClassName,
  action,
  registerOptions,
  rows = 2,
}: BaseFieldProps & { rows?: number }) {
  const form = useFormContext<ResumeFormValues>();
  const generatedId = React.useId();
  const id = `${generatedId}-${name}`;
  const { error } = form.getFieldState(name, form.formState);
  const message = error?.message;

  return (
    <FieldFrame
      id={id}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={message}
      action={action}
      className={className}
    >
      <Textarea
        id={id}
        rows={rows}
        placeholder={placeholder}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(id, message, hint)}
        className={cn("min-h-0 resize-y", inputClassName)}
        {...form.register(name, registerOptions)}
      />
    </FieldFrame>
  );
}

/**
 * An error that belongs to an array rather than to any one input.
 *
 * "List at least one skill" is about the group, not about a text box, so it
 * has nowhere to attach through `aria-describedby`. Rendering it as an alert
 * next to the group is the honest alternative.
 */
export function ArrayError({ name }: { name: ResumeFieldName }) {
  const form = useFormContext<ResumeFormValues>();
  const { error } = form.getFieldState(name, form.formState);
  const message = error?.message;
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-xs text-pretty">
      {message}
    </p>
  );
}

/**
 * A live "31 / 120" counter for the fields with a hard cap.
 *
 * Only shown once the value is close to the limit — a counter that is always
 * visible is noise on a field nobody will ever fill, and this form has a lot
 * of fields.
 */
export function CharacterCount({
  name,
  max,
  showFrom = 0.75,
}: {
  name: ResumeFieldName;
  max: number;
  showFrom?: number;
}) {
  const form = useFormContext<ResumeFormValues>();
  const value = form.watch(name);
  const length = typeof value === "string" ? value.length : 0;
  if (length < max * showFrom) return null;
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        length > max ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {length} / {max}
    </span>
  );
}
