"use client";

import * as React from "react";
import { FileTextIcon, PlusIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  CardGridSkeleton,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageContainer,
  PageHeader,
} from "@/components/common";
import { useDeleteResume, useResumes } from "@/hooks/use-resumes";
import { resumeErrorGuidance } from "./errors";
import { sortResumes } from "./format";
import { ImportResumeDialog } from "./import-dialog";
import { RenameResumeDialog } from "./rename-dialog";
import { ResumeCard } from "./resume-card";
import type { ResumeSummary } from "@/lib/api/types";

/**
 * The resume library.
 *
 * Two ways in, and they are genuinely different: the builder writes a resume
 * with no model involved and no provider key needed, while importing sends a
 * document to an LLM. Both are offered here, with the no-key path as the
 * primary button, because it is the one that always works.
 */
export function ResumeLibrary() {
  const query = useResumes();
  const remove = useDeleteResume();

  const [importing, setImporting] = React.useState(false);
  const [renaming, setRenaming] = React.useState<ResumeSummary | null>(null);
  const [deleting, setDeleting] = React.useState<ResumeSummary | null>(null);

  const resumes = React.useMemo(
    () => sortResumes(query.data?.resumes ?? []),
    [query.data],
  );

  const actions = (
    <>
      <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
        <UploadIcon data-icon="inline-start" />
        Import
      </Button>
      <ButtonLink
        size="sm"
        href={{ pathname: "/resumes", query: { new: "1" } }}
      >
        <PlusIcon data-icon="inline-start" />
        New resume
      </ButtonLink>
    </>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Resumes"
        description="Everything you can tailor from. Each one keeps every version it has ever had."
        actions={actions}
      />

      <div className="mt-8">
        {query.isLoading ? (
          <LoadingState label="Loading your resumes…">
            <CardGridSkeleton count={3} />
          </LoadingState>
        ) : query.isError ? (
          <ErrorState
            error={query.error}
            title={resumeErrorGuidance(query.error)?.title}
            onRetry={() => void query.refetch()}
          />
        ) : resumes.length === 0 ? (
          <EmptyState
            icon={FileTextIcon}
            title="No resumes yet"
            description="Write one in the builder — no AI provider needed — or import a PDF or LaTeX file you already have and edit what the model reads out of it."
            action={actions}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {resumes.map((resume) => (
                <ResumeCard
                  key={resume.id}
                  resume={resume}
                  onRename={setRenaming}
                  onDelete={setDeleting}
                />
              ))}
            </div>
            <p className="text-muted-foreground mt-4 text-xs tabular-nums">
              {resumes.length} resume{resumes.length === 1 ? "" : "s"}
            </p>
          </>
        )}
      </div>

      <ImportResumeDialog
        open={importing}
        onOpenChange={setImporting}
        target={{ kind: "new" }}
      />

      <RenameResumeDialog
        resume={renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={deleting ? `Delete “${deleting.name}”?` : "Delete resume?"}
        description="Every version of it goes too. This cannot be undone."
        confirmLabel="Delete resume"
        pending={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success("Resume deleted");
            setDeleting(null);
          } catch (thrown) {
            toast.error("Could not delete this resume", {
              description:
                thrown instanceof Error ? thrown.message : "Please try again.",
            });
            throw thrown;
          }
        }}
      />
    </PageContainer>
  );
}
