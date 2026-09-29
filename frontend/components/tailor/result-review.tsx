"use client";

import Link from "next/link";
import {
  CheckIcon,
  DownloadIcon,
  PencilIcon,
  RotateCcwIcon,
  WrenchIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { downloadBase64Pdf } from "@/components/pdf/blob-url";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TailorResponse } from "@/lib/api/types";
import { ChangeList } from "./change-list";
import { CodeBlock } from "./code-block";
import { ResultPdf } from "./result-pdf";
import { RunWarnings } from "./run-warnings";
import { UnifiedDiff } from "./unified-diff";
import { Canvas, PageHero } from "@/components/common";

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
  resume: string;
  jd: string;
  onEditInputs: () => void;
  onRunAgain: () => void;
}

export function ResultReview({
  result,
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
