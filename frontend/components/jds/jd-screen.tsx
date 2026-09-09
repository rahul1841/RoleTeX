"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LoadingState,
  PageContainer,
  PageHeader,
  RequiresStorage,
} from "@/components/common";
import { useSession } from "@/hooks/use-session";
import { JdWorkspace } from "./jd-workspace";

/**
 * The /jds screen.
 *
 * A client component so the page file can stay a server component and export
 * `metadata` — the shell's per-route title template ("%s · RoleTeX") only
 * works from a server page, and everything interactive here has to live
 * somewhere else for that to hold.
 *
 * The header sits OUTSIDE <RequiresStorage> on purpose. The gate replaces its
 * children with an explanation when the server has no database, and the page's
 * single <h1> lives in <PageHeader> — if the heading went inside the gate,
 * demo mode would render a page with no <h1> at all and the shell's
 * route-change focus would have nothing to move to.
 *
 * The "New job description" action is hidden rather than disabled in demo
 * mode, because the gate immediately below it is already saying why, and a
 * disabled control repeating the same message would be noise.
 */
export function JdScreen() {
  const { mode } = useSession();
  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Job descriptions"
        description="Postings you have saved, ready to tailor any resume against. Editing one records a new version rather than overwriting it."
        actions={
          mode === "multi_user" ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              New job description
            </Button>
          ) : null
        }
      />

      <RequiresStorage feature="Job descriptions">
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
      </RequiresStorage>
    </PageContainer>
  );
}

/** Shaped like the two-pane workspace, so nothing jumps when it arrives. */
function JdWorkspaceFallback() {
  return (
    <LoadingState label="Loading job descriptions…">
      <div
        aria-hidden="true"
        className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]"
      >
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <Skeleton className="hidden h-80 w-full rounded-xl lg:block" />
      </div>
    </LoadingState>
  );
}
