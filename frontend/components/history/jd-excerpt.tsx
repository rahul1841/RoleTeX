"use client";

import { CopyButton } from "@/components/common";

export interface JdExcerptProps {
  /** The run's stored `jd_excerpt`, verbatim. */
  text: string;
  /** The saved job description's title, when the run used one. */
  title?: string | null;
}

/**
 * The job description text this run was actually tailored against.
 *
 * Uses the `code` tokens, like every other piece of verbatim machine output on
 * this screen — a run stores a truncated *copy*, so what is shown here can
 * differ from the saved job description as it exists now, and the surface is
 * what says "this is the recorded input, not live content".
 *
 * Deliberately NOT `<CodeBlock>` from components/tailor: that block never
 * wraps, which is right for a 200-column LaTeX line and wrong for a paragraph
 * of prose — a job description rendered there would become one horizontal
 * scrollbar. (If `CodeBlock` grows a `wrap` prop, this should collapse into it.)
 */
export function JdExcerpt({ text, title }: JdExcerptProps) {
  return (
    <div className="border-code-border bg-code overflow-hidden rounded-xl border">
      <div className="border-code-border/70 flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          Job description excerpt
        </span>
        <span className="text-muted-foreground/70 min-w-0 truncate text-xs">
          {title?.trim() || "Pasted text"}
        </span>
        <CopyButton
          value={text}
          subject="Job description excerpt"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground ml-auto"
        />
      </div>
      <div className="max-h-96 overflow-y-auto">
        <p className="text-code-foreground px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap">
          {text}
        </p>
      </div>
    </div>
  );
}
