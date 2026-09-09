"use client";

import * as React from "react";
import { cn } from "cn";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
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
    <Card>
      <CardHeader>
        <h2 className="font-heading min-w-0 text-base leading-snug font-medium text-pretty">
          {jd.title}
        </h2>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Badge variant="secondary" className="font-mono">
            v{jd.version}
          </Badge>
          <span title={formatAbsolute(jd.created_at)}>
            Added {formatRelative(jd.created_at)}
          </span>
          <span aria-hidden="true" className="opacity-40">
            ·
          </span>
          <span title={formatAbsolute(jd.updated_at)}>
            Updated {formatRelative(jd.updated_at)}
          </span>
          <span aria-hidden="true" className="opacity-40">
            ·
          </span>
          <span>{formatNumber(jd.content.length)} characters</span>
        </p>

        <CardAction className="flex items-center gap-2">
          <CopyButton
            value={jd.content}
            subject="Job description"
            size="icon-sm"
          />
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2Icon data-icon="inline-start" />
            Delete
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="text">
          <TabsList variant="line">
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="history">Version history</TabsTrigger>
          </TabsList>
          <TabsContent value="text" className="pt-3">
            <JdText content={jd.content} />
          </TabsContent>
          <TabsContent value="history" className="pt-3">
            <JdVersionHistory jd={jd} />
          </TabsContent>
        </Tabs>
      </CardContent>

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
    </Card>
  );
}

/** Above this, the text is capped and gets a reveal control. */
const COLLAPSE_ABOVE_CHARACTERS = 1_800;

/**
 * The posting itself, verbatim.
 *
 * Code tokens rather than card tokens because this is untrusted text the app
 * stores and replays exactly — the same treatment LaTeX source and compiler
 * logs get, and the visual cue that nothing here has been interpreted.
 *
 * The height cap is not cosmetic. A 20,000-character posting rendered in full
 * makes the page tens of screens tall and buries the version history and every
 * other control below it, so a long one scrolls inside its own box until the
 * user asks for the whole thing. The box is `tabIndex={0}` and labelled,
 * because a scrollable region that cannot be reached or scrolled from the
 * keyboard is a trap.
 */
function JdText({ content }: { content: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const long = content.length > COLLAPSE_ABOVE_CHARACTERS;

  return (
    <div className="space-y-2">
      <pre
        role="region"
        aria-label="Job description text"
        tabIndex={0}
        className={cn(
          "bg-code text-code-foreground border-code-border focus-visible:ring-ring/50 overflow-auto rounded-lg border p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap outline-none focus-visible:ring-3",
          long && !expanded && "max-h-[26rem]",
        )}
      >
        {content}
      </pre>
      {long ? (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? "Collapse"
            : `Show all ${formatNumber(content.length)} characters`}
        </Button>
      ) : null}
    </div>
  );
}
