import { Suspense } from "react";
import type { Metadata } from "next";
import {
  CardSkeleton,
  ListSkeleton,
  LoadingState,
  PageContainer,
  PageHeader,
  RequiresStorage,
} from "@/components/common";
import { HistoryWorkspace } from "@/components/history";

export const metadata: Metadata = {
  title: "History",
};

/**
 * Every tailoring run this account has performed.
 *
 * A server component so the route title can come from `metadata` and feed the
 * root layout's "%s · RoleTeX" template; everything interactive lives in
 * <HistoryWorkspace>.
 *
 * The <Suspense> boundary is not optional. <HistoryWorkspace> reads `?run=`
 * with `useSearchParams`, and under `output: "export"` a static page that does
 * that without a boundary fails the build outright.
 *
 * <RequiresStorage> wraps the body rather than the whole page so the heading
 * survives in demo mode: a server with no database has no runs to show, and an
 * empty list would read as "you have not tailored anything yet" instead of
 * "this deployment cannot store anything".
 */
export default function HistoryPage() {
  return (
    <PageContainer width="wide">
      <PageHeader
        title="History"
        description="Every tailoring run, with the changes it proposed, the diff, and the LaTeX it produced. Recompiling a run costs no AI tokens."
      />
      <RequiresStorage feature="Run history">
        <Suspense fallback={<HistorySkeleton />}>
          <HistoryWorkspace />
        </Suspense>
      </RequiresStorage>
    </PageContainer>
  );
}

/** Shaped like the two-pane workspace, so nothing jumps when it resolves. */
function HistorySkeleton() {
  return (
    <LoadingState label="Loading your tailoring history…" className="mt-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        <ListSkeleton rows={5} />
        <CardSkeleton className="hidden lg:block" />
      </div>
    </LoadingState>
  );
}
