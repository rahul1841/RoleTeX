"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SparklesIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CardSkeleton,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  PageContainer,
  PageHero,
  Spinner,
  TextSkeleton,
} from "@/components/common";
import { downloadBase64Pdf } from "@/components/pdf";
import {
  useCreateResume,
  useDeleteResume,
  usePreviewResume,
  useResume,
  useUpdateResumeContent,
} from "@/hooks/use-resumes";
import { resumeErrorGuidance } from "./errors";
import {
  absoluteTime,
  isLowConfidenceSource,
  relativeTime,
  sourceHint,
  sourceLabel,
} from "./format";
import { RenameResumeDialog } from "./rename-dialog";
import { ResumeBuilder } from "./resume-builder";
import { resumeDataToForm } from "./resume-form";

/**
 * One saved resume, open in the editor.
 *
 * Save overwrites it (`PUT /api/resumes/{id}/content`); the first save of an
 * imported resume turns it into a manually authored one. "Save as new resume"
 * leaves it untouched and creates a copy with the edits, then opens the copy.
 */
export function ResumeDetailView({ id }: { id: string }) {
  const router = useRouter();
  const query = useResume(id);
  const update = useUpdateResumeContent(id);
  const create = useCreateResume();
  const remove = useDeleteResume();
  const compile = usePreviewResume();

  const [renaming, setRenaming] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const resume = query.data?.resume ?? null;

  const defaultValues = React.useMemo(
    () =>
      resume
        ? resumeDataToForm(resume.data, resume.style, resume.name)
        : null,
    // Re-seeded when the stored resume changes — a save here or in another tab.
    [resume],
  );

  async function handleDownload() {
    if (!resume) return;
    try {
      const response = await compile.mutateAsync({ resume_id: resume.id });
      downloadBase64Pdf(response.pdf_base64, resume.name || response.filename);
    } catch (thrown) {
      const guidance = resumeErrorGuidance(thrown);
      toast.error(guidance?.title ?? "Could not compile this resume", {
        description:
          guidance?.hint ??
          (thrown instanceof Error ? thrown.message : undefined),
      });
    }
  }

  async function handleDelete() {
    await remove.mutateAsync(id);
    toast.success("Resume deleted");
    router.push("/resumes");
  }

  if (query.isLoading) {
    return (
      <PageContainer width="wide" className="sm:pt-12 sm:pb-16">
        <PageHero eyebrow="Resume" title="Loading…" />
        <div className="mt-10">
          <LoadingState label="Loading this resume…">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <CardSkeleton />
                <TextSkeleton lines={6} />
              </div>
              <CardSkeleton className="min-h-96" />
            </div>
          </LoadingState>
        </div>
      </PageContainer>
    );
  }

  if (query.isError || !resume || !defaultValues) {
    return (
      <PageContainer width="wide" className="sm:pt-12 sm:pb-16">
        <PageHero eyebrow="Resume" title="Resume unavailable" />
        <div className="mt-10 space-y-3">
          <ErrorState
            error={query.error ?? new Error("This resume could not be loaded.")}
            title={resumeErrorGuidance(query.error)?.title}
            onRetry={() => void query.refetch()}
            action={
              <ButtonLink variant="ghost" size="sm" href="/resumes">
                Back to all resumes
              </ButtonLink>
            }
          />
        </div>
      </PageContainer>
    );
  }

  const updated = resume.updated_at ?? resume.created_at;
  const scanned = isLowConfidenceSource(resume.source_type);

  return (
    <PageContainer width="wide" className="sm:pt-12 sm:pb-16">
      <PageHero
        eyebrow={
          <span>{sourceLabel(resume.source_type)}</span>
        }
        title={resume.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {updated ? (
              <time dateTime={updated} title={absoluteTime(updated)}>
                Updated {relativeTime(updated)}
              </time>
            ) : null}
            {resume.model ? (
              <>
                <span aria-hidden="true" className="opacity-50">·</span>
                <span className="font-mono text-[0.8125rem]" title={sourceHint(resume.source_type)}>
                  read by {resume.model}
                </span>
              </>
            ) : null}
            {scanned ? (
              <Badge className="border-warning-border bg-warning text-warning-foreground">
                Read from page images — check every field
              </Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            <ButtonLink variant="ghost" href="/resumes" className="h-10 rounded-xl px-3">
              <ArrowLeftIcon data-icon="inline-start" />
              All resumes
            </ButtonLink>
            <Button
              variant="outline"
              className="h-10 rounded-xl px-4"
              onClick={() => void handleDownload()}
              disabled={compile.isPending}
            >
              {compile.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <DownloadIcon data-icon="inline-start" />
              )}
              Download PDF
            </Button>
            <ButtonLink
              href={{ pathname: "/tailor", query: { resume: resume.id } }}
              className="h-10 rounded-xl px-4"
            >
              <SparklesIcon data-icon="inline-start" />
              Tailor this resume
            </ButtonLink>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-10 rounded-xl"
                    aria-label={`More actions for ${resume.name}`}
                  >
                    <MoreHorizontalIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setRenaming(true)}>
                  <PencilIcon data-icon="inline-start" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <TrashIcon data-icon="inline-start" />
                  Delete resume
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <ResumeBuilder
        // Remounting on id alone: a save changes the stored resume but the
        // form already holds exactly what was saved, and remounting there
        // would throw away the user's scroll position and focus.
        key={resume.id}
        className="mt-10"
        mode="edit"
        defaultValues={defaultValues}
        isSaving={update.isPending || create.isPending}
        saveError={update.error ?? create.error}
        onSubmit={async ({ draft, style }) => {
          await update.mutateAsync({ resume: draft, style });
          toast.success("Saved");
        }}
        onSaveAsNew={async ({ draft, style }) => {
          const response = await create.mutateAsync({
            resume: draft,
            style,
            name: `${resume.name} (copy)`.slice(0, 120),
          });
          toast.success("Saved as a new resume", {
            description: `“${resume.name}” is unchanged.`,
          });
          router.push(`/resumes?id=${encodeURIComponent(response.resume.id)}`);
        }}
      />

      <RenameResumeDialog
        resume={renaming ? { id: resume.id, name: resume.name } : null}
        onOpenChange={(open) => setRenaming(open)}
      />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete “${resume.name}”?`}
        description="Tailoring runs made from it keep their own copy of the resume and are not affected. This cannot be undone."
        confirmLabel="Delete resume"
        pending={remove.isPending}
        onConfirm={async () => {
          try {
            await handleDelete();
          } catch (thrown) {
            // <ConfirmDialog> stays open and reports nothing on rejection, so
            // saying what went wrong is this caller's job.
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
