"use client";

import * as React from "react";
import { cn } from "cn";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  StretchHorizontalIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState, Spinner } from "@/components/common";
import { PdfPageCanvas } from "./pdf-page";
import { usePdfDocument, usePdfPageSize } from "./use-pdf-document";

/**
 * Discrete zoom stops rather than a continuous slider.
 *
 * Every stop is a re-render of every visible page at a new backing-store size,
 * so a continuous control would queue dozens of full-page rasterizations for
 * one drag. These are also the stops people actually mean: half, three
 * quarters, actual size, and up.
 */
const ZOOM_STOPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5, 3] as const;
const MIN_ZOOM = ZOOM_STOPS[0];
const MAX_ZOOM = ZOOM_STOPS[ZOOM_STOPS.length - 1];

/** Horizontal breathing room around a page inside the scroll area, in px. */
const PAGE_GUTTER = 32;

function nextZoomStop(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_STOPS.find((stop) => stop > current + 0.001) ?? MAX_ZOOM;
  }
  return (
    [...ZOOM_STOPS].reverse().find((stop) => stop < current - 0.001) ?? MIN_ZOOM
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface PdfViewerProps {
  /**
   * The PDF, already decoded. Compared by identity — memoize it, one array per
   * compiled document (see `usePreviewBytes` in components/resumes).
   */
  bytes: Uint8Array | null;
  /** Describes the document for assistive tech: "Resume preview", say. */
  label: string;
  /** Rendered at the right end of the toolbar — a download button, usually. */
  actions?: React.ReactNode;
  /** Shown when `bytes` is null. */
  placeholder?: React.ReactNode;
  /** A dimmed overlay and a spinner over the last good render. */
  busy?: boolean;
  busyLabel?: string;
  className?: string;
}

/**
 * A scrolling, zoomable PDF viewer.
 *
 * Deliberately not the pdf.js `web/` viewer: that ships its own toolbar, its
 * own CSS and its own localization, none of which would match this app, and it
 * expects to own a whole page. This renders pages to canvases and keeps the
 * chrome native.
 *
 * Zoom defaults to fit-width because the common case is a preview panel beside
 * an editor, where the useful question is "does it still fit on one page",
 * not "how big is it in points".
 */
export function PdfViewer({
  bytes,
  label,
  actions,
  placeholder,
  busy = false,
  busyLabel = "Compiling…",
  className,
}: PdfViewerProps) {
  const { document: pdf, pageCount, isLoading, error } = usePdfDocument(bytes);
  const baseSize = usePdfPageSize(pdf);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const pageRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  const [fitWidth, setFitWidth] = React.useState(true);
  const [manualZoom, setManualZoom] = React.useState(1);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [currentPage, setCurrentPage] = React.useState(1);
  // Mirrors `currentPage` for the zoom effect below, which must not re-run
  // every time the reader scrolls past a page boundary. Written only from the
  // observer callback — never during render.
  const currentPageRef = React.useRef(1);

  // Track the available width so fit-to-width survives the editor pane being
  // resized, the sidebar collapsing, and the window changing.
  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setContainerWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const fitScale = React.useMemo(() => {
    if (!baseSize || containerWidth <= 0) return 1;
    const usable = Math.max(120, containerWidth - PAGE_GUTTER * 2);
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, usable / baseSize.width));
  }, [baseSize, containerWidth]);

  const scale = fitWidth ? fitScale : manualZoom;

  const scrollToPage = React.useCallback(
    (page: number, behavior: ScrollBehavior = "smooth") => {
      const root = scrollRef.current;
      const target = pageRefs.current[page - 1];
      if (!root || !target) return;
      const top =
        target.getBoundingClientRect().top -
        root.getBoundingClientRect().top +
        root.scrollTop -
        PAGE_GUTTER / 2;
      root.scrollTo({
        top: Math.max(0, top),
        behavior: prefersReducedMotion() ? "auto" : behavior,
      });
    },
    [],
  );

  // Which page is the reader looking at? Whichever is most visible inside the
  // scroll area — not "the first one intersecting", which flips to the next
  // page the instant a single line of it appears.
  React.useEffect(() => {
    const root = scrollRef.current;
    if (!root || pageCount === 0) return;

    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number(
            (entry.target as HTMLElement).dataset.pageNumber ?? "0",
          );
          if (page > 0) ratios.set(page, entry.intersectionRatio);
        }
        let best = 1;
        let bestRatio = -1;
        for (const [page, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = page;
          }
        }
        currentPageRef.current = best;
        setCurrentPage(best);
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );

    for (const element of pageRefs.current) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [pageCount]);

  // Zooming changes every page's height, which would otherwise leave the
  // reader somewhere unrelated in the document. Snap back to where they were.
  const lastScaleRef = React.useRef(scale);
  React.useEffect(() => {
    if (lastScaleRef.current === scale) return;
    lastScaleRef.current = scale;
    const frame = requestAnimationFrame(() =>
      scrollToPage(currentPageRef.current, "auto"),
    );
    return () => cancelAnimationFrame(frame);
  }, [scale, scrollToPage]);

  function zoom(direction: 1 | -1) {
    setManualZoom(nextZoomStop(scale, direction));
    setFitWidth(false);
  }

  const percent = Math.round(scale * 100);
  const canPrev = currentPage > 1;
  const canNext = currentPage < pageCount;

  return (
    <div
      className={cn(
        "bg-muted/40 flex min-h-0 flex-col overflow-hidden rounded-xl border",
        className,
      )}
    >
      <div className="bg-card/80 flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5 backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => scrollToPage(currentPage - 1)}
          disabled={!canPrev}
          aria-label="Previous page"
        >
          <ChevronUpIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => scrollToPage(currentPage + 1)}
          disabled={!canNext}
          aria-label="Next page"
        >
          <ChevronDownIcon />
        </Button>

        <span className="text-muted-foreground px-1 text-xs tabular-nums">
          {pageCount > 0 ? `${currentPage} / ${pageCount}` : "–"}
        </span>

        <span className="bg-border mx-1 h-5 w-px" aria-hidden="true" />

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => zoom(-1)}
          disabled={!pdf || scale <= MIN_ZOOM + 0.001}
          aria-label="Zoom out"
        >
          <ZoomOutIcon />
        </Button>
        <span
          className="text-muted-foreground w-12 text-center text-xs tabular-nums"
          aria-hidden="true"
        >
          {pdf ? `${percent}%` : "–"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => zoom(1)}
          disabled={!pdf || scale >= MAX_ZOOM - 0.001}
          aria-label="Zoom in"
        >
          <ZoomInIcon />
        </Button>
        <Button
          type="button"
          variant={fitWidth ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() => setFitWidth((on) => !on)}
          disabled={!pdf}
          aria-pressed={fitWidth}
          aria-label="Fit page width"
        >
          <StretchHorizontalIcon />
        </Button>

        {/* The percentage is decorative in the toolbar (it sits between two
            buttons that already say what they do); this is the version a
            screen reader hears, and only when it changes. */}
        <span role="status" aria-live="polite" className="sr-only">
          {pdf ? `Zoom ${percent} percent` : ""}
        </span>

        {actions ? (
          <div className="ml-auto flex items-center gap-1">{actions}</div>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        // Focusable so the pages can be scrolled from the keyboard; without a
        // tabindex a scroll container with no focusable children is reachable
        // by mouse only.
        tabIndex={0}
        role="region"
        aria-label={label}
        aria-busy={busy || isLoading}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {error ? (
          <div className="p-4">
            <ErrorState
              error={error}
              title="This PDF could not be displayed"
            />
          </div>
        ) : !bytes ? (
          <div className="flex h-full items-center justify-center p-6">
            {placeholder ?? (
              <p className="text-muted-foreground text-sm">
                Nothing to preview yet.
              </p>
            )}
          </div>
        ) : isLoading && pageCount === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 p-6 text-sm">
            <Spinner />
            Opening the PDF…
          </div>
        ) : (
          <div
            className="flex flex-col items-center gap-4"
            style={{ padding: PAGE_GUTTER / 2 }}
          >
            {Array.from({ length: pageCount }, (_, index) => (
              <div
                key={index}
                data-page-number={index + 1}
                ref={(element) => {
                  pageRefs.current[index] = element;
                }}
                className="shadow-sm ring-1 ring-black/10"
              >
                {pdf ? (
                  <PdfPageCanvas
                    document={pdf}
                    pageNumber={index + 1}
                    scale={scale}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}

        {busy ? (
          <div className="bg-background/55 absolute inset-0 flex items-start justify-center pt-10 backdrop-blur-[1px]">
            <span className="bg-card text-muted-foreground flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-sm">
              <Spinner className="size-3.5" />
              {busyLabel}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
