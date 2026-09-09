"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { MoreHorizontalIcon, PencilIcon, TrashIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  absoluteTime,
  isLowConfidenceSource,
  relativeTime,
  sourceHint,
  sourceLabel,
  versionLabel,
} from "./format";
import type { ResumeSummary } from "@/lib/api/types";

export interface ResumeCardProps {
  resume: ResumeSummary;
  onRename: (resume: ResumeSummary) => void;
  onDelete: (resume: ResumeSummary) => void;
}

/**
 * One resume in the library.
 *
 * The card is entirely a link, using a stretched pseudo-element on the title
 * rather than wrapping everything in an `<a>`: the actions menu is a button,
 * and a button inside a link is invalid HTML that browsers resolve
 * inconsistently — usually by making the menu unreachable by keyboard.
 *
 * The link is `/resumes?id=…`, not `/resumes/…`. The production build is a
 * static export, so there is no dynamic segment to prerender; selection is
 * carried in the query string and read with `useSearchParams`.
 */
export function ResumeCard({ resume, onRename, onDelete }: ResumeCardProps) {
  const updated = resume.updated_at ?? resume.created_at;
  const scanned = isLowConfidenceSource(resume.source_type);

  return (
    <div className="group/card bg-card focus-within:border-ring/60 hover:border-ring/40 relative flex flex-col gap-3 rounded-xl border p-4 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-medium">
          <Link
            href={{ pathname: "/resumes", query: { id: resume.id } }}
            className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
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
                className="relative z-10 -mt-1 -mr-1 shrink-0"
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
        <Badge variant="outline" className="tabular-nums">
          {versionLabel(resume.version)}
        </Badge>
      </div>

      <p className="text-muted-foreground mt-auto text-xs">
        {updated ? (
          <time dateTime={updated} title={absoluteTime(updated)}>
            Updated {relativeTime(updated)}
          </time>
        ) : (
          "No timestamp"
        )}
        {resume.model ? (
          <>
            {" · "}
            <span className="font-mono text-[0.7rem]">{resume.model}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
