"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { BriefcaseIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
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
    return (
      <EmptyState
        icon={BriefcaseIcon}
        title="No job descriptions yet"
        description="Paste a posting once and tailor as many resumes against it as you like. Editing one later keeps every earlier version."
        action={
          <Button onClick={onCreate}>
            <PlusIcon data-icon="inline-start" />
            New job description
          </Button>
        }
      />
    );
  }

  return (
    <section aria-labelledby={`${searchId}-heading`} className="space-y-3">
      <h2 id={`${searchId}-heading`} className="sr-only">
        Job description library
      </h2>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Label htmlFor={searchId} className="sr-only">
            Search job descriptions
          </Label>
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
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
            className="pr-7 pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 -translate-y-1/2"
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
          <SelectTrigger size="sm" aria-label="Sort job descriptions" className="shrink-0">
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
      <p aria-hidden="true" className="text-muted-foreground text-xs text-pretty">
        {summary}
      </p>
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
        <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border">
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
        "block px-3 py-2.5 outline-none transition-colors",
        // Raised above its siblings so the ring is not clipped by the
        // neighbouring row's background or the list's rounded overflow.
        "focus-visible:ring-ring/50 focus-visible:relative focus-visible:z-10 focus-visible:ring-3",
        selected
          ? "bg-accent shadow-[inset_2px_0_0_0_var(--primary)]"
          : "hover:bg-muted/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm leading-snug font-medium">
          {jd.title}
        </span>
        <Badge variant="outline" className="shrink-0 font-mono">
          v{jd.version}
        </Badge>
      </div>
      {jd.excerpt ? (
        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
          {jd.excerpt}
        </p>
      ) : null}
      <p
        className="text-muted-foreground/80 mt-1.5 text-[0.6875rem]"
        title={formatAbsolute(jd.updated_at)}
      >
        Updated {formatRelative(jd.updated_at)}
      </p>
    </Link>
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
