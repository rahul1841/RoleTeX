"use client";

import * as React from "react";
import { copyBytes, loadPdfjs, type PdfDocument } from "./pdfjs";

export interface PdfDocumentState {
  document: PdfDocument | null;
  pageCount: number;
  isLoading: boolean;
  error: Error | null;
}

/**
 * What has been loaded, and which bytes it came from.
 *
 * Carrying the source alongside the result is what lets the hook answer
 * "loading" and "stale" by comparison at render time instead of by an extra
 * `setState` in an effect. It also closes a real bug: without it, the instant
 * `bytes` changes the hook would still be handing out the *previous*
 * `PDFDocumentProxy` — which the cleanup has already destroyed — until the new
 * one resolved, and every page would try to render from a dead document.
 */
interface LoadedState {
  source: Uint8Array | null;
  document: PdfDocument | null;
  pageCount: number;
  error: Error | null;
}

const EMPTY: LoadedState = {
  source: null,
  document: null,
  pageCount: 0,
  error: null,
};

/**
 * Open a PDF held in memory and keep exactly one live `PDFDocumentProxy`.
 *
 * `bytes` is compared by identity, so the caller must memoize it — one
 * `Uint8Array` per compiled PDF. That is the right granularity anyway: the
 * preview loop produces a new payload per compile and each one is a new
 * document.
 *
 * Three things this has to get right, all of which are easy to get wrong:
 *
 *  - A document that is replaced mid-load must be torn down. `destroy()` on
 *    the loading task aborts the parse and drops the worker's job; left alone,
 *    a fast typist stacks up parses of PDFs nobody will ever see.
 *  - A load that resolves after the effect was cleaned up must destroy its
 *    result rather than store it, or the proxy (and its worker-side document)
 *    leaks with no reference left to close it.
 *  - `getDocument({ data })` transfers the array to the worker and detaches
 *    the caller's copy, so it is handed a clone — see `copyBytes`.
 */
export function usePdfDocument(bytes: Uint8Array | null): PdfDocumentState {
  const [loaded, setLoaded] = React.useState<LoadedState>(EMPTY);

  React.useEffect(() => {
    if (!bytes) return;

    let cancelled = false;
    let document: PdfDocument | null = null;
    let destroyTask: (() => void) | null = null;

    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (cancelled) return;

        const task = pdfjs.getDocument({
          data: copyBytes(bytes),
          // ERRORS only. pdf.js is chatty at its default level, and a preview
          // loop that recompiles every few seconds turns "Warning: TT: ..."
          // font notes into a console nobody reads. Real failures still throw.
          verbosity: 0,
          // No cMapUrl / standardFontDataUrl is configured: every PDF this app
          // opens comes from its own Tectonic compile, which embeds the fonts
          // it uses and needs neither table. An imported PDF is only ever sent
          // to the server, never rendered here.
        });
        destroyTask = () => void task.destroy();

        const opened = await task.promise;
        if (cancelled) {
          void opened.destroy();
          return;
        }
        document = opened;
        setLoaded({
          source: bytes,
          document: opened,
          pageCount: opened.numPages,
          error: null,
        });
      } catch (thrown) {
        if (cancelled) return;
        setLoaded({
          source: bytes,
          document: null,
          pageCount: 0,
          error:
            thrown instanceof Error
              ? thrown
              : new Error("The PDF could not be opened."),
        });
      }
    })();

    return () => {
      cancelled = true;
      if (document) void document.destroy();
      else destroyTask?.();
    };
  }, [bytes]);

  const current = loaded.source === bytes;

  return {
    document: current ? loaded.document : null,
    pageCount: current ? loaded.pageCount : 0,
    error: current ? loaded.error : null,
    isLoading: Boolean(bytes) && !current,
  };
}

interface PageSizeState {
  source: PdfDocument | null;
  page: number;
  width: number;
  height: number;
}

/**
 * The unscaled size of one page, used to compute a fit-to-width scale.
 *
 * Read from page 1 rather than assumed to be A4: the style controls allow a
 * different margin, and a resume imported from an American PDF is US Letter.
 */
export function usePdfPageSize(
  document: PdfDocument | null,
  pageNumber = 1,
): { width: number; height: number } | null {
  const [size, setSize] = React.useState<PageSizeState | null>(null);

  React.useEffect(() => {
    if (!document) return;
    let cancelled = false;
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1 });
        setSize({
          source: document,
          page: pageNumber,
          width: viewport.width,
          height: viewport.height,
        });
      })
      .catch(() => {
        // A page that cannot be measured falls back to the caller's default
        // scale; there is nothing useful to report here.
      });
    return () => {
      cancelled = true;
    };
  }, [document, pageNumber]);

  if (!document || size?.source !== document || size.page !== pageNumber) {
    return null;
  }
  return { width: size.width, height: size.height };
}
