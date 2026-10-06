"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import {
  BookmarkIcon,
  BookmarkCheckIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  MapPinIcon,
  SparklesIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Canvas, ErrorState, LoadingState, Spinner } from "@/components/common";
import type { JobMatchDetail } from "@/lib/api/types";
import { useJob, useSaveJobAsJd, useUpdateJob } from "@/hooks/use-jobs";
import { experienceLine, failureLine, formatAbsolute, formatRelative } from "./format";

export function JobDetailPanel({
  id,
  onClearSelection,
}: {
  id: string;
  onClearSelection: () => void;
}) {
  const job = useJob(id);

  if (job.isPending) {
    return (
      <LoadingState label="Loading job…">
        <Card>
          <CardHeader>
            <div aria-hidden="true" className="space-y-2">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </CardHeader>
          <CardContent>
            <div aria-hidden="true" className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </CardContent>
        </Card>
      </LoadingState>
    );
  }

  if (job.isError) {
    return (
      <ErrorState
        error={job.error}
        title="Could not load this job"
        onRetry={() => void job.refetch()}
        action={
          <Button variant="outline" size="sm" onClick={onClearSelection}>
            Back to the list
          </Button>
        }
      />
    );
  }

  return <JobDetail job={job.data} onClearSelection={onClearSelection} />;
}

function JobDetail({
  job,
  onClearSelection,
}: {
  job: JobMatchDetail;
  onClearSelection: () => void;
}) {
  const router = useRouter();
  const update = useUpdateJob();
  const saveAsJd = useSaveJobAsJd();
  const { mutate: markSeen } = update;

  // Opening a job is what makes it no longer new; it stays in the list.
  React.useEffect(() => {
    if (job.state === "new") markSeen({ id: job.id, body: { state: "seen" } });
  }, [job.id, job.state, markSeen]);

  const setState = async (state: "seen" | "saved" | "dismissed", message: string) => {
    try {
      await update.mutateAsync({ id: job.id, body: { state } });
      toast.success(message);
      if (state === "dismissed") onClearSelection();
    } catch (error) {
      toast.error("Could not update this job", { description: failureLine(error) });
    }
  };

  const tailor = async () => {
    try {
      const response = await saveAsJd.mutateAsync(job.id);
      router.push(`/tailor?jd=${encodeURIComponent(response.jd_id)}`);
    } catch (error) {
      toast.error("Could not save this job as a job description", {
        description: failureLine(error),
      });
    }
  };

  const saved = job.state === "saved";

  return (
    <article aria-labelledby="job-title" className="space-y-6">
      <div className="bg-card rounded-[1.25rem] p-6 ring-1 ring-foreground/10 sm:p-7">
        <div className="space-y-3">
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            {job.company}
            {job.closed ? <span className="text-destructive">· posting closed</span> : null}
          </p>
          <h2
            id="job-title"
            className="font-heading text-2xl leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-3xl"
          >
            {job.title}
          </h2>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {job.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPinIcon aria-hidden="true" className="size-4" />
                {job.location}
              </span>
            ) : null}
            <span
              className={cn(
                job.label === "fits" && "text-diff-added-foreground",
                job.label === "stretch" && "text-warning-foreground",
              )}
            >
              {experienceLine(job)}
            </span>
            <span className="font-mono text-xs" title={formatAbsolute(job.first_seen_at)}>
              found {formatRelative(job.first_seen_at)}
            </span>
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button className="h-10 rounded-xl px-4" disabled={saveAsJd.isPending} onClick={() => void tailor()}>
            {saveAsJd.isPending ? <Spinner data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
            Tailor a resume
          </Button>
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="border-input hover:bg-muted inline-flex h-10 items-center gap-1.5 rounded-xl border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Open posting
            <ExternalLinkIcon aria-hidden="true" className="size-4" />
          </a>
          <Button
            variant="outline"
            className="h-10 rounded-xl px-4"
            disabled={update.isPending}
            onClick={() => void setState(saved ? "seen" : "saved", saved ? "Removed from saved" : "Saved")}
          >
            {saved ? <BookmarkCheckIcon data-icon="inline-start" /> : <BookmarkIcon data-icon="inline-start" />}
            {saved ? "Saved" : "Save"}
          </Button>
          <Button
            variant="ghost"
            className="h-10 rounded-xl px-4"
            disabled={update.isPending}
            onClick={() => void setState("dismissed", "Job dismissed")}
          >
            <EyeOffIcon data-icon="inline-start" />
            Dismiss
          </Button>
        </div>
      </div>

      {job.description ? (
        <Canvas className="px-3 py-5 sm:px-8 sm:py-8">
          {/* Untrusted posting text, stored as plain text and shown verbatim. */}
          <div
            role="region"
            aria-label="Job description"
            tabIndex={0}
            className="bg-card focus-visible:ring-ring/50 mx-auto max-w-3xl overflow-auto rounded-sm px-6 py-7 text-[0.9375rem] leading-7 break-words whitespace-pre-wrap shadow-[0_0_0_1px_rgb(21_24_31/0.06),0_16px_48px_rgb(21_24_31/0.10)] outline-none focus-visible:ring-3 sm:px-12 sm:py-10"
          >
            {job.description}
          </div>
        </Canvas>
      ) : null}
    </article>
  );
}
