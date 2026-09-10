"use client";

import * as React from "react";
import { CheckCircle2Icon, DownloadIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorState, Spinner } from "@/components/common";
import { RunWarnings } from "@/components/tailor";
// components/pdf owns every base64 -> Blob -> object-URL path in the app, and
// tracks the URLs it mints so they are revoked rather than pinned for the life
// of the tab. `PdfViewerPanel` is the ssr:false wrapper — the direct viewer
// cannot be imported here, because `next build` prerenders this route and
// pdf.js touches `document` and `Worker` as it initializes.
import {
  base64ToBytes,
  downloadBase64Pdf,
  PdfViewerPanel,
} from "@/components/pdf";
import { isApiError } from "@/lib/api/errors";
import { useCompileRun } from "@/hooks/use-runs";
import { formatPageCount } from "./format";

export interface RecompilePanelProps {
  runId: string;
  /** False when the run stored no LaTeX; the button explains itself instead. */
  hasLatex: boolean;
}

/**
 * Re-render a stored run to a fresh PDF.
 *
 * The thing this panel has to communicate is a COST difference: tailoring
 * again would spend provider tokens, and this does not. It reuses the LaTeX
 * the server already assembled and only runs Tectonic, so the copy says so
 * plainly rather than leaving the user to guess whether the button is
 * expensive. Tectonic still takes real time, which is why the endpoint uses
 * the long timeout and the pending state says a minute is normal instead of
 * looking hung.
 *
 * The failure modes are not collapsed into one message, because they need
 * different things from the user:
 *
 *   run_has_no_latex     nothing to compile; tailor the resume again
 *   latex_compile_failed the stored source is bad; retrying cannot help
 *   compiler_not_found   this deployment has no Tectonic at all
 *   compile_timeout      transient; retrying is reasonable
 *
 * The decoded bytes are memoized on the response object: <PdfViewer> compares
 * `bytes` by identity and pdf.js detaches whatever it is handed, so a fresh
 * array per render would reopen the document on every unrelated re-render.
 */
export function RecompilePanel({ runId, hasLatex }: RecompilePanelProps) {
  const compile = useCompileRun();
  const result = compile.data ?? null;

  const bytes = React.useMemo(
    () => (result ? base64ToBytes(result.pdf_base64) : null),
    [result],
  );

  function handleCompile() {
    compile.mutate(runId, {
      onSuccess: (response) => {
        toast.success("Recompiled", {
          description:
            formatPageCount(response.page_count) ??
            "The PDF is ready to download.",
        });
      },
    });
  }

  function handleDownload() {
    if (!result) return;
    try {
      downloadBase64Pdf(result.pdf_base64, result.filename);
    } catch {
      toast.error("Could not save the PDF", {
        description:
          "The compiled file could not be read. Recompile and try again.",
      });
    }
  }

  const headingId = `recompile-${runId}`;

  return (
    <section aria-labelledby={headingId} className="bg-card rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h3 id={headingId} className="font-heading text-sm font-medium">
            Recompile to a fresh PDF
          </h3>
          <p className="text-muted-foreground max-w-prose text-sm text-pretty">
            {hasLatex ? (
              <>
                Renders the LaTeX this run already saved.{" "}
                <strong className="text-foreground font-medium">
                  No AI call and no tokens
                </strong>{" "}
                — only the LaTeX compiler runs, which can take up to a minute.
              </>
            ) : (
              <>
                This run stored no LaTeX source, so there is nothing to render.
                Tailor the resume again to produce a new PDF.
              </>
            )}
          </p>
        </div>

        <Button
          type="button"
          variant={result ? "outline" : "default"}
          onClick={handleCompile}
          disabled={!hasLatex || compile.isPending}
        >
          {compile.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          {compile.isPending
            ? "Compiling…"
            : result
              ? "Recompile again"
              : "Recompile PDF"}
        </Button>
      </div>

      {/* One live region for every outcome, so a screen reader is told the
          result once rather than having three regions compete. It stays in the
          DOM even while empty: a live region that is `display:none` until it
          has content is outside the accessibility tree, and its first update
          is then announced by nobody. */}
      <div aria-live="polite">
        {compile.isPending ? (
          <p className="text-muted-foreground mt-3 text-sm">
            Running Tectonic. Leave this page open — the request has a three
            minute budget.
          </p>
        ) : null}

        {result ? (
          <div className="border-diff-added-border bg-diff-added mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5">
            <CheckCircle2Icon
              aria-hidden="true"
              className="text-diff-added-foreground size-4 shrink-0"
            />
            <span className="text-diff-added-foreground text-sm font-medium">
              PDF ready
              {formatPageCount(result.page_count)
                ? ` — ${formatPageCount(result.page_count)}`
                : ""}
            </span>
            <Button
              type="button"
              size="sm"
              onClick={handleDownload}
              className="ml-auto"
            >
              <DownloadIcon data-icon="inline-start" />
              Download PDF
            </Button>
          </div>
        ) : null}

        {compile.isError ? (
          <CompileError
            error={compile.error}
            onRetry={() => compile.mutate(runId)}
          />
        ) : null}
      </div>

      {result ? (
        <>
          <RunWarnings
            className="mt-3"
            warnings={result.compiler.warnings ?? []}
          />
          {/* Loaded only once a run has actually been recompiled, so the ~350KB
              of pdf.js never reaches anyone who is only reading a diff. */}
          <PdfViewerPanel
            className="mt-3 h-[30rem] max-h-[calc(100svh-16rem)]"
            bytes={bytes}
            label="Recompiled resume preview"
          />
        </>
      ) : null}
    </section>
  );
}

function CompileError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const code = isApiError(error) ? error.code : null;

  // Retrying a deterministic failure only wastes the user's time: the same
  // stored LaTeX fails the same way, and a missing compiler stays missing.
  // Only the transient failures keep a retry button.
  const retryable =
    code !== "run_has_no_latex" &&
    code !== "latex_compile_failed" &&
    code !== "compiler_not_found" &&
    code !== "compiler_start_failed";

  let title = "The PDF could not be compiled";
  let action: React.ReactNode = null;

  if (code === "run_has_no_latex") {
    title = "This run has no stored LaTeX";
    action = (
      <ButtonLink variant="outline" size="sm" href="/">
        Tailor again
      </ButtonLink>
    );
  } else if (code === "latex_compile_failed") {
    title = "The stored LaTeX did not compile";
    action = (
      <ButtonLink variant="outline" size="sm" href="/">
        Tailor again
      </ButtonLink>
    );
  } else if (code === "compiler_not_found" || code === "compiler_start_failed") {
    title = "This server has no LaTeX compiler";
    action = (
      <ButtonLink variant="outline" size="sm" href="/settings">
        Check server status
      </ButtonLink>
    );
  } else if (code === "compile_timeout") {
    title = "Compiling took too long";
  }

  return (
    <ErrorState
      className="mt-3"
      error={error}
      title={title}
      onRetry={retryable ? onRetry : undefined}
      retryLabel="Compile again"
      action={action}
    />
  );
}
