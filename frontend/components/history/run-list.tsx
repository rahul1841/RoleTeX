"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { RunSummary } from "@/lib/api/types";
import { RunFlags } from "./run-flags";
import {
  describeTarget,
  formatEngine,
  formatPageCount,
  formatRunTimestamp,
} from "./format";

export interface RunListProps {
  runs: readonly RunSummary[];
  selectedId: string | null;
  className?: string;
}

/** Build the URL that selects a run. Query params, not a dynamic segment —
 *  production is a static export and `generateStaticParams` cannot know ids. */
export function runHref(runId: string): string {
  return `/history?run=${encodeURIComponent(runId)}`;
}

/**
 * The spine of the history screen: every run, newest first.
 *
 * Each row answers the three questions someone scanning their history actually
 * has — which resume, against which job, and did it produce a PDF — in that
 * order, with the engine and version on a dimmer meta line underneath. Rows
 * are real links so the selection is bookmarkable, survives a reload, and can
 * be opened in a new tab.
 */
export function RunList({ runs, selectedId, className }: RunListProps) {
  const [query, setQuery] = React.useState("");
  const filterId = React.useId();

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return runs;
    return runs.filter((run) =>
      [
        run.resume_name,
        run.jd_title ?? "",
        run.jd_excerpt,
        run.provider,
        run.model,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [runs, query]);

  return (
    <div
      className={cn(
        "bg-card flex flex-col overflow-hidden rounded-xl border",
        className,
      )}
    >
      <div className="space-y-2.5 border-b px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-heading text-sm font-medium">Runs</h2>
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            {query.trim() ? `${filtered.length}/${runs.length}` : runs.length}
          </span>
        </div>
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <label htmlFor={filterId} className="sr-only">
            Filter runs by resume, job description or model
          </label>
          <Input
            id={filterId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter runs…"
            className="pl-8"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground px-3 py-8 text-center text-sm text-balance">
          No run matches “{query.trim()}”.
        </p>
      ) : (
        <ul className="divide-border min-h-0 divide-y overflow-y-auto">
          {filtered.map((run) => (
            <RunRow key={run.id} run={run} selected={run.id === selectedId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RunRow({ run, selected }: { run: RunSummary; selected: boolean }) {
  const time = formatRunTimestamp(run.created_at);
  const pages = formatPageCount(run.page_count);

  return (
    <li>
      <Link
        href={runHref(run.id)}
        // `aria-current="true"` rather than "page": the URL does change, but
        // the destination is a pane within this page, not a different one.
        aria-current={selected ? "true" : undefined}
        className={cn(
          "focus-visible:ring-ring/50 relative block px-3 py-2.5 outline-none transition-colors focus-visible:ring-3 focus-visible:-outline-offset-2",
          selected ? "bg-muted" : "hover:bg-muted/50",
        )}
      >
        {selected ? (
          <span
            aria-hidden="true"
            className="bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-r-full"
          />
        ) : null}

        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {run.resume_name || "Untitled resume"}
          </span>
          <time
            dateTime={time.iso}
            title={time.absolute}
            className="text-muted-foreground shrink-0 text-xs"
          >
            {time.relative}
          </time>
        </div>

        <p className="text-muted-foreground mt-0.5 truncate text-sm">
          {describeTarget(run.jd_title, run.jd_excerpt)}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground/80 truncate font-mono text-[0.6875rem]">
            v{run.resume_version} · {formatEngine(run.provider, run.model)}
            {pages ? ` · ${pages}` : ""}
          </span>
          <RunFlags run={run} />
        </div>
      </Link>
    </li>
  );
}
