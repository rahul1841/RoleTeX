"use client";

import * as React from "react";
import { cn } from "cn";
import { isRenderCancelled, type PdfDocument } from "./pdfjs";

/**
 * Cap on the backing-store multiplier.
 *
 * A retina laptop reports 2 and a 4K external can report 3; beyond that the
 * canvas costs more memory than the sharpness is worth. At 300% zoom on a
 * 3-page resume an uncapped DPR of 3 would allocate roughly 200MB of canvas.
 */
const MAX_DEVICE_PIXEL_RATIO = 2;

/**
 * Hard ceiling on one canvas, in device pixels.
 *
 * Safari on iOS silently refuses to allocate a canvas past ~16.7M pixels and
 * renders it blank — no exception, no console warning. Scaling the backing
 * store down instead keeps a very large zoom slightly soft rather than empty.
 */
const MAX_CANVAS_PIXELS = 16_000_000;

export interface PdfPageCanvasProps {
  document: PdfDocument;
  pageNumber: number;
  /** CSS scale. 1 renders the page at its natural size, 72dpi. */
  scale: number;
  className?: string;
}

/**
 * One PDF page painted onto a canvas.
 *
 * The canvas is sized twice, on purpose: `width`/`height` are the device-pixel
 * backing store (scale × devicePixelRatio) and the CSS width/height are the
 * layout size (scale alone). Setting only the former is the classic mistake
 * that renders a page at double size; setting only the latter is what made the
 * vanilla viewer blurry on every retina screen.
 *
 * The previous render is cancelled before a new one starts. pdf.js rejects
 * `RenderTask.promise` with a `RenderingCancelledException` when that happens,
 * which is a normal outcome here — a zoom change or a fresh compile — and is
 * filtered rather than reported.
 */
export function PdfPageCanvas({
  document,
  pageNumber,
  scale,
  className,
}: PdfPageCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [size, setSize] = React.useState<{
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let cancelRender: (() => void) | null = null;

    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;

        const cssViewport = page.getViewport({ scale });
        const dpr = Math.min(
          window.devicePixelRatio || 1,
          MAX_DEVICE_PIXEL_RATIO,
        );
        const budget = Math.sqrt(
          MAX_CANVAS_PIXELS / (cssViewport.width * cssViewport.height),
        );
        const deviceScale = scale * Math.min(dpr, Math.max(1, budget));
        const deviceViewport = page.getViewport({ scale: deviceScale });

        canvas.width = Math.max(1, Math.floor(deviceViewport.width));
        canvas.height = Math.max(1, Math.floor(deviceViewport.height));
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;

        const task = page.render({ canvas, viewport: deviceViewport });
        cancelRender = () => task.cancel();
        await task.promise;
        if (cancelled) return;

        setSize({
          width: Math.floor(cssViewport.width),
          height: Math.floor(cssViewport.height),
        });
        setError(null);
      } catch (thrown) {
        if (cancelled || isRenderCancelled(thrown)) return;
        setError(
          thrown instanceof Error
            ? thrown
            : new Error("This page could not be drawn."),
        );
      }
    })();

    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [document, pageNumber, scale]);

  if (error) {
    return (
      <div
        role="alert"
        className="border-destructive/25 bg-destructive/5 text-destructive flex min-h-40 items-center justify-center rounded-md border px-4 text-center text-sm"
      >
        Page {pageNumber} could not be drawn.
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      // A canvas is an image to assistive tech. The page text is not readable
      // from it, so it is labelled by position and the viewer offers the
      // extracted text elsewhere rather than pretending this is accessible.
      role="img"
      aria-label={`Page ${pageNumber}`}
      className={cn(
        "bg-white",
        // Until the first paint lands the element has no intrinsic size and
        // the scroll container would collapse; a placeholder ratio holds the
        // space so the page does not jump when it appears.
        !size && "aspect-[1/1.414] w-full",
        className,
      )}
    />
  );
}
