"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";
import { FileSearchIcon, HistoryIcon, SparklesIcon } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import {
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
      <LoadingState label="Loading your tailoring history…" className="mt-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
          <ListSkeleton rows={5} />
          <CardSkeleton className="hidden lg:block" />
        </div>
      </LoadingState>
    );
  }

  if (runs.isError) {
    return (
      <ErrorState
        className="mt-6"
        error={runs.error}
        title="Your history could not be loaded"
        onRetry={() => void runs.refetch()}
      />
    );
  }

  if (runs.data.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={HistoryIcon}
          title="No tailoring runs yet"
          description="Every time you tailor a resume to a job description, the run is kept here with its change list, its diff and the LaTeX it produced — so you can recompile the PDF later without spending tokens again."
          action={
            <ButtonLink href="/">
              <SparklesIcon data-icon="inline-start" />
              Tailor a resume
            </ButtonLink>
          }
        />
      </div>
    );
  }

  return (
    <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
      <RunList
        runs={runs.data}
        selectedId={selectedId}
        className={cn(
          "lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100svh-6.5rem)]",
          selectedId && "hidden lg:flex",
        )}
      />

      <div className={cn("min-w-0", !selectedId && "hidden lg:block")}>
        {!selectedId ? (
          <EmptyState
            icon={FileSearchIcon}
            title="Select a run"
            description="Pick a run to see the changes it proposed, the diff, the LaTeX it produced, and to recompile its PDF."
          />
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
