"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";
import { ArrowLeftIcon, BuildingIcon, SlidersHorizontalIcon } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, LoadingState, PageContainer, PageHero } from "@/components/common";
import { useCompanies, useJobPrefs } from "@/hooks/use-companies";
import { useJobs } from "@/hooks/use-jobs";
import { JobDetailPanel } from "./job-detail";
import { JobList, type JobTab } from "./job-list";

/** The /jobs screen: openings that match the user's preferences. */
export function JobsScreen() {
  return (
    <PageContainer width="wide" className="sm:pt-12 sm:pb-16">
      <PageHero
        eyebrow="Job watch"
        title="Jobs"
        description="Openings from your companies that match your job preferences."
        actions={
          <ButtonLink href="/companies" variant="outline" className="h-10 rounded-xl px-4">
            <SlidersHorizontalIcon data-icon="inline-start" />
            Companies & preferences
          </ButtonLink>
        }
      />
      {/* `useSearchParams` below needs a Suspense boundary for the static export. */}
      <React.Suspense fallback={<WorkspaceFallback />}>
        <JobsWorkspace />
      </React.Suspense>
    </PageContainer>
  );
}

function JobsWorkspace() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedId = searchParams.get("id");
  const tab: JobTab = searchParams.get("tab") === "saved" ? "saved" : "all";
  const prefs = useJobPrefs();
  const companies = useCompanies();
  const jobs = useJobs(tab);

  const href = React.useCallback(
    (next: { id?: string | null; tab?: JobTab }) => {
      const params = new URLSearchParams();
      const nextTab = next.tab ?? tab;
      if (nextTab === "saved") params.set("tab", "saved");
      const id = next.id === undefined ? selectedId : next.id;
      if (id) params.set("id", id);
      const query = params.toString();
      return query ? `/jobs?${query}` : "/jobs";
    },
    [selectedId, tab],
  );

  if (prefs.isPending || companies.isPending) return <WorkspaceFallback />;

  const noPrefs = prefs.isSuccess && !prefs.data.prefs;
  const noCompanies = companies.isSuccess && companies.data.length === 0;
  if (noPrefs || noCompanies) {
    return (
      <EmptyState
        className="mt-10"
        icon={noPrefs ? SlidersHorizontalIcon : BuildingIcon}
        title={noPrefs ? "Set your job preferences" : "Add the companies to watch"}
        description={
          noPrefs
            ? "Choose job types and an experience range; matches appear here after the next crawl."
            : "Upload a list of careers links or add one; their openings are read on the next crawl."
        }
        action={
          <ButtonLink href="/companies" className="h-10 rounded-xl px-4">
            Go to Companies
          </ButtonLink>
        }
      />
    );
  }

  const hasAny = (jobs.data?.length ?? 0) > 0;

  return (
    <div
      className={cn(
        "mt-10 grid gap-6",
        "lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:gap-8",
      )}
    >
      <div className={cn("min-w-0", selectedId && "hidden lg:block")}>
        <div className="lg:sticky lg:top-22 lg:-mx-1 lg:max-h-[calc(100svh-7rem)] lg:overflow-y-auto lg:px-1 lg:pb-2">
          <JobList
            tab={tab}
            selectedId={selectedId}
            href={href}
            onTab={(next) => router.push(href({ tab: next, id: null }))}
          />
        </div>
      </div>
      <div className={cn("min-w-0", !selectedId && "hidden lg:block")}>
        {selectedId ? (
          <div className="space-y-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(href({ id: null }))}
              className="-ml-2 lg:hidden"
            >
              <ArrowLeftIcon data-icon="inline-start" />
              All jobs
            </Button>
            <JobDetailPanel
              key={selectedId}
              id={selectedId}
              onClearSelection={() => router.replace(href({ id: null }))}
            />
          </div>
        ) : hasAny ? (
          <EmptyState title="Pick a job to read" className="min-h-[24rem] justify-center" />
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceFallback() {
  return (
    <LoadingState label="Loading jobs…">
      <div
        aria-hidden="true"
        className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
      >
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-[1.25rem]" />
        </div>
        <Skeleton className="hidden h-96 w-full rounded-[1.25rem] lg:block" />
      </div>
    </LoadingState>
  );
}
