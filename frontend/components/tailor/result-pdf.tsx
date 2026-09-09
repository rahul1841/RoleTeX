"use client";

import * as React from "react";
import { DownloadIcon, FileWarningIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { base64ToBytes, downloadBase64Pdf } from "@/components/pdf/blob-url";
import { PdfViewer } from "@/components/pdf/pdf-viewer";
import type { CompilerReport } from "@/lib/api/types";

/**
 * The compiled PDF, shown beside the change list and never instead of it
 * (rules.md R-14).
 *
 * The viewer itself belongs to components/pdf and is shared with the resume
 * builder; this only owns the tailor-specific chrome: the page-count read-out,
 * the download, and the honest empty state for a run that deliberately skipped
 * compilation.
 */

export interface ResultPdfProps {
  base64: string | null;
  filename: string;
  pageCount: number | null;
  compiler: CompilerReport;
  className?: string;
}

export function ResultPdf({
  base64,
  filename,
  pageCount,
  compiler,
  className,
}: ResultPdfProps) {
  // Decoded once per payload. `PdfViewer` compares `bytes` by identity and
  // pdf.js detaches whatever it is handed, so a new array per render would
  // reopen the document on every keystroke elsewhere on the page.
  const bytes = React.useMemo(
    () => (base64 ? base64ToBytes(base64) : null),
    [base64],
  );

  const pages = pageCount ?? compiler.page_count ?? null;

  return (
    <section
      aria-labelledby="preview-heading"
      className={className}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="preview-heading" className="font-heading text-sm font-medium">
          Compiled PDF
        </h2>
        {pages !== null ? (
          <Badge variant={pages > 1 ? "outline" : "secondary"} className="tabular-nums">
            {pages} {pages === 1 ? "page" : "pages"}
          </Badge>
        ) : null}
      </div>

      <p className="text-muted-foreground mt-1.5 text-xs text-pretty">
        {base64
          ? "Rendered by Tectonic from the server-assembled template. Check it against the changes before you send it anywhere."
          : "No PDF was produced for this run."}
      </p>

      <PdfViewer
        className="mt-3 h-[36rem] max-h-[calc(100svh-13rem)]"
        bytes={bytes}
        label="Tailored resume preview"
        placeholder={
          compiler.attempted ? (
            <p className="text-muted-foreground max-w-xs text-center text-sm text-pretty">
              The server reported a successful compile but returned no PDF
              bytes. The change list beside this is still complete.
            </p>
          ) : (
            <div className="text-muted-foreground flex max-w-xs flex-col items-center gap-2 text-center text-sm text-pretty">
              <FileWarningIcon aria-hidden="true" className="size-5" />
              <p>
                Compilation was skipped by request. Switch{" "}
                <span className="text-foreground font-medium">Compile PDF</span>{" "}
                on and run again to get a document — the changes and the LaTeX
                source are complete either way.
              </p>
            </div>
          )
        }
        actions={
          base64 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadBase64Pdf(base64, filename)}
            >
              <DownloadIcon data-icon="inline-start" />
              Download
            </Button>
          ) : null
        }
      />
    </section>
  );
}
