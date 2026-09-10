"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { ArrowLeftIcon, ArrowUpRightIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog, CopyButton } from "@/components/common";
// The change list, the diff renderer and the code block are the tailor
// screen's, imported rather than reimplemented: a stored run and a fresh one
// are the same artifacts, and two implementations of the diff tokens would
// drift apart the first time either screen was touched.
import { ChangeList, CodeBlock, RunWarnings, UnifiedDiff } from "@/components/tailor";
import { useDeleteRun } from "@/hooks/use-runs";
import type { RunDetail as RunDetailModel } from "@/lib/api/types";
import { JdExcerpt } from "./jd-excerpt";
import { RecompilePanel } from "./recompile-panel";
import {
  countLines,
  formatByteSize,
  formatEngine,
  formatPageCount,
  formatRunTimestamp,
} from "./format";

export interface RunDetailProps {
  run: RunDetailModel;
  /** Called after a successful delete so the page can clear `?run=`. */
  onDeleted: () => void;
  className?: string;
}

/**
 * Everything one tailoring run recorded.
 *
 * The order is the order a reviewer needs it in: what was tailored and against
 * what, then the facts about the run, then the button that turns it back into
 * a PDF, then the evidence — changes, diff, LaTeX, and the job description the
 * model actually saw.
 *
 * The evidence sits behind tabs rather than stacked because the LaTeX source
 * alone is several hundred lines; stacking would bury the change list, which
 * is the part that matters (rules.md R-14).
 */
export function RunDetail({ run, onDeleted, className }: RunDetailProps) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const deleteRun = useDeleteRun();

  const time = formatRunTimestamp(run.created_at);
  const changes = run.changes ?? [];
  const warnings = run.warnings ?? [];
  const latex = run.latex_source ?? "";
  const hasLatex = latex.trim().length > 0;
  const pages = formatPageCount(run.page_count);
  const compiled = pages !== null;

  async function handleDelete() {
    try {
      await deleteRun.mutateAsync(run.id);
      toast.success("Run deleted");
      onDeleted();
    } catch (error) {
      // <ConfirmDialog> stays open and says nothing when onConfirm rejects, so
      // reporting the failure here is the caller's contractual job.
      toast.error("Could not delete this run", {
        description:
          error instanceof Error
            ? error.message
            : "Please try again in a moment.",
      });
      throw error;
    }
  }

  return (
    <div className={cn("min-w-0 space-y-5", className)}>
      <ButtonLink
        variant="ghost"
        size="sm"
        href="/history"
        className="-ml-2 lg:hidden"
      >
        <ArrowLeftIcon data-icon="inline-start" />
        All runs
      </ButtonLink>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 space-y-1">
            <h2 className="font-heading truncate text-lg font-semibold tracking-tight">
              {run.resume_name || "Untitled resume"}
              <span className="text-muted-foreground ml-2 font-mono text-sm font-normal">
                v{run.resume_version}
              </span>
            </h2>
            <p className="text-muted-foreground text-sm text-pretty">
              Tailored against{" "}
              {run.jd_id ? (
                <Link
                  href={`/jds?id=${encodeURIComponent(run.jd_id)}`}
                  className="text-foreground underline underline-offset-3"
                >
                  {run.jd_title?.trim() || "a saved job description"}
                  <ArrowUpRightIcon
                    aria-hidden="true"
                    className="ml-0.5 inline size-3 align-[-0.1em]"
                  />
                </Link>
              ) : (
                <span className="text-foreground">
                  a job description pasted into the tailor screen
                </span>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {run.resume_id ? (
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link href={`/resumes?id=${encodeURIComponent(run.resume_id)}`} />
                }
              >
                Open resume
              </Button>
            ) : null}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmOpen(true)}
            >
              <TrashIcon data-icon="inline-start" />
              Delete
            </Button>
          </div>
        </div>

        <dl className="border-border/80 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-dashed px-4 py-3 sm:grid-cols-4">
          <Stat label="Run">
            <time dateTime={time.iso} className="block truncate">
              {time.absolute}
            </time>
            <span className="text-muted-foreground text-xs">{time.relative}</span>
          </Stat>
          <Stat label="Engine">
            <span className="block truncate font-mono text-xs">
              {formatEngine(run.provider, run.model)}
            </span>
            {run.repaired ? (
              <Badge
                variant="outline"
                className="border-warning-border bg-warning text-warning-foreground mt-1"
              >
                Repaired
              </Badge>
            ) : null}
          </Stat>
          <Stat label="Output">
            {pages ? (
              <span>{pages}</span>
            ) : (
              <span className="text-muted-foreground">Not compiled</span>
            )}
          </Stat>
          <Stat label="Run id">
            <span className="flex items-center gap-1">
              <code className="truncate font-mono text-xs">{run.id}</code>
              <CopyButton
                value={run.id}
                subject="Run id"
                size="icon-xs"
                variant="ghost"
                className="-my-1 shrink-0"
              />
            </span>
          </Stat>
        </dl>
      </header>

      <RunWarnings warnings={warnings} />

      <RecompilePanel runId={run.id} hasLatex={hasLatex} />

      <Tabs defaultValue="changes">
        {/* The list is `w-fit`, so on a narrow viewport four labels would push
            the card sideways. Scrolling the strip keeps the page itself from
            gaining a horizontal scrollbar. */}
        <div className="-mx-1 overflow-x-auto px-1 py-1">
          <TabsList>
            <TabsTrigger value="changes" className="px-3">
              Changes
              <span className="text-muted-foreground font-mono text-xs tabular-nums">
                {changes.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="diff" className="px-3">
              Diff
            </TabsTrigger>
            <TabsTrigger value="latex" className="px-3">
              LaTeX
            </TabsTrigger>
            <TabsTrigger value="jd" className="px-3">
              Job description
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="changes" className="pt-4">
          <ChangeList changes={changes} compiled={compiled} />
        </TabsContent>

        <TabsContent value="diff" className="pt-4">
          <UnifiedDiff diff={run.unified_diff ?? ""} />
        </TabsContent>

        <TabsContent value="latex" className="pt-4">
          {hasLatex ? (
            <CodeBlock
              label="Rendered LaTeX source"
              subject="LaTeX source"
              value={latex}
              meta={`${countLines(latex)} lines · ${formatByteSize(latex)}`}
              maxHeightClassName="max-h-[34rem]"
            />
          ) : (
            <p className="text-muted-foreground border-code-border bg-code rounded-xl border px-3 py-6 text-center text-sm">
              This run stored no LaTeX source, so it cannot be recompiled.
            </p>
          )}
        </TabsContent>

        <TabsContent value="jd" className="space-y-3 pt-4">
          <JdExcerpt
            text={run.jd_excerpt || "(no job description text was stored)"}
            title={run.jd_title}
          />
          <p className="text-muted-foreground text-xs text-pretty">
            Runs store a truncated copy of the job description so history stays
            readable after the original is edited or deleted.
            {run.jd_id ? (
              <>
                {" "}
                <Link
                  href={`/jds?id=${encodeURIComponent(run.jd_id)}`}
                  className="text-foreground underline underline-offset-3"
                >
                  Open the saved job description
                </Link>{" "}
                for the full text.
              </>
            ) : null}
          </p>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this run?"
        description="Its change list, diff and LaTeX source are removed permanently. The resume and job description it used are not affected."
        confirmLabel="Delete run"
        pending={deleteRun.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm">{children}</dd>
    </div>
  );
}
