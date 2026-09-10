/**
 * The single place pdf.js is loaded and configured.
 *
 * Three constraints decide the shape of this module, and each one is a way the
 * library fails to bundle if it is loaded any other way:
 *
 *  1. `pdfjs-dist@5`'s modern `build/pdf.mjs` has no Node built-in imports at
 *     all (verified by grep against the installed file), and its package.json
 *     `browser` field maps `canvas`/`fs`/`http`/`https`/`url` to `false`, so no
 *     bundler alias configuration is needed. Older `.mjs` builds carried
 *     `await import("fs" | "http" | "url")` branches that a browser bundler
 *     tries — and fails — to resolve.
 *  2. The worker is referenced with `new URL(specifier, import.meta.url)`,
 *     which the bundler rewrites into a real emitted asset URL. Under
 *     `output: "export"` that lands in `out/_next/static/` and is served from
 *     the same origin as the app, which keeps pdf.js off its cross-origin
 *     fallback path (it otherwise wraps the worker in a Blob shim). A
 *     hand-written absolute worker path would 404 wherever the app is mounted.
 *  3. `import()` lives inside a function, never at module scope, so nothing
 *     executes during the static prerender. pdf.js touches `document` and
 *     `Worker` as it initializes and would throw if it ran on the server.
 *
 * The module promise is memoized: a viewer, a thumbnail and a download button
 * on the same screen must share one pdf.js instance and one worker.
 */

import type * as PdfjsModule from "pdfjs-dist";

export type Pdfjs = typeof PdfjsModule;
export type PdfDocument = PdfjsModule.PDFDocumentProxy;
export type PdfPage = PdfjsModule.PDFPageProxy;

let modulePromise: Promise<Pdfjs> | null = null;

/**
 * Load pdf.js, configuring the worker exactly once.
 *
 * Safe to call from anywhere in the browser; throws if called during SSR,
 * which is deliberate — it means a component forgot to defer to an effect.
 */
export function loadPdfjs(): Promise<Pdfjs> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("pdf.js can only be loaded in the browser"),
    );
  }

  modulePromise ??= import("pdfjs-dist").then((pdfjs) => {
    // `.min.mjs` rather than `.mjs`: the worker is a ~1MB parse on the
    // critical path of the first preview, and it is never stepped through.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return pdfjs;
  });

  // A failed load must not be cached, or the viewer can never recover from a
  // transient chunk-fetch failure.
  modulePromise.catch(() => {
    modulePromise = null;
  });

  return modulePromise;
}

/**
 * True for the error pdf.js throws when a render is cancelled.
 *
 * `RenderTask.cancel()` rejects the render promise rather than resolving it,
 * so every render call site has to tell "the user typed again" apart from "the
 * PDF is broken". pdf.js exports the exception class, but importing it would
 * pull the whole library into the bundle statically; the `name` check is what
 * pdf.js itself uses internally.
 */
export function isRenderCancelled(error: unknown): boolean {
  return (
    error instanceof Error && error.name === "RenderingCancelledException"
  );
}

/**
 * Hand pdf.js its own copy of the bytes.
 *
 * `getDocument({ data })` *transfers* a TypedArray to the worker thread:
 * afterwards the caller's buffer is detached and reads as empty. The preview
 * loop keeps its decoded bytes around to re-open or download the same PDF, so
 * every document load gets a copy and the caller keeps the original.
 */
export function copyBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}
