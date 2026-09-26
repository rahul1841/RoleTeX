import * as React from "react";
import { cn } from "cn";
import type { DiffSpan } from "@/components/tailor";

/**
 * One before or after line, drawn the way the change list draws it.
 *
 * A static twin of the `ChangeLine` inside components/tailor/change-list.tsx,
 * for the landing page's pictures of the product. That one lives in a client
 * module and carries review state; these are illustrations inside
 * `role="img"` containers, so they are plain markup with nothing to focus.
 */
const TONES = {
  removed: {
    row: "bg-diff-removed text-diff-removed-foreground border-diff-removed-border",
    mark: "bg-diff-removed-border/60",
    sign: "−",
  },
  added: {
    row: "bg-diff-added text-diff-added-foreground border-diff-added-border",
    mark: "bg-diff-added-border/60",
    sign: "+",
  },
} as const;

export interface PreviewLineProps {
  tone: keyof typeof TONES;
  text: string;
  /** Word-level highlights from `wordDiff`; plain text when absent. */
  spans?: DiffSpan[];
  size?: "default" | "sm";
}

export function PreviewLine({
  tone,
  text,
  spans,
  size = "default",
}: PreviewLineProps) {
  const style = TONES[tone];

  return (
    <div
      className={cn(
        "grid items-start gap-x-1 rounded-md border-l-2 text-pretty",
        size === "sm"
          ? "grid-cols-[1rem_1fr] py-1 pr-2 text-xs leading-[1.125rem]"
          : "grid-cols-[1.15rem_1fr] py-1.5 pr-2.5 text-sm leading-6",
        style.row,
      )}
    >
      <span className="text-center font-mono opacity-60 select-none">
        {style.sign}
      </span>
      <span>
        {spans
          ? spans.map((span, index) =>
              span.changed ? (
                <mark
                  key={index}
                  className={cn(
                    "rounded-[3px] bg-transparent text-inherit",
                    style.mark,
                  )}
                >
                  {span.text}
                </mark>
              ) : (
                <React.Fragment key={index}>{span.text}</React.Fragment>
              ),
            )
          : text}
      </span>
    </div>
  );
}
