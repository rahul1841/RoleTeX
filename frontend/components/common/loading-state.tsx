import * as React from "react";
import { cn } from "cn";
import { Loader2Icon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The one spinner in the app, so pending buttons and inline waits all look the
 * same. Marked `aria-hidden` because it never carries meaning on its own — the
 * surrounding control or <LoadingState> supplies the text.
 */
export function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      aria-hidden="true"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export interface LoadingStateProps {
  /** Announced to assistive tech. Say what is loading, not just "loading". */
  label?: string;
  /**
   * The skeleton to show. Defaults to a list, because most screens in this app
   * are lists. Pass a shape that matches what will actually arrive — a
   * skeleton that lies about the layout is worse than a spinner.
   */
  children?: React.ReactNode;
  className?: string;
}

/**
 * A busy region with an accessible announcement.
 *
 * `aria-busy` plus a polite live region means a screen reader says "Loading
 * resumes" once and then reads the content when it lands, instead of the
 * silence a bare skeleton produces.
 */
export function LoadingState({
  label = "Loading…",
  children,
  className,
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn("w-full", className)}
    >
      <span className="sr-only">{label}</span>
      {children ?? <ListSkeleton />}
    </div>
  );
}

/** Rows of a table or a stacked list: title, meta line, trailing action. */
export function ListSkeleton({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("divide-border overflow-hidden rounded-xl border divide-y", className)}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-[38%]" />
            <Skeleton className="h-3 w-[22%]" />
          </div>
          <Skeleton className="hidden h-3 w-24 sm:block" />
          <Skeleton className="size-7 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** One card's worth of placeholder: heading, two body lines, a footer chip. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-card space-y-4 rounded-xl border p-4", className)}
    >
      <div className="space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-6 w-20 rounded-full" />
    </div>
  );
}

export function CardGridSkeleton({
  count = 3,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4 sm:grid-cols-2 xl:grid-cols-3",
        className,
      )}
    >
      {Array.from({ length: count }, (_, index) => (
        <CardSkeleton key={index} />
      ))}
    </div>
  );
}

/** Paragraph placeholder; the last line is short so it reads as prose. */
export function TextSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3 w-full", index === lines - 1 && "w-2/3")}
        />
      ))}
    </div>
  );
}
