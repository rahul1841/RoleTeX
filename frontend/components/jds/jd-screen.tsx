"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState, PageContainer, PageHero } from "@/components/common";
import { useJds } from "@/hooks/use-jds";
import { JdWorkspace } from "./jd-workspace";

/**
 * The /jds screen.
 *
 * A client component so the page file can stay a server component and export
 * `metadata` — the shell's per-route title template ("%s · RoleTeX") only
 * works from a server page, and everything interactive here has to live
 * somewhere else for that to hold.
 *
 * The "New job description" action shows only once there are postings: an
 * empty library offers its own "Add your first posting" button.
 */
export function JdScreen() {
  const [createOpen, setCreateOpen] = React.useState(false);
  // Shares the list's cache entry, so this costs no extra request.
  const jds = useJds();
  const hasAny = (jds.data?.length ?? 0) > 0;

  return (
    <PageContainer width="wide" className="sm:pt-12 sm:pb-16">
      <PageHero
        eyebrow="Library"
        title="Job descriptions"
        description="Postings you have saved, ready to tailor any resume against. Editing one records a new version rather than overwriting it."
        actions={
          hasAny ? (
            <Button className="h-10 rounded-xl px-4" onClick={() => setCreateOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              New job description
            </Button>
          ) : null
        }
      />

      {/* Required by the static export: <JdWorkspace> reads `?id=` with
          `useSearchParams`, and a client hook that reads URL data must have
          a Suspense boundary above it or `next build` refuses to prerender
          the route. */}
      <React.Suspense fallback={<JdWorkspaceFallback />}>
        <JdWorkspace
          createOpen={createOpen}
          onCreateOpenChange={setCreateOpen}
        />
      </React.Suspense>
    </PageContainer>
  );
}

/** Shaped like the two-pane workspace, so nothing jumps when it arrives. */
function JdWorkspaceFallback() {
  return (
    <LoadingState label="Loading job descriptions…">
      <div
        aria-hidden="true"
        className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]"
      >
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-[1.25rem]" />
        </div>
        <Skeleton className="hidden h-96 w-full rounded-[1.25rem] lg:block" />
      </div>
    </LoadingState>
  );
}
