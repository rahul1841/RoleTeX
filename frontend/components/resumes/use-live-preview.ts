"use client";

import * as React from "react";
import { previewResume } from "@/lib/api/endpoints/resumes";
import type {
  CompilerReport,
  ResumePreviewRequest,
} from "@/lib/api/types";
import { base64ToBytes } from "@/components/pdf";

/**
 * The editor's continuous PDF preview.
 *
 * `POST /api/resumes/preview` runs Tectonic. That is the most expensive thing
 * this screen can do and the easiest to do badly, so this hook owns all four
 * of the rules rather than leaving them to a component:
 *
 *  1. DEBOUNCE. A compile per keystroke would queue dozens of LaTeX runs for
 *     one sentence. The request is held until the draft has been still for a
 *     moment.
 *  2. CANCEL. Starting a new compile aborts the one in flight, through the
 *     `AbortSignal` the endpoint already accepts. The server may finish it
 *     anyway, but the browser stops waiting and the connection is freed.
 *  3. NEVER GO BACKWARDS. Requests can settle out of order — a two-page resume
 *     takes longer than the one-page version that replaced it. Every response
 *     is checked against a monotonic request id and a late one is dropped, so
 *     the panel can never show an older document than the one already on it.
 *  4. KEEP THE LAST GOOD PAGE. A failed compile does not blank the preview;
 *     it annotates it. Losing the rendered resume because a bullet is
 *     momentarily half-typed is worse than showing something slightly stale.
 *
 * It is deliberately not a TanStack Query `useQuery`. A query keyed on the
 * draft would recompile on remount, on window focus, and on every retry, and
 * would cache a compile per keystroke pause forever.
 */

/** Long enough to finish a thought, short enough to feel live. */
const DEFAULT_DEBOUNCE_MS = 1_100;

export interface PreviewResult {
  pdfBase64: string;
  bytes: Uint8Array;
  filename: string;
  pageCount: number | null;
  latexSource: string;
  compiler: CompilerReport;
}

export interface LivePreviewState {
  /** The most recent successful compile, even while a newer one is running. */
  result: PreviewResult | null;
  /** True while a compile is in flight. */
  isCompiling: boolean;
  /** The failure from the last attempt, cleared by the next success. */
  error: unknown;
  /** True when the draft has changed since `result` was produced. */
  isStale: boolean;
  /** Compile now, skipping the debounce. Used by the Refresh button. */
  refresh: () => void;
}

export interface UseLivePreviewOptions {
  /**
   * What to compile. `null` pauses previewing — pass null while the draft is
   * missing the identity fields the server requires, so a compile that would
   * certainly 422 is never sent.
   */
  request: ResumePreviewRequest | null;
  /** Master switch, for a hidden panel or an unauthenticated screen. */
  enabled?: boolean;
  debounceMs?: number;
}

export function useLivePreview({
  request,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseLivePreviewOptions): LivePreviewState {
  const [result, setResult] = React.useState<PreviewResult | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [isCompiling, setIsCompiling] = React.useState(false);

  // What the request looked like when `result` was produced, so an edit that
  // is typed and then undone does not trigger a pointless recompile.
  const [compiledSignature, setCompiledSignature] = React.useState<
    string | null
  >(null);

  const requestIdRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);

  // The signature currently being compiled. Without it, a compile that outlasts
  // the debounce window — which a Tectonic run routinely does — is started a
  // second time by the effect that is still watching an uncompiled signature,
  // and the first is aborted a moment before it would have landed.
  const inFlightSignatureRef = React.useRef<string | null>(null);

  // A structural identity for the request. The two builders that produce these
  // (`formToDraft`, `formToStyle`) emit their keys in a fixed order, so
  // stringify is a sound equality check and a far cheaper dependency than a
  // deep comparison on every render.
  const signature = React.useMemo(
    () => (request ? JSON.stringify(request) : null),
    [request],
  );

  // The body is passed in rather than read from a ref: the effect and the
  // refresh button both already hold the request that produced the signature
  // they are acting on, and a ref would have to be written during render to
  // stay in step with them.
  const run = React.useCallback(
    async (currentSignature: string, body: ResumePreviewRequest) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const id = requestIdRef.current + 1;
      requestIdRef.current = id;
      inFlightSignatureRef.current = currentSignature;

      setIsCompiling(true);
      try {
        const response = await previewResume(body, controller.signal);
        // A response from a superseded request is discarded, not rendered.
        if (id !== requestIdRef.current) return;
        setResult({
          pdfBase64: response.pdf_base64,
          bytes: base64ToBytes(response.pdf_base64),
          filename: response.filename,
          pageCount: response.page_count ?? null,
          latexSource: response.latex_source,
          compiler: response.compiler,
        });
        setCompiledSignature(currentSignature);
        setError(null);
      } catch (thrown) {
        if (controller.signal.aborted || id !== requestIdRef.current) return;
        setError(thrown);
        // The signature is recorded on failure too: without it the effect would
        // retry the same doomed draft every time the component re-renders.
        setCompiledSignature(currentSignature);
      } finally {
        if (id === requestIdRef.current) {
          inFlightSignatureRef.current = null;
          setIsCompiling(false);
        }
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!enabled || !signature || !request) return;
    if (signature === compiledSignature) return;
    if (signature === inFlightSignatureRef.current) return;

    const timer = window.setTimeout(
      () => void run(signature, request),
      debounceMs,
    );
    return () => window.clearTimeout(timer);
  }, [enabled, signature, request, compiledSignature, debounceMs, run]);

  // Leaving the screen must not leave a Tectonic request hanging on the
  // browser's connection pool.
  React.useEffect(
    () => () => {
      requestIdRef.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  const refresh = React.useCallback(() => {
    if (!signature || !request) return;
    setCompiledSignature(null);
    void run(signature, request);
  }, [run, signature, request]);

  return {
    result,
    isCompiling,
    error,
    isStale: Boolean(signature) && signature !== compiledSignature,
    refresh,
  };
}
