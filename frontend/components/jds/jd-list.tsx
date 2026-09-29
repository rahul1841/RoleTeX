"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import {
  ClipboardPasteIcon,
  HistoryIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  EmptyState,
  ErrorState,
  ListSkeleton,
  LoadingState,
} from "@/components/common";
import type { JdSummary } from "@/lib/api/types";
import { useJds } from "@/hooks/use-jds";
import { describeJdFailure } from "./errors";
import { formatAbsolute, formatRelative, parseDate } from "./format";
import { DEFAULT_JD_SORT, JD_SORTS, isJdSort, type JdSort } from "./schema";

/** One stable identity for "no job descriptions", shared by every render. */
const EMPTY: JdSummary[] = [];

/**
 * `value`, but only once it has stopped changing for `delayMs`.
 *
 * Exists solely to keep the results announcement out of the way of the user's
 * typing; nothing visible depends on it. The state write is inside the timeout
 * rather than in the effect body, which is both what makes it a debounce and
 * what keeps it out of the cascading-render pattern the effect rules forbid.
 */
function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = React.useState(value);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

export interface JdListProps {
  /** From `?id=` — the row that renders as current. */
  selectedId: string | null;
  /** Opens the create dialog, from the empty state. */
  onCreate: () => void;
}

/**
 * The library rail: every saved job description, searchable and sortable.
 *
 * SEARCH AND SORT ARE CLIENT-SIDE, and that is a fact about the API rather
 * than a shortcut. `GET /api/jds` takes no query parameters and returns the
 * whole library in one response, capped by the server's per-user quota
 * (50 by default, verified against the running server), so there is nothing to
 * paginate and no request to re-issue when the query changes — filtering the
 * loaded array is both simpler and faster than anything involving the network.
 *
 * The one thing that has to be said out loud is what search can actually see:
 * a summary carries `title` and a 160-character `excerpt`, never the body. A
 * search box that silently failed to match a requirement buried on line 40
 * would be worse than no search box, so the scope is stated whenever a query
 * is active.
 */
