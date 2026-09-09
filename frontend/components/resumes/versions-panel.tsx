"use client";

import * as React from "react";
import { cn } from "cn";
import { FilePlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CopyButton,
  ErrorState,
  ListSkeleton,
  LoadingState,
  TextSkeleton,
} from "@/components/common";
import { useResumeVersions, useResumeVersionSource } from "@/hooks/use-resumes";
import { ImportResumeDialog } from "./import-dialog";
import { absoluteTime, relativeTime, sourceLabel } from "./format";
import type { ResumeDetail } from "@/lib/api/types";

/**
 * The history of one resume, and the LaTeX behind each entry.
 *
 * Versions are additive and never destructive: every save from the builder and
 * every re-import appends one, and the newest is the "current" content the
 * tailor and the preview use. There is no revert endpoint, so this reads
 * rather than edits — the way back to an old wording is to copy its source and
 * re-import it, which is exactly what the source view and its copy button are
 * for.
 */

function VersionSource({
  resumeId,
  version,
}: {
  resumeId: string;
  version: number;
}) {
  const source = useResumeVersionSource(resumeId, version);

  if (source.isLoading) {
    return (
      <LoadingState label={`Loading the source of version ${version}…`}>
        <TextSkeleton lines={6} />
      </LoadingState>
    );
  }
  if (source.isError) {
    return (
      <ErrorState
        error={source.error}
        onRetry={() => void source.refetch()}
        title="That version's source could not be loaded"
      />
    );
  }

  const text = source.data?.source_text ?? "";
  const isRendered = source.data?.source_type === "manual";

  return (
    <div className="border-code-border bg-code overflow-hidden rounded-lg border">
      <div className="border-code-border flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
        <span className="text-muted-foreground text-xs">
          {isRendered
            ? "The LaTeX the server rendered from this version."
            : "The document this version was imported from."}
        </span>
        <CopyButton value={text} label="Copy" subject="LaTeX source" variant="ghost" />
      </div>
      <pre className="text-code-foreground max-h-[28rem] overflow-auto p-3 text-[0.7rem] leading-relaxed">
        {text || "This version stored no source text."}
      </pre>
    </div>
  );
}

export interface VersionsPanelProps {
  resume: ResumeDetail;
}

export function VersionsPanel({ resume }: VersionsPanelProps) {
  const versions = useResumeVersions(resume.id);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);

  const list = versions.data?.versions ?? [];
  const current = resume.version;

  // Default the selection to whatever is current, once the list arrives.
  const active = selected ?? current;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-semibold">Versions</h2>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setImportOpen(true)}
          >
            <FilePlusIcon data-icon="inline-start" />
            Add from a document
          </Button>
        </div>

        {versions.isLoading ? (
          <LoadingState label="Loading versions…">
            <ListSkeleton rows={3} />
          </LoadingState>
        ) : versions.isError ? (
          <ErrorState
            error={versions.error}
            onRetry={() => void versions.refetch()}
          />
        ) : (
          <ul className="divide-border overflow-hidden rounded-xl border divide-y">
            {[...list]
              .sort((a, b) => b.version - a.version)
              .map((entry) => {
                const isActive = entry.version === active;
                return (
                  <li key={entry.version}>
                    <button
                      type="button"
                      aria-current={isActive ? "true" : undefined}
                      onClick={() => setSelected(entry.version)}
                      className={cn(
                        "focus-visible:ring-ring/50 flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors focus-visible:ring-3 focus-visible:outline-none",
                        isActive ? "bg-muted" : "hover:bg-muted/50",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium tabular-nums">
                          v{entry.version}
                        </span>
                        {entry.version === current ? (
                          <Badge variant="secondary">Current</Badge>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {sourceLabel(entry.source_type)}
                        {entry.created_at ? (
                          <>
                            {" · "}
                            <time
                              dateTime={entry.created_at}
                              title={absoluteTime(entry.created_at)}
                            >
                              {relativeTime(entry.created_at)}
                            </time>
                          </>
                        ) : null}
                      </span>
                      {entry.model ? (
                        <span className="text-muted-foreground font-mono text-[0.7rem]">
                          {entry.model}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
      </div>

      <div className="min-w-0">
        <VersionSource resumeId={resume.id} version={active} />
      </div>

      <ImportResumeDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        target={{
          kind: "version",
          resumeId: resume.id,
          resumeName: resume.name,
        }}
      />
    </div>
  );
}
