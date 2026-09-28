"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  SparklesIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Canvas, ConfirmDialog, CopyButton } from "@/components/common";
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
    <div className={cn("min-w-0 space-y-6", className)}>
      <ButtonLink
        variant="ghost"
        size="sm"
        href="/history"
        className="-ml-2 lg:hidden"
      >
        <ArrowLeftIcon data-icon="inline-start" />
        All runs
      </ButtonLink>

      <header className="bg-card rounded-[1.25rem] ring-1 ring-foreground/10">
        <div className="flex flex-col gap-5 p-6 sm:p-7 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-3">
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs">
              <time dateTime={time.iso} title={time.absolute}>
                {time.relative}
              </time>
              <span aria-hidden="true" className="opacity-40">·</span>
              <span>{formatEngine(run.provider, run.model)}</span>
              {run.repaired ? (
                <Badge
                  variant="outline"
                  className="border-warning-border bg-warning text-warning-foreground font-sans"
                >
                  Repaired
                </Badge>
              ) : null}
            </p>
            <h2 className="font-heading flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xl leading-tight font-semibold tracking-[-0.02em] sm:text-3xl">
              <span className="min-w-0">{run.resume_name || "Untitled resume"}</span>
              <span className="text-muted-foreground font-mono text-sm font-normal tracking-normal">
                v{run.resume_version}
              </span>
            </h2>
            <p className="text-muted-foreground flex items-start gap-2 text-[0.9375rem] text-pretty">
              <ArrowRightIcon aria-hidden="true" className="mt-1 size-4 shrink-0" />
              <span className="min-w-0">
              <span className="sr-only">Tailored against </span>
              {run.jd_id ? (
                <Link
                  href={`/jds?id=${encodeURIComponent(run.jd_id)}`}
                  className="text-foreground underline-offset-3 hover:underline"
                >
                  {run.jd_title?.trim() || "a saved job description"}
                  <ArrowUpRightIcon
                    aria-hidden="true"
                    className="ml-0.5 inline size-3.5 align-[-0.1em]"
                  />
                </Link>
              ) : (
                <span className="text-foreground">
                  a job description pasted into the tailor screen
                </span>
              )}
              </span>
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {run.resume_id ? (
              <ButtonLink
                variant="outline"
                href={`/resumes?id=${encodeURIComponent(run.resume_id)}`}
                className="h-10 rounded-xl px-4"
              >
                <FileTextIcon data-icon="inline-start" />
                Open resume
              </ButtonLink>
            ) : null}
            {run.resume_id ? (
              <ButtonLink
                href={{
                  pathname: "/tailor",
                  query: run.jd_id
                    ? { resume: run.resume_id, jd: run.jd_id }
                    : { resume: run.resume_id },
                }}
                className="h-10 rounded-xl px-4"
              >
                <SparklesIcon data-icon="inline-start" />
                Tailor again
              </ButtonLink>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-10 rounded-xl"
                    aria-label="More actions for this run"
                  >
                    <MoreHorizontalIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    void navigator.clipboard?.writeText(run.id).then(
                      () => toast.success("Run id copied"),
                      () => toast.error("Could not copy the run id"),
                    );
                  }}
                >
                  Copy run id
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmOpen(true)}
                >
                  <TrashIcon data-icon="inline-start" />
                  Delete run
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <dl className="grid grid-cols-2 border-t sm:grid-cols-4">
          <Stat label="Run">
            <time dateTime={time.iso} className="block truncate">
              {time.absolute}
            </time>
          </Stat>
          <Stat label="Output">
            {pages ? (
              <span>{pages}</span>
            ) : (
              <span className="text-muted-foreground">Not compiled</span>
            )}
          </Stat>
          <Stat label="Changes">
            <span className="tabular-nums">
              {changes.length} {changes.length === 1 ? "edit" : "edits"}
            </span>
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

      <Tabs defaultValue="changes" className="gap-5">
        {/* The list is `w-fit`, so on a narrow viewport four labels would push
            the card sideways. Scrolling the strip keeps the page itself from
            gaining a horizontal scrollbar. */}
        <div className="-mx-1 overflow-x-auto px-1 py-1">
          <TabsList className="bg-card h-10 rounded-xl p-1 ring-1 ring-foreground/10 group-data-horizontal/tabs:h-10">
            <TabsTrigger value="changes" className="rounded-lg px-4">
              Changes
              <span className="text-muted-foreground font-mono text-xs tabular-nums">
                {changes.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="diff" className="rounded-lg px-4">
              Diff
            </TabsTrigger>
            <TabsTrigger value="latex" className="rounded-lg px-4">
              LaTeX
            </TabsTrigger>
            <TabsTrigger value="jd" className="rounded-lg px-4">
              Job description
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="changes">
          <Canvas className="p-4 sm:p-7">
            <ChangeList changes={changes} compiled={compiled} />
          </Canvas>
        </TabsContent>

        <TabsContent value="diff">
          <UnifiedDiff diff={run.unified_diff ?? ""} className="bg-card" />
        </TabsContent>

        <TabsContent value="latex">
          {hasLatex ? (
            <CodeBlock
              label="Rendered LaTeX source"
              subject="LaTeX source"
              value={latex}
              meta={`${countLines(latex)} lines · ${formatByteSize(latex)}`}
              maxHeightClassName="max-h-[40rem]"
            />
          ) : (
            <p className="text-muted-foreground border-code-border bg-code rounded-xl border px-3 py-6 text-center text-sm">
              This run stored no LaTeX source, so it cannot be recompiled.
            </p>
          )}
        </TabsContent>

        <TabsContent value="jd" className="space-y-3">
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
    <div className="min-w-0 border-r px-6 py-4 last:border-r-0 sm:px-7 [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r">
      <dt className="text-muted-foreground font-mono text-[0.6875rem] tracking-wide uppercase">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 text-sm">{children}</dd>
    </div>
  );
}
