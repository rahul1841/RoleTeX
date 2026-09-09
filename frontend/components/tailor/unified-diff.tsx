"use client";

import * as React from "react";
import { cn } from "cn";
import { CopyButton } from "@/components/common";

/**
 * The unified diff `POST /api/tailor` returns, rendered as one.
 *
 * rules.md R-14 requires the diff to travel with the PDF, so it gets a real
 * renderer rather than a `<pre>` dump: line-number gutters for both sides, a
 * sign column, and the `diff-added` / `diff-removed` token trios from
 * app/globals.css. Those tokens exist precisely so this screen does not invent
 * its own greens and reds — and they are why the app's accent is indigo, which
 * cannot be confused with either.
 *
 * Colour is never the only signal: every changed row also carries a `+`/`-`
 * sign and an `sr-only` word, so the diff survives greyscale, colour-vision
 * differences and a screen reader.
 */

type RowKind = "meta" | "hunk" | "add" | "remove" | "context";

interface DiffRow {
  kind: RowKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) {
      rows.push({ kind: "meta", text: line, oldLine: null, newLine: null });
      continue;
    }

    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ kind: "hunk", text: line, oldLine: null, newLine: null });
      continue;
    }

    if (line.startsWith("+")) {
      rows.push({
        kind: "add",
        text: line.slice(1),
        oldLine: null,
        newLine: newLine++,
      });
      continue;
    }

    if (line.startsWith("-")) {
      rows.push({
        kind: "remove",
        text: line.slice(1),
        oldLine: oldLine++,
        newLine: null,
      });
      continue;
    }

    // difflib emits context lines with a leading space; an empty context line
    // is therefore a single space, not an empty string.
    rows.push({
      kind: "context",
      text: line.startsWith(" ") ? line.slice(1) : line,
      oldLine: oldLine++,
      newLine: newLine++,
    });
  }

  // A trailing newline produces one empty context row that means nothing.
  while (rows.length > 0 && rows[rows.length - 1].kind === "context" && rows[rows.length - 1].text === "") {
    rows.pop();
  }

  return rows;
}

const ROW_STYLES: Record<RowKind, string> = {
  meta: "text-muted-foreground",
  hunk: "bg-muted/70 text-muted-foreground",
  add: "bg-diff-added text-diff-added-foreground",
  remove: "bg-diff-removed text-diff-removed-foreground",
  context: "text-code-foreground",
};

const GUTTER_STYLES: Record<RowKind, string> = {
  meta: "border-transparent",
  hunk: "border-transparent",
  add: "border-diff-added-border",
  remove: "border-diff-removed-border",
  context: "border-transparent",
};

const SIGNS: Record<RowKind, string> = {
  meta: "",
  hunk: "",
  add: "+",
  remove: "-",
  context: " ",
};

export interface UnifiedDiffProps {
  diff: string;
  className?: string;
}

export function UnifiedDiff({ diff, className }: UnifiedDiffProps) {
  const rows = React.useMemo(() => parseUnifiedDiff(diff), [diff]);

  const added = rows.filter((row) => row.kind === "add").length;
  const removed = rows.filter((row) => row.kind === "remove").length;

  return (
    <div
      className={cn(
        "border-code-border bg-code overflow-hidden rounded-xl border",
        className,
      )}
    >
      <div className="border-code-border/70 flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          Unified diff
        </span>
        <span className="flex items-center gap-1.5 text-xs tabular-nums">
          <span className="text-diff-added-foreground">+{added}</span>
          <span className="text-diff-removed-foreground">&minus;{removed}</span>
        </span>
        <CopyButton
          value={diff}
          subject="Unified diff"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground ml-auto"
        />
      </div>

      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full border-collapse font-mono text-xs leading-relaxed">
          <caption className="sr-only">
            Unified diff of the tailored resume: {added} added lines, {removed}{" "}
            removed lines.
          </caption>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className={ROW_STYLES[row.kind]}>
                <td
                  aria-hidden="true"
                  className="text-muted-foreground/60 w-10 min-w-10 border-r border-transparent px-2 text-right align-top tabular-nums select-none"
                >
                  {row.oldLine ?? ""}
                </td>
                <td
                  aria-hidden="true"
                  className="text-muted-foreground/60 w-10 min-w-10 px-2 text-right align-top tabular-nums select-none"
                >
                  {row.newLine ?? ""}
                </td>
                <td
                  aria-hidden="true"
                  className={cn(
                    "w-5 min-w-5 border-l-2 pl-1.5 text-center align-top select-none",
                    GUTTER_STYLES[row.kind],
                  )}
                >
                  {SIGNS[row.kind]}
                </td>
                <td className="w-full py-px pr-3 pl-1 align-top break-words whitespace-pre-wrap">
                  {row.kind === "add" ? (
                    <span className="sr-only">Added: </span>
                  ) : row.kind === "remove" ? (
                    <span className="sr-only">Removed: </span>
                  ) : null}
                  {row.text || " "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
