"use client";

import * as React from "react";
import { PaletteIcon } from "lucide-react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FONT_SIZES,
  MARGIN_RANGE,
  type FontSize,
  type ResumeFormValues,
} from "../resume-form";
import { FormSection } from "./section-frame";

/**
 * The three layout knobs the server will actually honour.
 *
 * `sanitize_style` in backend/app/importer.py whitelists exactly this much: a font size
 * from a fixed set, a margin clamped to 1–3cm, and an optional six-digit accent
 * colour. Paper is always A4 and is not offered. Everything else about the
 * document is application code — that is the locked-template safety model, and
 * exposing knobs the server discards would be a lie about what is adjustable.
 */
export function StyleSection() {
  const { control, register, setValue } = useFormContext<ResumeFormValues>();
  const margin = useWatch({ control, name: "style.margin_cm" });
  const accent = useWatch({ control, name: "style.accent_hex" });
  const fontId = React.useId();
  const marginId = React.useId();
  const accentId = React.useId();

  // <input type="color"> cannot be empty; it shows black. The swatch therefore
  // stands in for "no accent" with the template's own default until the user
  // picks something, and the text field remains the source of truth.
  const swatch = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#334155";

  return (
    <FormSection
      id="style"
      icon={PaletteIcon}
      title="Layout"
      description="A4 always. These three are the only style values the server accepts — everything else about the template is fixed."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={fontId}>Font size</Label>
          <Controller
            control={control}
            name="style.font_size"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(value) => {
                  if (value) field.onChange(value as FontSize);
                }}
              >
                <SelectTrigger id={fontId} size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_SIZES.map((size) => (
                    <SelectItem key={size} value={size}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor={marginId}>Margin</Label>
            <span className="text-muted-foreground text-xs tabular-nums">
              {margin.toFixed(1)} cm
            </span>
          </div>
          <input
            id={marginId}
            type="range"
            min={MARGIN_RANGE.min}
            max={MARGIN_RANGE.max}
            step={MARGIN_RANGE.step}
            className="accent-primary h-8 w-full"
            {...register("style.margin_cm", { valueAsNumber: true })}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={accentId}>Accent colour</Label>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={swatch}
              onChange={(event) =>
                setValue("style.accent_hex", event.target.value.toUpperCase(), {
                  shouldDirty: true,
                })
              }
              // The text field beside it carries the label and the value; this
              // is a redundant way to reach the same field, so it is hidden
              // from assistive tech rather than announced twice.
              aria-hidden="true"
              tabIndex={-1}
              className="border-input size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
            />
            <Input
              id={accentId}
              placeholder="#3355FF"
              spellCheck={false}
              className="min-w-0 flex-1 font-mono text-xs uppercase"
              {...register("style.accent_hex")}
            />
            {accent ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() =>
                  setValue("style.accent_hex", "", { shouldDirty: true })
                }
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </FormSection>
  );
}
