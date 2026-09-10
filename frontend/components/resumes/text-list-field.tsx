"use client";

import * as React from "react";
import { cn } from "cn";
import { PlusIcon, TrashIcon } from "lucide-react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { MoveButtons, useAnnounce } from "./entry-card";
import { ArrayError, TextAreaField, type ResumeFieldName } from "./fields";
import type { ResumeFormValues } from "./resume-form";

/**
 * Every place the form edits an ordered list of plain lines.
 *
 * Five sections need exactly this control — experience bullets, project
 * bullets, custom-section lines, education details and achievements — so it
 * exists once. Each is stored as `{ value }` objects rather than bare strings
 * for the reason spelled out in `resume-form.ts`: `useFieldArray` needs a
 * stable per-row key, and an array of strings has none, so a reorder would
 * remount every row below the move and drop focus.
 */
export type TextListName =
  | "achievements"
  | `experience.${number}.bullets`
  | `projects.${number}.bullets`
  | `custom_sections.${number}.bullets`
  | `education.${number}.details`;

export interface TextListFieldProps {
  name: TextListName;
  /** Singular noun for one line: "Bullet", "Detail", "Achievement". */
  subject: string;
  label: string;
  /** Shown above the list; omit when the section heading already says it. */
  hideLabel?: boolean;
  placeholder?: string;
  hint?: React.ReactNode;
  /** Server-side cap on the array (backend/app/schemas.py). */
  max: number;
  rows?: number;
  className?: string;
}

export function TextListField({
  name,
  subject,
  label,
  hideLabel = false,
  placeholder,
  hint,
  max,
  rows = 2,
  className,
}: TextListFieldProps) {
  const { control } = useFormContext<ResumeFormValues>();
  const { fields, append, remove, move } = useFieldArray({ control, name });
  const announce = useAnnounce();
  const listId = React.useId();

  const atLimit = fields.length >= max;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <span
          id={listId}
          className={cn(
            "text-muted-foreground text-xs font-medium",
            hideLabel && "sr-only",
          )}
        >
          {label}
        </span>
        {hint && !hideLabel ? (
          <span className="text-muted-foreground text-xs">{hint}</span>
        ) : null}
      </div>

      {fields.length > 0 ? (
        // A real list, so a screen reader announces "list, 4 items" and can
        // jump between them — which is the whole point of ordering these.
        <ul aria-labelledby={listId} className="space-y-2">
          {fields.map((field, index) => (
            <li key={field.id} className="flex items-start gap-1">
              <TextAreaField
                // The path is built from a template literal the compiler
                // cannot narrow through the union above; the shape is checked
                // by `TextListName` itself, which only admits arrays of
                // `{ value: string }`.
                name={`${name}.${index}.value` as ResumeFieldName}
                label={`${label}, ${subject.toLowerCase()} ${index + 1}`}
                hideLabel
                placeholder={index === 0 ? placeholder : undefined}
                rows={rows}
                className="min-w-0 flex-1"
              />
              <div className="flex shrink-0 items-center pt-0.5">
                <MoveButtons
                  index={index}
                  count={fields.length}
                  subject={subject}
                  onMove={move}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    remove(index);
                    announce(`${subject} ${index + 1} removed.`);
                  }}
                  aria-label={`Remove ${subject.toLowerCase()} ${index + 1}`}
                >
                  <TrashIcon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <ArrayError name={name as ResumeFieldName} />

      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={atLimit}
        onClick={() => {
          append({ value: "" });
          announce(`${subject} added.`);
        }}
      >
        <PlusIcon data-icon="inline-start" />
        Add {subject.toLowerCase()}
      </Button>
      {atLimit ? (
        <p className="text-muted-foreground text-xs">
          {max} is the maximum for this list.
        </p>
      ) : null}
    </div>
  );
}
