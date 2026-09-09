"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";
import { ArrowLeftIcon, BriefcaseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common";
import { useJds } from "@/hooks/use-jds";
import { JdDetailPanel } from "./jd-detail";
import { JdFormDialog } from "./jd-form-dialog";
import { JdList } from "./jd-list";

export interface JdWorkspaceProps {
  /** Owned by the page header's "New job description" button. */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}

/**
 * The library and the reading pane, and the single place selection is decided.
 *
 * SELECTION IS A QUERY PARAMETER, NOT A ROUTE SEGMENT. Production is a static
 * export (`output: "export"`), so `/jds/[id]` is impossible — `generateStatic
 * Params` would have to enumerate other people's private records at build
 * time. `?id=` costs nothing in exchange: it is still a real URL that can be
 * linked, bookmarked and opened in a new tab, which is why the list rows are
 * anchors rather than buttons.
 *
 * `useSearchParams` is why the caller wraps this in `<Suspense>`; under a
 * static export a client hook that reads URL data has to have a boundary above
 * it or the build fails.
 *
 * LAYOUT. Two panes side by side from `lg`, and one pane below it — a phone
 * cannot usefully show a 21rem list and a 20,000-character posting at once, so
 * the URL decides which of the two is on screen. The same `?id=` drives both,
 * so there is no second notion of "what is open" to keep in sync.
 */
export function JdWorkspace({ createOpen, onCreateOpenChange }: JdWorkspaceProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedId = searchParams.get("id");

  // Shares the cache entry with <JdList>; this costs no extra request and is
  // what lets an empty library take the full width instead of sitting in a
  // narrow rail beside an empty reading pane.
  const jds = useJds();
  const hasAny = (jds.data?.length ?? 0) > 0;
  const twoPane = hasAny || Boolean(selectedId) || jds.isPending || jds.isError;

  const select = React.useCallback(
    (id: string) => router.push(`/jds?id=${encodeURIComponent(id)}`),
    [router],
  );

  /** Leaves history alone: the id being cleared is gone or was never valid. */
  const clearSelection = React.useCallback(() => router.replace("/jds"), [router]);

  /** The mobile "back" affordance, where a history entry is what the user wants. */
  const backToList = React.useCallback(() => router.push("/jds"), [router]);

  return (
    <>
      <div
        className={cn(
          "mt-6 grid gap-6",
          twoPane &&
            "lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]",
        )}
      >
        <div className={cn("min-w-0", selectedId && "hidden lg:block")}>
          {/* Sticky under the 3.5rem app header so the library stays reachable
              while a long posting scrolls beside it. The negative margin plus
              padding keeps focus rings from being clipped by the scroll
              container `overflow-y-auto` creates on both axes. */}
          <div className="lg:sticky lg:top-18 lg:-mx-1 lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto lg:px-1 lg:pb-2">
            <JdList
              selectedId={selectedId}
              onCreate={() => onCreateOpenChange(true)}
            />
          </div>
        </div>

        {twoPane ? (
          <div className={cn("min-w-0", !selectedId && "hidden lg:block")}>
            {selectedId ? (
              <div className="space-y-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={backToList}
                  className="-ml-2 lg:hidden"
                >
                  <ArrowLeftIcon data-icon="inline-start" />
                  All job descriptions
                </Button>
                {/* Keyed so switching postings remounts the panel: the open
                    tab, the expanded text and any dialog reset instead of
                    carrying over from the previous one. */}
                <JdDetailPanel
                  key={selectedId}
                  id={selectedId}
                  onClearSelection={clearSelection}
                />
              </div>
            ) : hasAny ? (
              <EmptyState
                icon={BriefcaseIcon}
                title="Select a job description"
                description="Pick one from the library to read it, edit it into a new version, or check what it looked like before."
                className="h-full"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <JdFormDialog
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        // A newly saved posting is what the user wants to look at next, and
        // selecting it also proves the save landed.
        onSaved={(jd) => select(jd.id)}
      />
    </>
  );
}
