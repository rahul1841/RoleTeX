"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyPlusIcon,
  DownloadIcon,
  PencilIcon,
  RotateCcwIcon,
  SaveIcon,
  WrenchIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadBase64Pdf } from "@/components/pdf/blob-url";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSaveTailoredResume } from "@/hooks/use-resumes";
import type { TailorProposal, TailorResponse } from "@/lib/api/types";
import { ChangeList } from "./change-list";
import { CodeBlock } from "./code-block";
import { ResultPdf } from "./result-pdf";
import { RunWarnings } from "./run-warnings";
import { UnifiedDiff } from "./unified-diff";
import { Canvas, ConfirmDialog, PageHero, Spinner } from "@/components/common";

/**
 * The result of a run — the heart of the screen.
 *
 * rules.md R-14: "The API always returns the change list + unified diff
 * alongside the PDF; the UI must keep showing changes with the preview. Never
 * silently auto-apply." So the change list is never behind a tab; the tabs only
 * switch how the output is shown (PDF, diff, LaTeX).
 */
export interface ResultReviewProps {
  result: TailorResponse;
  /** The resume the run tailored; saving targets it. */
  resumeId: string | null;
  resume: string;
  jd: string;
  onEditInputs: () => void;
  onRunAgain: () => void;
}

export function ResultReview({
  result,
  resumeId,
  resume,
  jd,
  onEditInputs,
  onRunAgain,
}: ResultReviewProps) {
  const compiled = Boolean(result.pdf_base64);
  const warnings = result.warnings ?? [];
  // `changes` is a required field on TailorResponse, so this is the response's
  // own array — one stable identity per run, which <ChangeList> relies on to
  // know when to reset its per-change "reviewed" marks.
  const changes = result.changes;
  const pages = result.page_count ?? result.compiler.page_count ?? null;

  const status = [
    compiled
      ? `Compiled${pages !== null ? ` · ${pages} ${pages === 1 ? "page" : "pages"}` : ""}`
      : "No PDF compiled",
    result.run_id ? "saved to History" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-label="Tailoring result" className="space-y-8">
      <PageHero
        eyebrow={status}
        eyebrowTone={compiled ? "success" : "default"}
        eyebrowIcon={
          compiled ? <CheckIcon aria-hidden="true" className="size-3" strokeWidth={3} /> : undefined
        }
        title={
          changes.length === 0
            ? "No changes proposed"
            : `${changes.length} ${changes.length === 1 ? "change" : "changes"} to review`
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
            <span>{resume}</span>
            <span aria-hidden="true" className="opacity-50">→</span>
            <span className="sr-only">tailored to</span>
            <span>{jd}</span>
            <span aria-hidden="true" className="opacity-50">·</span>
            <span className="font-mono text-[0.8125rem]">
              {result.provider}
              {result.model ? ` · ${result.model}` : ""}
            </span>
            {result.repaired ? (
              <Badge variant="outline">
                <WrenchIcon aria-hidden="true" data-icon="inline-start" />
                Repaired once
              </Badge>
            ) : null}
            {result.run_id ? (
              <Link
                href={{ pathname: "/history", query: { run: result.run_id } }}
                className="text-primary text-sm underline-offset-4 hover:underline"
              >
                Open in History
              </Link>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button type="button" variant="outline" className="h-10 rounded-xl px-4" onClick={onEditInputs}>
              <PencilIcon data-icon="inline-start" />
              Edit inputs
            </Button>
            <Button type="button" variant="outline" className="h-10 rounded-xl px-4" onClick={onRunAgain}>
              <RotateCcwIcon data-icon="inline-start" />
              Run again
            </Button>
            {resumeId && changes.length > 0 ? (
              <SaveTailoredMenu
                resumeId={resumeId}
                resumeName={resume}
                proposal={result.proposal}
              />
            ) : null}
            {result.pdf_base64 ? (
              <Button
                type="button"
                className="h-10 rounded-xl px-4"
                onClick={() => downloadBase64Pdf(result.pdf_base64 as string, result.filename)}
              >
                <DownloadIcon data-icon="inline-start" />
                Download PDF
              </Button>
            ) : null}
          </>
        }
      />

      <RunWarnings warnings={warnings} />

      <Canvas className="p-4 sm:p-8 xl:px-12 xl:py-10">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,34rem)] xl:gap-12">
          <ChangeList changes={changes} compiled={compiled} className="min-w-0" />

          <Tabs defaultValue="pdf" className="min-w-0 gap-3 xl:sticky xl:top-24 xl:self-start">
            <TabsList className="bg-card ring-1 ring-foreground/10">
              <TabsTrigger value="pdf" className="px-3">PDF</TabsTrigger>
              <TabsTrigger value="diff" className="px-3" disabled={!result.unified_diff.trim()}>
                Unified diff
              </TabsTrigger>
              <TabsTrigger value="latex" className="px-3">LaTeX</TabsTrigger>
            </TabsList>
            <TabsContent value="pdf">
              <ResultPdf
                showHeader={false}
                viewerClassName="h-[44rem] max-h-[calc(100svh-10rem)] bg-card"
                base64={result.pdf_base64 ?? null}
                filename={result.filename}
                pageCount={pages}
                compiler={result.compiler}
              />
            </TabsContent>
            <TabsContent value="diff">
              <UnifiedDiff diff={result.unified_diff} className="bg-card" />
            </TabsContent>
            <TabsContent value="latex">
              <CodeBlock
                label="LaTeX source"
                subject="LaTeX source"
                value={result.latex_source}
                maxHeightClassName="max-h-[40rem]"
                className="bg-card"
              />
            </TabsContent>
          </Tabs>
        </div>
      </Canvas>
    </section>
  );
}

