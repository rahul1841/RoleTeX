"use client";

import * as React from "react";
import { cn } from "cn";
import {
  DownloadIcon,
  FileCode2Icon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CopyButton, ErrorState, Spinner } from "@/components/common";
import { PdfViewerPanel, downloadBase64Pdf } from "@/components/pdf";
import { resumeErrorGuidance } from "./errors";
import type { LivePreviewState } from "./use-live-preview";

/**
 * The compiled resume, beside the thing that produced it.
 *
 * Three things share this panel, in descending priority: the PDF itself, the
 * compiler's own report (warnings and, on failure, the log), and the LaTeX the
 * server rendered. The last two are collapsed by default — they are what you
 * open when something looks wrong, not what you read while writing.
 */

function CompilerLog({ log }: { log: string }) {
  return (
    <div className="border-code-border bg-code overflow-hidden rounded-lg border">
      <div className="border-code-border flex items-center justify-between gap-2 border-b px-2 py-1">
        <span className="text-muted-foreground text-xs font-medium">
          Compiler log
        </span>
        <CopyButton value={log} subject="Compiler log" variant="ghost" />
      </div>
      <pre className="text-code-foreground max-h-56 overflow-auto p-2 text-[0.7rem] leading-relaxed whitespace-pre-wrap">
        {log}
      </pre>
    </div>
  );
}

export interface PreviewPanelProps {
  preview: LivePreviewState;
  /** Base name for the downloaded file; sanitized before use. */
  downloadName: string;
  /** Shown when nothing has been compiled yet. */
  placeholder?: React.ReactNode;
  className?: string;
}

export function PreviewPanel({
  preview,
  downloadName,
  placeholder,
  className,
}: PreviewPanelProps) {
  const [showSource, setShowSource] = React.useState(false);
  const { result, isCompiling, error, isStale, refresh } = preview;

  const guidance = resumeErrorGuidance(error);
  const compilerLog = result?.compiler?.log ?? null;
  const compilerWarnings = result?.compiler?.warnings ?? [];
  const pages = result?.pageCount ?? null;

  function handleDownload() {
    if (!result) return;
    try {
      downloadBase64Pdf(result.pdfBase64, downloadName || result.filename);
    } catch {
      toast.error("Could not save the PDF", {
        description: "Your browser blocked the download.",
      });
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <PdfViewerPanel
        bytes={result?.bytes ?? null}
        label="Compiled resume preview"
        busy={isCompiling}
        busyLabel={result ? "Recompiling…" : "Compiling…"}
        className="min-h-0 flex-1"
        placeholder={
          placeholder ?? (
            <p className="text-muted-foreground max-w-xs text-center text-sm text-pretty">
              Add your name and email, and the compiled PDF appears here.
            </p>
          )
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={refresh}
              disabled={isCompiling}
              aria-label="Compile again"
              title="Compile again"
            >
              {isCompiling ? <Spinner /> : <RefreshCwIcon />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowSource((open) => !open)}
              disabled={!result}
              aria-pressed={showSource}
              aria-label="Show the LaTeX source"
              title="LaTeX source"
            >
              <FileCode2Icon />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!result}
            >
              <DownloadIcon data-icon="inline-start" />
              PDF
            </Button>
          </>
        }
      />

      {/* Status line: page count, staleness, and the compiler's own notes. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {pages !== null ? (
          <span
            className={cn(
              "tabular-nums",
              pages > 1
                ? "text-warning-foreground font-medium"
                : "text-muted-foreground",
            )}
          >
            {pages} page{pages === 1 ? "" : "s"}
            {pages > 1 ? " — most screens expect one" : ""}
          </span>
        ) : null}
        {isStale && !isCompiling && result ? (
          <span className="text-muted-foreground">
            Showing the last compile; newer edits are not in it yet.
          </span>
        ) : null}
      </div>

      {compilerWarnings.length > 0 ? (
        <div className="border-warning-border bg-warning text-warning-foreground flex gap-2 rounded-lg border p-2 text-xs">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <ul className="space-y-0.5">
            {compilerWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className="space-y-2">
          <ErrorState
            error={error}
            title={guidance?.title}
            onRetry={refresh}
            retryLabel="Compile again"
          />
          {guidance?.hint ? (
            <p className="text-muted-foreground text-xs text-pretty">
              {guidance.hint}
            </p>
          ) : null}
          {compilerLog ? <CompilerLog log={compilerLog} /> : null}
        </div>
      ) : null}

      {showSource && result ? (
        <div className="border-code-border bg-code overflow-hidden rounded-lg border">
          <div className="border-code-border flex items-center justify-between gap-2 border-b px-2 py-1">
            <span className="text-muted-foreground text-xs font-medium">
              LaTeX the server rendered
            </span>
            <CopyButton
              value={result.latexSource}
              subject="LaTeX source"
              variant="ghost"
            />
          </div>
          <pre className="text-code-foreground max-h-72 overflow-auto p-2 text-[0.7rem] leading-relaxed">
            {result.latexSource}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
