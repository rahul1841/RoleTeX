import { Suspense } from "react";
import type { Metadata } from "next";
import {
  CardSkeleton,
  ListSkeleton,
  LoadingState,
  PageContainer,
  PageHero,
} from "@/components/common";
import { HistoryActions, HistoryWorkspace } from "@/components/history";

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
 */
export default function HistoryPage() {
  return (
    <PageContainer width="wide" className="sm:pt-12 sm:pb-16">
      <PageHero
        eyebrow="Tailoring runs"
        title="History"
        description="Every tailoring run, with the changes it proposed, the diff, and the LaTeX it produced. Recompiling a run costs no AI tokens."
        actions={<HistoryActions />}
      />
      <Suspense fallback={<HistorySkeleton />}>
        <HistoryWorkspace />
      </Suspense>
    </PageContainer>
  );
}

/** Shaped like the two-pane workspace, so nothing jumps when it resolves. */
function HistorySkeleton() {
  return (
    <LoadingState label="Loading your tailoring history…" className="mt-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:gap-8">
        <ListSkeleton rows={5} />
        <CardSkeleton className="hidden lg:block" />
      </div>
    </LoadingState>
  );
}
