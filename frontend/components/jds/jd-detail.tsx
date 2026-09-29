"use client";

import * as React from "react";
import { cn } from "cn";
import {
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ScrollTextIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Canvas,
  ConfirmDialog,
  CopyButton,
  ErrorState,
  LoadingState,
} from "@/components/common";
import type { JdDetail } from "@/lib/api/types";
import { useDeleteJd, useJd } from "@/hooks/use-jds";
import { describeJdFailure, jdFailureLine } from "./errors";
import { formatAbsolute, formatRelative } from "./format";
import { JdFormDialog } from "./jd-form-dialog";
import { JdVersionHistory } from "./jd-versions";
import { formatNumber } from "./limits";

export interface JdDetailPanelProps {
  id: string;
  /** Drops `?id=` — used after a delete and to recover from a stale link. */
  onClearSelection: () => void;
}

/**
 * One job description, in full.
 *
 * The panel is keyed on the record's id by its caller, so switching selection
 * remounts it: the tab, the expanded/collapsed state of the text and any open
 * dialog all reset rather than leaking from the previous posting.
 */
export function JdDetailPanel({ id, onClearSelection }: JdDetailPanelProps) {
  const jd = useJd(id);

  if (jd.isPending) {
    return (
      <LoadingState label="Loading job description…">
        <Card>
          <CardHeader>
            <div aria-hidden="true" className="space-y-2">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </CardHeader>
          <CardContent>
            <div aria-hidden="true" className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </CardContent>
        </Card>
      </LoadingState>
    );
  }

  if (jd.isError) {
    const copy = describeJdFailure(jd.error, "Could not load this job description");
    return (
      <ErrorState
        error={jd.error}
        title={copy.title}
        onRetry={copy.retryable ? () => void jd.refetch() : undefined}
        action={
          <Button variant="outline" size="sm" onClick={onClearSelection}>
            Back to the library
          </Button>
        }
      />
    );
  }

  return <JdDetailCard jd={jd.data} onClearSelection={onClearSelection} />;
}

function JdDetailCard({
  jd,
  onClearSelection,
}: {
  jd: JdDetail;
  onClearSelection: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const remove = useDeleteJd();

  return (
    <article aria-labelledby="jd-title" className="space-y-6">
      <div className="bg-card rounded-[1.25rem] p-6 ring-1 ring-foreground/10 sm:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-3">
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs">
              <span className="bg-muted text-foreground rounded-full px-2 py-0.5">
                v{jd.version}
              </span>
              <span title={formatAbsolute(jd.created_at)}>
                added {formatRelative(jd.created_at)}
              </span>
              <span aria-hidden="true" className="opacity-40">·</span>
              <span title={formatAbsolute(jd.updated_at)}>
                updated {formatRelative(jd.updated_at)}
              </span>
              <span aria-hidden="true" className="opacity-40">·</span>
              <span className="tabular-nums">
                {formatNumber(jd.content.length)} characters
              </span>
            </p>
            <h2
              id="jd-title"
              className="font-heading text-2xl leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-3xl"
            >
              {jd.title}
            </h2>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="h-10 rounded-xl px-4"
              onClick={() => setEditing(true)}
            >
              <PencilIcon data-icon="inline-start" />
              Edit
            </Button>
            <ButtonLink
              href={{ pathname: "/tailor", query: { jd: jd.id } }}
              className="h-10 rounded-xl px-4"
            >
              <SparklesIcon data-icon="inline-start" />
              Tailor against this
            </ButtonLink>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-10 rounded-xl"
                    aria-label={`More actions for ${jd.title}`}
                  >
                    <MoreHorizontalIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Delete job description
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <Tabs defaultValue="text" className="gap-5">
        <div className="flex items-center justify-between gap-3">
          <TabsList className="bg-card h-10 rounded-xl p-1 ring-1 ring-foreground/10 group-data-horizontal/tabs:h-10">
            <TabsTrigger value="text" className="rounded-lg px-4">
              <ScrollTextIcon data-icon="inline-start" />
              Posting
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg px-4">
              <HistoryIcon data-icon="inline-start" />
              Versions
              <span className="text-muted-foreground font-mono text-[0.6875rem] tabular-nums">
                {jd.version}
              </span>
            </TabsTrigger>
          </TabsList>
          <CopyButton
            value={jd.content}
            subject="Job description"
            label="Copy text"
            variant="ghost"
            size="sm"
          />
        </div>
        <TabsContent value="text">
          <JdText content={jd.content} />
        </TabsContent>
        <TabsContent value="history">
          <div className="bg-card rounded-[1.25rem] p-6 ring-1 ring-foreground/10 sm:p-7">
            <JdVersionHistory jd={jd} />
          </div>
        </TabsContent>
      </Tabs>

      <JdFormDialog open={editing} onOpenChange={setEditing} jd={jd} />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete “${jd.title}”?`}
        description="This removes the job description and every archived version of it. Past tailoring runs that used it keep their own copy of the text. This cannot be undone."
        confirmLabel="Delete job description"
        pending={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(jd.id);
            toast.success("Job description deleted", { description: jd.title });
            onClearSelection();
          } catch (error) {
            // <ConfirmDialog> swallows the rejection and stays open by
            // contract; saying what went wrong is this caller's job, and
            // re-throwing is what keeps the dialog from closing on a failure.
            toast.error("Could not delete this job description", {
              description: jdFailureLine(error),
            });
            throw error;
          }
        }}
      />
    </article>
  );
}

/** Above this, the text is capped and gets a reveal control. */
const COLLAPSE_ABOVE_CHARACTERS = 1_800;

/**
 * The posting, verbatim (untrusted text: nothing is parsed or linkified). Long
 * ones scroll inside a focusable region until expanded.
 */
function JdText({ content }: { content: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const long = content.length > COLLAPSE_ABOVE_CHARACTERS;

  return (
    <Canvas className="px-3 py-5 sm:px-8 sm:py-8">
      <div
        role="region"
        aria-label="Job description text"
        tabIndex={0}
        className={cn(
          "bg-card focus-visible:ring-ring/50 mx-auto max-w-3xl overflow-auto rounded-sm px-6 py-7 text-[0.9375rem] leading-7 break-words whitespace-pre-wrap shadow-[0_0_0_1px_rgb(21_24_31/0.06),0_16px_48px_rgb(21_24_31/0.10)] outline-none focus-visible:ring-3 sm:px-12 sm:py-10",
          long && !expanded && "max-h-[36rem]",
        )}
      >
        {content}
      </div>
      {long ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="bg-card rounded-lg"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? "Collapse"
              : `Show all ${formatNumber(content.length)} characters`}
          </Button>
        </div>
      ) : null}
    </Canvas>
  );
}
