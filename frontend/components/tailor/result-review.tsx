"use client";

import Link from "next/link";
import { ChevronRightIcon, HistoryIcon, WrenchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TailorResponse } from "@/lib/api/types";
import { ChangeList } from "./change-list";
import { CodeBlock } from "./code-block";
import { ResultPdf } from "./result-pdf";
import { RunWarnings } from "./run-warnings";
import { UnifiedDiff } from "./unified-diff";

/**
 * The result of a run — the heart of the screen.
 *
 * rules.md R-14: "The API always returns the change list + unified diff
 * alongside the PDF; the UI must keep showing changes with the preview. Never
 * silently auto-apply." So the layout is a single two-column region, not a tab
 * strip: the change list and the diff are rendered in full, unconditionally,
 * beside the PDF. There is no state of this component in which the document is
 * visible and the changes are not.
 *
 * On narrow viewports the columns stack in DOM order, which puts the review
 * above the document — the right way round for the same reason.
 */
export interface ResultReviewProps {
  result: TailorResponse;
}

export function ResultReview({ result }: ResultReviewProps) {
  const compiled = Boolean(result.pdf_base64);
  const warnings = result.warnings ?? [];
  // `changes` is a required field on TailorResponse, so this is the response's
  // own array — one stable identity per run, which <ChangeList> relies on to
  // know when to reset its per-change "reviewed" marks.
  const changes = result.changes;

  return (
    <section aria-labelledby="result-heading" className="space-y-4">
      <h2 id="result-heading" className="sr-only">
        Tailoring result
      </h2>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <Badge variant="secondary" className="font-mono">
          {result.provider}
          {result.model ? ` · ${result.model}` : ""}
        </Badge>
        {result.repaired ? (
          <Badge variant="outline">
            <WrenchIcon aria-hidden="true" data-icon="inline-start" />
            Repaired once
          </Badge>
        ) : null}
        <span className="text-muted-foreground tabular-nums">
          {changes.length} {changes.length === 1 ? "change" : "changes"}
        </span>
        {result.run_id ? (
          <Link
            href={{ pathname: "/history", query: { run: result.run_id } }}
            className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 underline-offset-3 hover:underline"
          >
            <HistoryIcon aria-hidden="true" className="size-3.5" />
            Saved to History
            <ChevronRightIcon aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>

      <RunWarnings warnings={warnings} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]">
        <div className="min-w-0 space-y-6">
          <ChangeList changes={changes} compiled={compiled} />

          {result.unified_diff.trim() ? (
            <UnifiedDiff diff={result.unified_diff} />
          ) : null}

          <details className="group border-code-border bg-code/60 rounded-xl border">
            <summary className="text-muted-foreground hover:text-foreground marker:content-none flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium select-none [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon
                aria-hidden="true"
                className="size-3.5 transition-transform group-open:rotate-90"
              />
              LaTeX source the server rendered
            </summary>
            <div className="px-2 pb-2">
              <CodeBlock
                label="LaTeX source"
                subject="LaTeX source"
                value={result.latex_source}
                maxHeightClassName="max-h-96"
              />
            </div>
          </details>
        </div>

        <ResultPdf
          className="min-w-0 xl:sticky xl:top-6 xl:self-start"
          base64={result.pdf_base64 ?? null}
          filename={result.filename}
          pageCount={result.page_count ?? null}
          compiler={result.compiler}
        />
      </div>
    </section>
  );
}
