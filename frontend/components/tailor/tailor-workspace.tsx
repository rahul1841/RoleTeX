"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  FileTextIcon,
  GitCompareIcon,
  ListChecksIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardSkeleton, LoadingState } from "@/components/common";
import { useSession } from "@/hooks/use-session";
import { useTailorRun } from "@/hooks/use-tailor";
import type { TailorRequest } from "@/lib/api/types";
import { ResultReview } from "./result-review";
import { RunProgress } from "./run-progress";
import { SetupPanel, type RunLabels } from "./setup-panel";
import { TailorError } from "./tailor-error";

/**
 * The tailoring workspace: inputs, the long wait, and the review.
 *
 * Two deployment shapes, one screen. In `multi_user` the run names a saved
 * resume and either a saved or a pasted job description; in `demo` there is no
 * database, so the server tailors its built-in sample resume against pasted
 * text. That is why this page is NOT wrapped in <RequiresStorage>: unlike the
 * list screens, it genuinely works without storage.
 *
 * The last request is kept so "Run again" and "Run again without compiling"
 * can reissue exactly what was sent, without depending on the form still
 * holding the same values.
 */
const UNKNOWN_LABELS: RunLabels = {
  resume: "the selected resume",
  jd: "the job description",
  provider: "the configured provider",
  model: "",
};

export function TailorWorkspace() {
  const session = useSession();
  const searchParams = useSearchParams();

  const storage = session.mode === "multi_user";

  const [setupOpen, setSetupOpen] = React.useState(true);
  const [lastRequest, setLastRequest] = React.useState<TailorRequest | null>(
    null,
  );
  const [labels, setLabels] = React.useState<RunLabels | null>(null);

  const run = useTailorRun({
    onSuccess: (response) => {
      const count = response.changes?.length ?? 0;
      toast.success(
        count === 0
          ? "The model proposed no changes"
          : `${count} ${count === 1 ? "change" : "changes"} to review`,
        {
          description: response.pdf_base64
            ? `Compiled to ${response.page_count ?? "?"} page${response.page_count === 1 ? "" : "s"}.`
            : "No PDF was compiled for this run.",
        },
      );
      setSetupOpen(false);
    },
    onError: () => {
      // The failure needs the inputs back on screen to be fixable.
      setSetupOpen(true);
    },
  });

  const start = React.useCallback(
    (request: TailorRequest, runLabels: RunLabels) => {
      setLastRequest(request);
      setLabels(runLabels);
      run.start(request);
    },
    [run],
  );

  const retry = React.useCallback(() => {
    if (lastRequest) start(lastRequest, labels ?? UNKNOWN_LABELS);
  }, [lastRequest, labels, start]);

  /**
   * The escape hatch from a compile failure: the same run with `compile: false`
   * still returns the change list, the diff and the LaTeX source. It is stored
   * as the new last request, so a subsequent "Run again" repeats what actually
   * ran rather than quietly re-enabling the compile that just failed.
   */
  const retryWithoutCompiling = React.useCallback(() => {
    if (!lastRequest) return;
    start({ ...lastRequest, compile: false }, labels ?? UNKNOWN_LABELS);
  }, [lastRequest, labels, start]);

  const cancel = React.useCallback(() => {
    run.cancel();
    toast("Run cancelled", {
      description:
        "The app stopped waiting. If the provider had already started, it may still bill for the call.",
    });
  }, [run]);

  if (session.mode === null) {
    return (
      <LoadingState label="Loading the tailoring workspace…">
        <CardSkeleton />
      </LoadingState>
    );
  }

  return (
    <div className="space-y-6">
      <SetupPanel
        storage={storage}
        user={session.user}
        initialResumeId={searchParams.get("resume") ?? undefined}
        initialJdId={searchParams.get("jd") ?? undefined}
        isRunning={run.isRunning}
        hasResult={Boolean(run.result)}
        onRun={start}
        open={setupOpen}
        onOpenChange={setSetupOpen}
      />

      {run.isRunning ? (
        <RunProgress
          compile={lastRequest?.compile ?? true}
          provider={labels?.provider ?? UNKNOWN_LABELS.provider}
          model={labels?.model ?? ""}
          onCancel={cancel}
        />
      ) : run.error ? (
        <TailorError
          error={run.error}
          onRetry={retry}
          onRetryWithoutCompiling={retryWithoutCompiling}
        />
      ) : run.cancelled ? (
        <CancelledNotice onRunAgain={retry} canRunAgain={Boolean(lastRequest)} />
      ) : run.result ? (
        <ResultReview result={run.result} />
      ) : (
        <IdleExplainer storage={storage} />
      )}
    </div>
  );
}

function CancelledNotice({
  onRunAgain,
  canRunAgain,
}: {
  onRunAgain: () => void;
  canRunAgain: boolean;
}) {
  return (
    <div
      role="status"
      className="border-warning-border/70 bg-warning text-warning-foreground flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm"
    >
      <p className="min-w-0 flex-1 text-pretty">
        <span className="font-medium">Run cancelled.</span> Nothing came back,
        so there is nothing to review. The server may have finished anyway — if
        the run was saving to History, check there before paying for another
        one.
      </p>
      {canRunAgain ? (
        <Button type="button" variant="outline" size="sm" onClick={onRunAgain}>
          <RotateCcwIcon data-icon="inline-start" />
          Run again
        </Button>
      ) : null}
    </div>
  );
}

const PRODUCES = [
  {
    icon: ListChecksIcon,
    title: "A change list",
    body: "Every edit the model proposed, before and after, one card each.",
  },
  {
    icon: GitCompareIcon,
    title: "A unified diff",
    body: "The same edits as a patch, for reading the whole set at once.",
  },
  {
    icon: FileTextIcon,
    title: "A compiled PDF",
    body: "Rendered by Tectonic from the locked template, one page by default.",
  },
] as const;

/**
 * What a run will produce, before there is anything to show.
 *
 * Not decoration: the three outputs are the product's contract, and the last
 * line is the promise rules.md R-14 makes — the model's output is never
 * written back to a saved resume, so reviewing it is the point rather than a
 * formality.
 */
function IdleExplainer({ storage }: { storage: boolean }) {
  return (
    <div className="bg-card rounded-xl p-5 ring-1 ring-foreground/10">
      <h2 className="font-heading text-sm font-medium">What a run gives you</h2>
      <div className="mt-4 grid gap-5 sm:grid-cols-3">
        {PRODUCES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{title}</p>
              <p className="text-muted-foreground mt-0.5 text-xs text-pretty">
                {body}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-5 border-t pt-4 text-xs text-pretty">
        {storage
          ? "Nothing is written back to your saved resume — a run produces a document to review and download, and the record of it in History. "
          : "Nothing is stored on this server — a run produces a document to review and download, and that is all. "}
        A run costs one provider call and, unless you turn it off, one LaTeX
        compile, so it never starts on its own and is never retried
        automatically.
      </p>
    </div>
  );
}
