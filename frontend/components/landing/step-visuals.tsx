import type { ReactNode } from "react";
import { ChevronDownIcon, DownloadIcon } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { wordDiff } from "@/components/tailor";
import { SAMPLE_CHANGES } from "./product-preview";
import { PreviewLine } from "./preview-line";

/**
 * The small pictures above each "How it works" step: the resume library, the
 * run's inputs, and the review. Decorative — the step's own heading and text
 * carry the meaning, and the caller hides these from assistive tech — so they
 * are drawn with spans rather than real controls that would take focus.
 */

export function LibraryVisual() {
  return (
    <div className="relative h-33 w-full max-w-70">
      <div className="bg-card absolute top-0 right-0 flex w-[90%] flex-col gap-2 rounded-xl border px-3.5 py-3 opacity-55">
        <span className="text-[0.8125rem] font-medium">Platform engineering</span>
        <Badge variant="secondary" className="self-start">
          From LaTeX
        </Badge>
      </div>
      <div className="bg-card absolute top-7.5 left-0 flex w-[90%] flex-col gap-2.5 rounded-xl border p-3.5 shadow-[0_6px_20px_rgb(21_24_31/0.08)]">
        <span className="text-[0.8125rem] font-medium">Backend roles — 2026</span>
        <span className="flex gap-1.5">
          <Badge variant="secondary">Written here</Badge>
          <Badge variant="outline" className="tabular-nums">
            v3
          </Badge>
        </span>
        <span className="text-muted-foreground text-xs">Updated 2 days ago</span>
      </div>
    </div>
  );
}

export function JobVisual() {
  return (
    <div className="flex w-full max-w-72 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Job description</span>
        <span className="bg-foreground/6 flex rounded-lg p-0.5 text-[0.6875rem] font-medium">
          <span className="bg-card rounded-md px-2 py-0.5 shadow-sm">Saved</span>
          <span className="text-muted-foreground px-2 py-0.5">Paste</span>
        </span>
      </div>
      <FakeSelect>Senior Backend Engineer — Kestrel Pay</FakeSelect>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
        <FakeSelect>Groq</FakeSelect>
        <span className="bg-card text-muted-foreground flex h-8 items-center overflow-hidden rounded-lg border px-2.5 font-mono text-[0.6875rem] whitespace-nowrap">
          llama-3.3-70b-versatile
        </span>
      </div>
    </div>
  );
}

function FakeSelect({ children }: { children: ReactNode }) {
  return (
    <span className="bg-card flex h-8 items-center gap-1.5 rounded-lg border pr-2 pl-2.5 text-[0.8125rem]">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
    </span>
  );
}

export function ReviewVisual() {
  const change = SAMPLE_CHANGES[1];
  const spans = wordDiff(change.before, change.after);

  return (
    <div className="flex w-full max-w-75 flex-col gap-1">
      <PreviewLine tone="removed" size="sm" text={change.before} spans={spans?.before} />
      <PreviewLine tone="added" size="sm" text={change.after} spans={spans?.after} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <Badge variant="secondary" className="tabular-nums">
          1 page
        </Badge>
        <span
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "bg-card pointer-events-none",
          )}
        >
          <DownloadIcon />
          Download
        </span>
      </div>
    </div>
  );
}
