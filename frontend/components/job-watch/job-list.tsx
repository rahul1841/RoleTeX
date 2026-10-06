"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { MapPinIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, ListSkeleton, LoadingState } from "@/components/common";
import type { JobMatch } from "@/lib/api/types";
import { useJobs } from "@/hooks/use-jobs";
import { experienceLine, formatAbsolute, formatRelative } from "./format";

export type JobTab = "all" | "saved";

export function JobList({
  tab,
  selectedId,
  href,
  onTab,
}: {
  tab: JobTab;
  selectedId: string | null;
  href: (next: { id?: string | null; tab?: JobTab }) => string;
  onTab: (tab: JobTab) => void;
}) {
  const jobs = useJobs(tab);

  let body: React.ReactNode;
  if (jobs.isPending) {
    body = (
      <LoadingState label="Loading jobs…">
        <ListSkeleton rows={6} />
      </LoadingState>
    );
  } else if (jobs.isError) {
    body = (
      <ErrorState
        error={jobs.error}
        title="Could not load your jobs"
        onRetry={() => void jobs.refetch()}
      />
    );
  } else if (jobs.data.length === 0) {
    body = (
      <EmptyState
        title={tab === "saved" ? "No saved jobs" : "No matches yet"}
        description={
          tab === "saved"
            ? "Save a job to keep it here, even after the posting closes."
            : "New matches appear after each crawl."
        }
        className="py-8"
      />
    );
  } else {
    body = (
      <ul className="bg-card divide-border divide-y overflow-hidden rounded-[1.25rem] ring-1 ring-foreground/10">
        {jobs.data.map((job) => (
          <li key={job.id}>
            <JobRow job={job} href={href({ id: job.id })} selected={job.id === selectedId} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-label="Matched jobs" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(value) => onTab(value === "saved" ? "saved" : "all")}>
          <TabsList>
            <TabsTrigger value="all">Matches</TabsTrigger>
            <TabsTrigger value="saved">Saved</TabsTrigger>
          </TabsList>
        </Tabs>
        {jobs.isSuccess ? (
          <span className="text-muted-foreground font-mono text-xs tabular-nums">{jobs.data.length}</span>
        ) : null}
      </div>
      {body}
    </section>
  );
}

function JobRow({ job, href, selected }: { job: JobMatch; href: string; selected: boolean }) {
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "block px-4 py-3.5 outline-none transition-colors",
        "focus-visible:ring-ring/50 focus-visible:relative focus-visible:z-10 focus-visible:ring-3",
        selected ? "bg-muted shadow-[inset_3px_0_0_0_var(--primary)]" : "hover:bg-muted/50",
      )}
    >
      <p className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        {job.state === "new" ? (
          <>
            <span aria-hidden="true" className="bg-primary size-1.5 shrink-0 rounded-full" />
            <span className="sr-only">New:</span>
          </>
        ) : null}
        <span className="truncate">{job.company}</span>
        {job.closed ? <span className="text-destructive">· closed</span> : null}
      </p>
      <span className="mt-1 line-clamp-2 text-[0.9375rem] leading-snug font-medium">{job.title}</span>
      <p className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]">
        {job.location ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPinIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{job.location}</span>
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
      </p>
      <p
        className="text-muted-foreground mt-1.5 font-mono text-[0.6875rem]"
        title={formatAbsolute(job.first_seen_at)}
      >
        Found {formatRelative(job.first_seen_at)}
      </p>
    </Link>
  );
}