/**
 * Keep the tailored content: as a new resume beside the original, or over the
 * original. Nothing is saved until one of these is chosen.
 */
function SaveTailoredMenu({
  resumeId,
  resumeName,
  proposal,
}: {
  resumeId: string;
  resumeName: string;
  proposal: TailorProposal;
}) {
  const router = useRouter();
  const save = useSaveTailoredResume(resumeId);
  const [confirmingOverwrite, setConfirmingOverwrite] = React.useState(false);

  function reportFailure(thrown: unknown) {
    toast.error("Could not save the resume", {
      description: thrown instanceof Error ? thrown.message : "Please try again.",
    });
  }

  async function saveAsNew() {
    try {
      const response = await save.mutateAsync({ mode: "new", proposal });
      toast.success("Saved as a new resume", {
        description: response.resume.name,
        action: {
          label: "Open",
          onClick: () =>
            router.push(`/resumes?id=${encodeURIComponent(response.resume.id)}`),
        },
      });
    } catch (thrown) {
      reportFailure(thrown);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-xl px-4"
              disabled={save.isPending}
            >
              {save.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SaveIcon data-icon="inline-start" />
              )}
              Save resume
              <ChevronDownIcon data-icon="inline-end" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void saveAsNew()}>
            <CopyPlusIcon data-icon="inline-start" />
            Save as new resume
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setConfirmingOverwrite(true)}>
            <SaveIcon data-icon="inline-start" />
            Update “{resumeName}”
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmingOverwrite}
        onOpenChange={setConfirmingOverwrite}
        title={`Replace “${resumeName}” with the tailored version?`}
        description="Its current content is overwritten. Runs in History keep their own copy and are not affected."
        confirmLabel="Replace"
        pending={save.isPending}
        onConfirm={async () => {
          try {
            await save.mutateAsync({ mode: "overwrite", proposal });
            toast.success(`“${resumeName}” updated`);
          } catch (thrown) {
            // <ConfirmDialog> stays open on rejection; the toast says why.
            reportFailure(thrown);
            throw thrown;
          }
        }}
      />
    </>
  );
}
