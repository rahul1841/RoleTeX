"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import {
  MoreHorizontalIcon,
  PencilIcon,
  SparklesIcon,
  TrashIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useResume } from "@/hooks/use-resumes";
import {
  absoluteTime,
  isLowConfidenceSource,
  relativeTime,
  sourceHint,
  sourceLabel,
  versionLabel,
} from "./format";
import { ResumeSheet } from "./resume-sheet";
import type { ResumeSummary } from "@/lib/api/types";

export interface ResumeCardProps {
  resume: ResumeSummary;
  onRename: (resume: ResumeSummary) => void;
  onDelete: (resume: ResumeSummary) => void;
}

/**
 * One resume in the library. The whole card links via a stretched pseudo-element
 * on the title, because the menu and Tailor link can't be nested inside an <a>.
 *
 * The link is `/resumes?id=…`, not `/resumes/…`. The production build is a
 * static export, so there is no dynamic segment to prerender; selection is
 * carried in the query string and read with `useSearchParams`.
 */
export function ResumeCard({ resume, onRename, onDelete }: ResumeCardProps) {
  const updated = resume.updated_at ?? resume.created_at;
  const scanned = isLowConfidenceSource(resume.source_type);

  return (
    <article className="group/card bg-card relative flex w-full flex-col overflow-hidden rounded-[1.25rem] ring-1 ring-foreground/10 transition-shadow focus-within:ring-ring/60 hover:shadow-[0_12px_32px_rgb(21_24_31/0.08)] hover:ring-foreground/20">
      <div
        aria-hidden="true"
        className="bg-muted relative h-52 overflow-hidden border-b [background-image:radial-gradient(var(--border)_1px,transparent_1.2px)] [background-size:20px_20px]"
      >
        <div className="absolute top-6 left-1/2 w-[25rem] origin-top -translate-x-1/2 scale-[0.6] transition-transform duration-300 group-hover/card:-translate-y-1.5">
          <ResumeThumbnail id={resume.id} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-heading min-w-0 text-[1.0625rem] leading-6 font-semibold tracking-tight">
            <Link
              href={{ pathname: "/resumes", query: { id: resume.id } }}
              className="after:absolute after:inset-0 after:rounded-[1.25rem] focus-visible:outline-none"
            >
              <span className="line-clamp-2 text-pretty">{resume.name}</span>
            </Link>
          </h3>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  // Above the stretched link, or the menu is unclickable.
                  className="relative z-10 -mt-0.5 -mr-1.5 shrink-0"
                  aria-label={`Actions for ${resume.name}`}
                >
                  <MoreHorizontalIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onRename(resume)}>
                <PencilIcon data-icon="inline-start" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(resume)}
              >
                <TrashIcon data-icon="inline-start" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant={scanned ? "outline" : "secondary"}
            className={cn(
              scanned && "border-warning-border bg-warning text-warning-foreground",
            )}
            title={sourceHint(resume.source_type)}
          >
            {sourceLabel(resume.source_type)}
          </Badge>
          <Badge variant="outline" className="font-mono tabular-nums">
            {versionLabel(resume.version)}
          </Badge>
        </div>

        <div className="mt-auto flex items-center gap-3 pt-1">
          <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
            {updated ? (
              <time dateTime={updated} title={absoluteTime(updated)}>
                Updated {relativeTime(updated)}
              </time>
            ) : (
              "No timestamp"
            )}
          </p>
          <ButtonLink
            variant="outline"
            size="sm"
            href={{ pathname: "/tailor", query: { resume: resume.id } }}
            className="relative z-10 rounded-lg"
            aria-label={`Tailor ${resume.name}`}
          >
            <SparklesIcon data-icon="inline-start" />
            Tailor
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}

/** Thumbnail from the stored facts (one cached GET per card, never a compile). */
function ResumeThumbnail({ id }: { id: string }) {
  const detail = useResume(id);
  const data = detail.data?.resume.data;

  if (!data) {
    return (
      <div className="aspect-[210/297] w-full bg-white shadow-[0_0_0_1px_rgb(21_24_31/0.08),0_16px_48px_rgb(21_24_31/0.12)]" />
    );
  }
  return <ResumeSheet data={data} />;
}
