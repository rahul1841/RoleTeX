"use client";

import type { CSSProperties } from "react";
import { cn } from "cn";
import { CheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Canvas, PageHero, Spinner } from "@/components/common";
import { formatElapsed, useRunProgress } from "@/hooks/use-tailor";

/**
 * The waiting screen for a request that can legitimately take minutes.
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
  resume: string;
  jd: string;
  onCancel: () => void;
  className?: string;
}

export function RunProgress({
  compile,
  provider,
  model,
  resume,
  jd,
  onCancel,
  className,
}: RunProgressProps) {
  const { elapsedMs, stages, currentIndex } = useRunProgress(compile);
  const current = stages[currentIndex];
  // The last stage is "still working": a note about long runs, not a step.
  const steps = stages.slice(0, -1);
  const overdue = currentIndex >= steps.length;

  return (
    <div className={cn("space-y-10", className)}>
      <PageHero
        eyebrow={
          <span className="tabular-nums">Running · {formatElapsed(elapsedMs)}</span>
        }
        eyebrowIcon={<Spinner className="text-primary size-3" />}
        title="Tailoring your resume"
        description={
          <>
            <span className="text-foreground font-medium">{resume}</span> against{" "}
            <span className="text-foreground font-medium">{jd}</span>. Nothing is
            written back to your resume; you review the result first.
          </>
        }
      />

      <div className="grid items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_30rem]">
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="bg-card flex flex-col rounded-[1.25rem] px-5 py-3 ring-1 ring-foreground/10 sm:px-8"
        >
          <p className="sr-only">
            {current.label}. {formatElapsed(elapsedMs)} elapsed.
          </p>
          <ol aria-hidden="true">
            {steps.map((stage, index) => {
              const done = index < currentIndex;
              const active = index === currentIndex || (overdue && index === steps.length - 1);
              return (
                <li
                  key={stage.id}
                  className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 border-b py-5 last:border-b-0"
                >
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full font-mono text-xs",
                      done && !active
                        ? "bg-diff-added text-diff-added-foreground"
                        : active
                          ? "bg-primary text-primary-foreground ring-primary/15 ring-[5px]"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {done && !active ? (
                      <CheckIcon className="size-3.5" strokeWidth={3} />
                    ) : (
                      String(index + 1).padStart(2, "0")
                    )}
                  </span>
                  <div className="min-w-0 pt-1">
                    <p
                      className={cn(
                        "text-[0.9375rem] font-medium",
                        !done && !active && "text-muted-foreground",
                      )}
                    >
                      {stage.label}
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm leading-6 text-pretty">
                      {stage.id === "model" ? (
                        <>
                          Using {provider}
                          {model ? (
                            <>
                              {" · "}
                              <span className="font-mono text-[0.8125rem]">{model}</span>
                            </>
                          ) : null}
                          . {stage.detail}
                        </>
                      ) : (
                        stage.detail
                      )}
                    </p>
                    {active ? (
                      // Deliberately not a percentage: nothing here knows one.
                      <div className="bg-muted mt-3 h-1.5 max-w-sm overflow-hidden rounded-full">
                        <div className="bg-primary/70 h-full w-full animate-pulse rounded-full" />
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-auto flex flex-col gap-4 border-t pt-5 pb-3 sm:flex-row sm:items-center">
            <p className="text-muted-foreground min-w-0 flex-1 text-[0.8125rem] leading-5 text-pretty">
              {overdue ? `${current.detail} ` : ""}
              The clock is real; the stages are estimated from it, because the
              server answers once at the end. Cancelling stops the wait — it
              cannot recall work the provider has already billed for.
            </p>
            <Button type="button" variant="outline" className="h-10 rounded-xl px-4" onClick={onCancel}>
              <XIcon data-icon="inline-start" />
              Cancel run
            </Button>
          </div>
        </div>

        <Canvas aria-hidden="true" className="hidden items-center justify-center px-10 py-10 xl:flex">
          <div className="relative w-full max-w-[23rem]">
            <div className="flex aspect-[210/297] w-full flex-col gap-2.5 bg-white px-[9%] py-[8%] shadow-[0_0_0_1px_rgb(21_24_31/0.08),0_16px_48px_rgb(21_24_31/0.12)]">
              <PageLine className="mx-auto h-3 w-2/5" />
              <PageLine className="mx-auto w-3/4" />
              <PageLine className="mx-auto mb-3 w-1/2" />
              {SKELETON.map((section, index) => (
                <div key={index} className="mt-1.5 flex flex-col gap-2">
                  <PageLine className="h-2 w-1/4 bg-[#dfe2e9]" />
                  {section.map((width, row) => (
                    <PageLine key={row} style={{ width: `${width}%` }} />
                  ))}
                </div>
              ))}
            </div>
            <div className="bg-card absolute top-10 -left-8 flex h-8 items-center gap-2 rounded-full pr-3 pl-1.5 text-xs font-medium whitespace-nowrap shadow-[0_6px_18px_rgb(21_24_31/0.1)] ring-1 ring-foreground/10">
              <span className="bg-primary/10 text-primary flex size-5 items-center justify-center rounded-full">
                <Spinner className="size-3" />
              </span>
              {current.label}
            </div>
          </div>
        </Canvas>
      </div>
    </div>
  );
}

/** Line widths for the placeholder page's four sections, in percent. */
const SKELETON = [
  [92, 84],
  [96, 88, 90, 74],
  [86, 78],
  [90],
];

function PageLine({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span className={cn("block h-1.5 rounded-[3px] bg-[#eceef3]", className)} style={style} />;
}
