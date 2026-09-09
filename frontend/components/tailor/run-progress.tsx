"use client";

import { cn } from "cn";
import { CheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/common";
import { formatElapsed, useRunProgress } from "@/hooks/use-tailor";

/**
 * The waiting state for a request that can legitimately take minutes.
 *
 * `POST /api/tailor` runs an LLM completion and a Tectonic compile and then
 * returns one JSON body; it streams nothing in between. A percentage bar would
 * therefore be a fabrication, so this shows the two things that are true — the
 * real elapsed clock and which stage a run of this age is *usually* in — and
 * says plainly that the stages are estimated.
 *
 * Cancelling is real: it aborts the fetch through the run's AbortSignal. It
 * cannot un-spend the tokens, and the copy says so rather than implying the
 * work stops server-side.
 */
export interface RunProgressProps {
  compile: boolean;
  provider: string;
  model: string;
  onCancel: () => void;
  className?: string;
}

export function RunProgress({
  compile,
  provider,
  model,
  onCancel,
  className,
}: RunProgressProps) {
  const { elapsedMs, stages, currentIndex } = useRunProgress(compile);
  const current = stages[currentIndex];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("bg-card rounded-xl p-4 ring-1 ring-foreground/10", className)}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <Spinner className="text-primary mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{current.label}</p>
          <p className="text-muted-foreground mt-0.5 text-xs text-pretty">
            {current.detail}
          </p>
        </div>
        <span className="text-muted-foreground font-mono text-sm tabular-nums">
          {formatElapsed(elapsedMs)}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          <XIcon data-icon="inline-start" />
          Cancel
        </Button>
      </div>

      {/* Deliberately not a percentage: nothing here knows one. */}
      <div className="bg-muted mt-3 h-1 overflow-hidden rounded-full">
        <div className="bg-primary/70 h-full w-full animate-pulse" />
      </div>

      <ol className="mt-3.5 space-y-1.5">
        {stages.map((stage, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li
              key={stage.id}
              className={cn(
                "flex items-center gap-2 text-xs",
                active
                  ? "text-foreground font-medium"
                  : done
                    ? "text-muted-foreground"
                    : "text-muted-foreground/50",
              )}
            >
              <span
                aria-hidden="true"
                className="flex size-3.5 shrink-0 items-center justify-center"
              >
                {done ? (
                  <CheckIcon className="size-3.5" />
                ) : active ? (
                  <Spinner className="size-3" />
                ) : (
                  <span className="bg-current size-1 rounded-full opacity-60" />
                )}
              </span>
              {stage.label}
            </li>
          );
        })}
      </ol>

      <p className="text-muted-foreground/80 mt-3 text-[0.7rem] text-pretty">
        The elapsed clock is real; the stages are estimated from it, because the
        server answers once at the end rather than streaming progress. This run
        uses <span className="font-medium">{provider}</span>
        {model ? <> · <span className="font-medium">{model}</span></> : null}.
        Cancelling stops waiting for the response — it cannot recall work the
        provider has already billed for.
      </p>
    </div>
  );
}
