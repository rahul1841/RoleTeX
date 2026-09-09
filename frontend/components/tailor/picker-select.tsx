"use client";

import { Controller, type Control } from "react-hook-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TailorFormValues } from "./form-values";

/**
 * The one select shape this form uses three times: pick a saved resume, a
 * saved job description, or a provider.
 *
 * Two details worth doing once rather than three times. Base UI shows its
 * placeholder — and sets `data-placeholder` on the trigger, which is what
 * mutes the text — only when the value is `null`, while react-hook-form wants
 * `""` for "nothing chosen"; the two are translated here. And the trigger is
 * exposed through `triggerRef` so the form can move focus to the first invalid
 * field on a failed submit, which a Controller-wrapped select otherwise makes
 * impossible.
 */
export interface PickerOption {
  value: string;
  label: string;
  /** Right-aligned secondary text: a version number, "no key". */
  meta?: string;
}

export interface PickerSelectProps {
  id: string;
  name: "resumeId" | "jdId" | "provider";
  control: Control<TailorFormValues>;
  options: readonly PickerOption[];
  placeholder: string;
  invalid?: boolean;
  describedBy?: string;
  triggerRef?: (element: HTMLElement | null) => void;
}

export function PickerSelect({
  id,
  name,
  control,
  options,
  placeholder,
  invalid,
  describedBy,
  triggerRef,
}: PickerSelectProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select
          value={field.value || null}
          onValueChange={(next) => field.onChange((next as string | null) ?? "")}
        >
          <SelectTrigger
            id={id}
            ref={triggerRef}
            className="w-full"
            aria-invalid={invalid}
            aria-describedby={describedBy}
          >
            <SelectValue placeholder={placeholder}>
              {(value) =>
                options.find((option) => option.value === value)?.label ??
                placeholder
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="truncate">{option.label}</span>
                {option.meta ? (
                  <span className="text-muted-foreground ml-auto text-xs">
                    {option.meta}
                  </span>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );
}
