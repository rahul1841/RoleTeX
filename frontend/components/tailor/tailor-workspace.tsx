"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftIcon, HistoryIcon, RotateCcwIcon } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  CardSkeleton,
  ConfirmDialog,
  LoadingState,
  PageHero,
} from "@/components/common";
import { useSession } from "@/hooks/use-session";
import { useTailorRun } from "@/hooks/use-tailor";
import type { TailorRequest } from "@/lib/api/types";
import { ResultReview } from "./result-review";
import { RunProgress } from "./run-progress";
import { SetupPanel, type RunLabels } from "./setup-panel";
import { TailorError } from "./tailor-error";

/**
 * The tailoring workspace: setup, running, review.
 *
 * Two deployment shapes, one screen. In `multi_user` the run names a saved
 * resume and either a saved or a pasted job description; in `demo` there is no
 * database, so the server tailors its built-in sample resume against pasted
 * text. That is why this page is NOT wrapped in <RequiresStorage>: unlike the
 * list screens, it genuinely works without storage.
 *
 * The setup form stays mounted (just hidden) so "Edit inputs" keeps its values.
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

  const [editing, setEditing] = React.useState(true);
  const [confirmRerun, setConfirmRerun] = React.useState(false);
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
      setEditing(false);
    },
    onError: () => {
      // The failure needs the inputs back on screen to be fixable.
      setEditing(true);
    },
  });

  const start = React.useCallback(
    (request: TailorRequest, runLabels: RunLabels) => {
      setLastRequest(request);
      setLabels(runLabels);
      setEditing(false);
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
    setEditing(true);
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

  const reviewing = !run.isRunning && Boolean(run.result) && !editing;
  const showSetup = !run.isRunning && !reviewing;
  const current = labels ?? UNKNOWN_LABELS;

  return (
    <>
      <div hidden={!showSetup} className="space-y-10">
        <PageHero
          eyebrow={run.result ? "Editing inputs" : "New run"}
          title="Tailor a resume"
          description="Pick a resume, point it at a job, and review every change the model proposes before you download."
          actions={
            run.result ? (
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl px-4"
                onClick={() => setEditing(false)}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Back to review
              </Button>
            ) : storage ? (
              <ButtonLink href="/history" variant="outline" className="h-10 rounded-xl px-4">
                <HistoryIcon data-icon="inline-start" />
                Past runs
              </ButtonLink>
            ) : null
          }
        />

        {run.error ? (
          <TailorError
            error={run.error}
            onRetry={retry}
            onRetryWithoutCompiling={retryWithoutCompiling}
          />
        ) : run.cancelled ? (
          <CancelledNotice onRunAgain={retry} canRunAgain={Boolean(lastRequest)} />
        ) : null}

        <SetupPanel
          storage={storage}
          user={session.user}
          initialResumeId={searchParams.get("resume") ?? undefined}
          initialJdId={searchParams.get("jd") ?? undefined}
          isRunning={run.isRunning}
          hasResult={Boolean(run.result)}
          onRun={start}
        />
      </div>

      {run.isRunning ? (
        <RunProgress
          compile={lastRequest?.compile ?? true}
          provider={current.provider}
          model={current.model}
          resume={current.resume}
          jd={current.jd}
          onCancel={cancel}
        />
      ) : null}

      {reviewing && run.result ? (
        <ResultReview
          result={run.result}
          resume={current.resume}
          jd={current.jd}
          onEditInputs={() => setEditing(true)}
          onRunAgain={() => setConfirmRerun(true)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmRerun}
        onOpenChange={setConfirmRerun}
        destructive={false}
        title="Run tailoring again?"
        confirmLabel="Run again"
        description={`This replaces the result you are reviewing and spends another ${current.provider} completion${lastRequest?.compile === false ? "" : " and another Tectonic compile"}.`}
        onConfirm={retry}
      />
    </>
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
