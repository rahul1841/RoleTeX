"use client";

import * as React from "react";
import { cn } from "cn";
import { CopyButton } from "@/components/common";

export interface CodeBlockProps {
  /** Names what the machine produced: "LaTeX source", "Compiler log". */
  label: React.ReactNode;
  value: string;
  /** Subject for the copy button's label and confirmation toast. */
  subject?: string;
  /** Right of the label — a line count, a badge. */
  meta?: React.ReactNode;
  /** Tailwind max-height for the scroll region. */
  maxHeightClassName?: string;
  className?: string;
}

/**
 * Verbatim machine output.
 *
 * Uses the `code` token trio from app/globals.css rather than `card`, which is
 * the whole point of that trio existing: LaTeX source and a Tectonic log are
 * not app content, and reading them as a different surface is what tells the
 * user they are looking at something the server generated.
 *
 * The block scrolls in both directions inside itself. Wrapping a 200-character
 * LaTeX line would make it unreadable, and letting it widen the block would
 * make the whole page scroll sideways.
 */
export function CodeBlock({
  label,
  value,
  subject,
  meta,
  maxHeightClassName = "max-h-80",
  className,
}: CodeBlockProps) {
  const lineCount = React.useMemo(() => value.split("\n").length, [value]);

  return (
    <div
      className={cn(
        "border-code-border bg-code overflow-hidden rounded-xl border",
        className,
      )}
    >
      <div className="border-code-border/70 flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-muted-foreground text-xs font-medium">{label}</span>
        <span className="text-muted-foreground/70 text-xs tabular-nums">
          {meta ?? `${lineCount} ${lineCount === 1 ? "line" : "lines"}`}
        </span>
        <CopyButton
          value={value}
          subject={subject ?? String(label)}
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground ml-auto"
        />
      </div>
      <div className={cn("overflow-auto", maxHeightClassName)}>
        <pre className="text-code-foreground w-max min-w-full px-3 py-2.5 text-xs leading-relaxed">
          {value}
        </pre>
      </div>
    </div>
  );
}