export function JdList({ selectedId, onCreate }: JdListProps) {
  const searchId = React.useId();
  const jds = useJds();

  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<JdSort>(DEFAULT_JD_SORT);

  // `jds.data` is the memo's dependency, not a `?? []` fallback: the fallback
  // would be a fresh array identity on every render and would re-sort the list
  // on every keystroke anywhere on the page.
  const all = jds.data ?? EMPTY;
  const visible = React.useMemo(
    () => filterAndSort(jds.data ?? EMPTY, query, sort),
    [jds.data, query, sort],
  );

  const summary = query.trim()
    ? `${visible.length} of ${all.length} match “${query.trim()}” — titles and the 160-character excerpt the server returns, not the full text.`
    : `${all.length} saved`;
  const announcedSummary = useSettled(summary, 500);

  if (jds.isPending) {
    return (
      <LoadingState label="Loading job descriptions…">
        <ListSkeleton rows={5} />
      </LoadingState>
    );
  }

  if (jds.isError) {
    const copy = describeJdFailure(jds.error, "Could not load your job descriptions");
    return (
      <ErrorState
        error={jds.error}
        title={copy.title}
        onRetry={copy.retryable ? () => void jds.refetch() : undefined}
      />
    );
  }

  if (all.length === 0) {
    return <EmptyLibrary onCreate={onCreate} />;
  }

  return (
    <section aria-labelledby={`${searchId}-heading`} className="space-y-3">
      <h2 id={`${searchId}-heading`} className="sr-only">
        Job description library
      </h2>

      <div className="flex items-baseline justify-between gap-2 px-1">
        <p className="text-sm font-medium">Saved postings</p>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {all.length}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Label htmlFor={searchId} className="sr-only">
            Search job descriptions
          </Label>
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles and excerpts"
            autoComplete="off"
            spellCheck={false}
            // Safari and Chrome draw their own clear affordance inside a
            // `type=search` input; two of them side by side is a bug report
            // waiting to happen, and only the styled one is keyboard
            // labelled.
            className="bg-card h-10 rounded-xl pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
            >
              <XIcon aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        <Select
          items={JD_SORTS}
          value={sort}
          onValueChange={(next) => {
            if (typeof next === "string" && isJdSort(next)) setSort(next);
          }}
        >
          <SelectTrigger
            aria-label="Sort job descriptions"
            className="bg-card shrink-0 rounded-xl data-[size=default]:h-10"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(JD_SORTS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Two elements for one sentence, deliberately. Filtering re-renders the
          list with no other signal, so a keyboard user who has not left the
          search box needs telling that something happened — but a live region
          wired straight to the count reads a new sentence on every keystroke,
          over the top of their own typing. The visible copy updates instantly
          and is hidden from assistive tech; the announcement lands once the
          user stops typing. */}
      {query.trim() ? (
        <p aria-hidden="true" className="text-muted-foreground px-1 text-xs text-pretty">
          {summary}
        </p>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {announcedSummary}
      </span>

      {visible.length === 0 ? (
        <EmptyState
          title="No matches"
          description="Nothing in the library matches that. Search covers titles and excerpts only, not the full posting."
          action={
            <Button variant="outline" size="sm" onClick={() => setQuery("")}>
              Clear search
            </Button>
          }
          className="py-8"
        />
      ) : (
        <ul className="bg-card divide-border divide-y overflow-hidden rounded-[1.25rem] ring-1 ring-foreground/10">
          {visible.map((jd) => (
            <li key={jd.id}>
              <JdListRow jd={jd} selected={jd.id === selectedId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One row.
 *
 * A real `<Link>` rather than a button that pushes: selection lives in the URL
 * (`/jds?id=…`), so middle-click, ⌘-click and "copy link address" all have to
 * work, and only an anchor with a genuine href gives them for free.
 */
function JdListRow({ jd, selected }: { jd: JdSummary; selected: boolean }) {
  return (
    <Link
      href={`/jds?id=${encodeURIComponent(jd.id)}`}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "block px-4 py-3.5 outline-none transition-colors",
        // Raised above its siblings so the ring is not clipped by the
        // neighbouring row's background or the list's rounded overflow.
        "focus-visible:ring-ring/50 focus-visible:relative focus-visible:z-10 focus-visible:ring-3",
        selected
          ? "bg-muted shadow-[inset_3px_0_0_0_var(--primary)]"
          : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-[0.9375rem] leading-snug font-medium">
          {jd.title}
        </span>
        <Badge variant="outline" className="bg-card shrink-0 font-mono">
          v{jd.version}
        </Badge>
      </div>
      {jd.excerpt ? (
        <p className="text-muted-foreground mt-1.5 line-clamp-2 text-[0.8125rem] leading-5">
          {jd.excerpt}
        </p>
      ) : null}
      <p
        className="text-muted-foreground mt-2 font-mono text-[0.6875rem]"
        title={formatAbsolute(jd.updated_at)}
      >
        Updated {formatRelative(jd.updated_at)}
      </p>
    </Link>
  );
}

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ClipboardPasteIcon,
    title: "Paste the posting once",
    body: "As published — responsibilities, requirements, the lot. It is stored verbatim and read as reference data, never as instructions.",
  },
  {
    icon: SparklesIcon,
    title: "Tailor any resume against it",
    body: "Pick it on the tailor screen instead of pasting it again, as many times and with as many resumes as you like.",
  },
  {
    icon: HistoryIcon,
    title: "Edits keep the old wording",
    body: "Changing the text records a new version; the earlier one is archived rather than overwritten.",
  },
];

/** Empty library: what saving a posting gets you, and the way in. */
function EmptyLibrary({ onCreate }: { onCreate: () => void }) {
  return (
    <section aria-labelledby="jds-empty-heading" className="space-y-8">
      <div className="bg-card flex flex-col items-start gap-5 rounded-[1.25rem] p-7 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between sm:p-9">
        <div className="space-y-2">
          <h2
            id="jds-empty-heading"
            className="font-heading text-2xl font-semibold tracking-tight"
          >
            No job descriptions yet
          </h2>
          <p className="text-muted-foreground max-w-xl text-[0.9375rem] leading-6 text-pretty">
            Save the postings you are applying to, and every tailoring run is one
            click away from the right one.
          </p>
        </div>
        <Button onClick={onCreate} className="h-11 shrink-0 rounded-xl px-5 text-[0.9375rem]">
          <PlusIcon data-icon="inline-start" />
          Add your first posting
        </Button>
      </div>

      <ol className="grid gap-5 md:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <li
            key={title}
            className="bg-card flex flex-col gap-2 rounded-[1.25rem] p-6 ring-1 ring-foreground/10"
          >
            {/* The <ol> already numbers the steps for assistive tech. */}
            <span aria-hidden="true" className="text-muted-foreground flex items-center gap-2 font-mono text-xs">
              {String(index + 1).padStart(2, "0")}
              <Icon className="size-3.5" />
            </span>
            <h3 className="font-heading text-lg font-semibold tracking-tight">{title}</h3>
            <p className="text-muted-foreground text-[0.9375rem] leading-6 text-pretty">
              {body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Newest first, with a missing timestamp sorting last rather than first. */
function byDateDesc(a: string | null | undefined, b: string | null | undefined): number {
  const left = parseDate(a)?.getTime() ?? -Infinity;
  const right = parseDate(b)?.getTime() ?? -Infinity;
  return right - left;
}

function filterAndSort(
  jds: JdSummary[],
  query: string,
  sort: JdSort,
): JdSummary[] {
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? jds.filter(
        (jd) =>
          jd.title.toLowerCase().includes(needle) ||
          jd.excerpt.toLowerCase().includes(needle),
      )
    : jds;

  // Copied before sorting: `matched` is the query's own array when a filter is
  // active, but it is the cached array itself when there is no query, and
  // sorting that in place would mutate TanStack Query's cache.
  const ordered = [...matched];

  switch (sort) {
    case "created":
      return ordered.sort((a, b) => byDateDesc(a.created_at, b.created_at));
    case "title":
      return ordered.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
      );
    case "updated":
    default:
      return ordered.sort((a, b) => byDateDesc(a.updated_at, b.updated_at));
  }
}
