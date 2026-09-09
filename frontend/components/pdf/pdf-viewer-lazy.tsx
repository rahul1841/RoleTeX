"use client";

import dynamic from "next/dynamic";
import { cn } from "cn";
import { Spinner } from "@/components/common";
import type { PdfViewerProps } from "./pdf-viewer";

/**
 * The viewer, code-split and client-only.
 *
 * `ssr: false` is doing real work under `output: "export"`. `next build`
 * prerenders every route to HTML, and pdf.js reads `document` and constructs a
 * `Worker` as it initializes — running it in that pass throws and fails the
 * build. Deferring to the client is also what keeps ~350KB of PDF machinery
 * out of the entry bundle for the several screens that never open a preview.
 *
 * The import specifier is a literal, as `next/dynamic` requires: a variable or
 * template string leaves the bundler unable to match the chunk.
 */
const LazyPdfViewer = dynamic(
  () => import("./pdf-viewer").then((module) => module.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted/40 text-muted-foreground flex min-h-64 flex-1 items-center justify-center gap-2 rounded-xl border text-sm">
        <Spinner />
        Loading the PDF viewer…
      </div>
    ),
  },
);

/**
 * Drop-in <PdfViewer> that never runs on the server.
 *
 * Every screen in the app should use this rather than importing `pdf-viewer`
 * directly; the direct import is exported only so a future consumer that has
 * already established a client boundary can skip the second wrapper.
 */
export function PdfViewerPanel({ className, ...props }: PdfViewerProps) {
  return <LazyPdfViewer className={cn("min-h-64", className)} {...props} />;
}
