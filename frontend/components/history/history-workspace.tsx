"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";
import {
  FileCode2Icon,
  HistoryIcon,
  ListChecksIcon,
  MousePointerClickIcon,
  RefreshCwIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  Canvas,
  CardSkeleton,
  EmptyState,
  ErrorState,
  ListSkeleton,
  LoadingState,
} from "@/components/common";
import { isApiError } from "@/lib/api/errors";
import { useRun, useRuns } from "@/hooks/use-runs";
import { RunDetail } from "./run-detail";
import { RunList } from "./run-list";

/**
 * The history screen: a list of runs beside the selected run's record.
 *
 * SELECTION IS A QUERY PARAM (`/history?run=…`), not a route segment. The
 * production build is a static export, so a `[id]` segment is impossible —
 * `generateStaticParams` cannot enumerate ids that belong to a user's account.
 * Reading it with `useSearchParams` is also why this component is wrapped in
 * <Suspense> by the page: Next client-side renders everything below the
 * boundary rather than prerendering it.
 *
 * On small screens the two panes become one: selecting a run replaces the list
 * (the detail carries its own "All runs" link back), because a phone-width
 * column of run rows above a full run record means scrolling past the whole
 * list to reach what you just chose.
 */
export function HistoryWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("run");

  const runs = useRuns();
  const detail = useRun(selectedId);

  const clearSelection = React.useCallback(() => {
    // `replace`, not `push`: the run that was selected is gone, so putting it
    // back in the history stack only sets up a Back that lands on a 404.
    router.replace("/history");
  }, [router]);

  if (runs.isPending) {
    return (
      <LoadingState label="Loading your tailoring history…" className="mt-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:gap-8">
          <ListSkeleton rows={5} />
          <CardSkeleton className="hidden lg:block" />
        </div>
      </LoadingState>
    );
  }

  if (runs.isError) {
    return (
      <ErrorState
        className="mt-10"
        error={runs.error}
        title="Your history could not be loaded"
        onRetry={() => void runs.refetch()}
      />
    );
  }

  if (runs.data.length === 0) {
    return <EmptyHistory />;
  }

  return (
    <div className="mt-10 grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:gap-8">
      <RunList
        runs={runs.data}
        selectedId={selectedId}
        className={cn(
          "lg:sticky lg:top-[5.5rem] lg:max-h-[calc(100svh-7.5rem)]",
          selectedId && "hidden lg:flex",
        )}
      />

      <div className={cn("min-w-0", !selectedId && "hidden lg:block")}>
        {!selectedId ? (
          <Canvas className="flex min-h-[28rem] flex-col items-center justify-center gap-4 px-6 text-center">
            <span
              aria-hidden="true"
              className="bg-card text-muted-foreground flex size-11 items-center justify-center rounded-xl shadow-[0_6px_20px_rgb(21_24_31/0.08)] ring-1 ring-foreground/10"
            >
              <MousePointerClickIcon className="size-5" />
            </span>
            <p className="font-heading text-lg font-semibold tracking-tight">
              Pick a run to open
            </p>
            <p className="text-muted-foreground max-w-sm text-sm leading-6 text-pretty">
              See the changes it proposed, the diff and the LaTeX it produced,
              and recompile its PDF without spending tokens.
            </p>
          </Canvas>
        ) : detail.isPending ? (
          <LoadingState label="Loading this run…">
            <div className="space-y-4">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          </LoadingState>
        ) : detail.isError ? (
          isApiError(detail.error) && detail.error.status === 404 ? (
            <EmptyState
              icon={HistoryIcon}
              title="That run is no longer in your history"
              description="It was deleted, or it belongs to a different account."
              action={
                <Button variant="outline" onClick={clearSelection}>
                  Back to all runs
                </Button>
              }
            />
          ) : (
            <ErrorState
              error={detail.error}
              title="This run could not be loaded"
              onRetry={() => void detail.refetch()}
            />
          )
        ) : (
          <RunDetail
            // Keyed so switching runs resets the open tab and the recompile
            // result — a PDF compiled from one run must never appear as though
            // it belongs to the next.
            key={detail.data.id}
            run={detail.data}
            onDeleted={clearSelection}
          />
        )}
      </div>
    </div>
  );
}

const KEPT: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ListChecksIcon,
    title: "The changes and the diff",
    body: "Every edit the model proposed, before and after, exactly as you reviewed it.",
  },
  {
    icon: FileCode2Icon,
    title: "The LaTeX it produced",
    body: "The source the server rendered, so the document can be rebuilt without the model.",
  },
  {
    icon: RefreshCwIcon,
    title: "A PDF on demand",
    body: "Recompile any run later. Only the LaTeX compiler runs — no AI call, no tokens.",
  },
];

/** No runs yet: what a run keeps, and the way to make one. */
function EmptyHistory() {
  return (
    <section aria-labelledby="history-empty-heading" className="mt-10 space-y-8">
      <div className="bg-card flex flex-col items-start gap-5 rounded-[1.25rem] p-7 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between sm:p-9">
        <div className="space-y-2">
          <h2
            id="history-empty-heading"
            className="font-heading text-2xl font-semibold tracking-tight"
          >
            No tailoring runs yet
          </h2>
          <p className="text-muted-foreground max-w-xl text-[0.9375rem] leading-6 text-pretty">
            Each run you save while tailoring is kept here, so you can come back
            to it after the job description or the resume has changed.
          </p>
        </div>
        <ButtonLink href="/tailor" className="h-11 shrink-0 rounded-xl px-5 text-[0.9375rem]">
          <SparklesIcon data-icon="inline-start" />
          Tailor a resume
        </ButtonLink>
      </div>

      <ol className="grid gap-5 md:grid-cols-3">
        {KEPT.map(({ icon: Icon, title, body }, index) => (
          <li
            key={title}
            className="bg-card flex flex-col gap-2 rounded-[1.25rem] p-6 ring-1 ring-foreground/10"
          >
            {/* The <ol> already numbers these for assistive tech. */}
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
