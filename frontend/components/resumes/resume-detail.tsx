"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  DownloadIcon,
  HistoryIcon,
  PencilIcon,
  SquarePenIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CardSkeleton,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  PageContainer,
  PageHeader,
  Spinner,
  TextSkeleton,
} from "@/components/common";
import { downloadBase64Pdf } from "@/components/pdf";
import {
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
import { VersionsPanel } from "./versions-panel";

/**
 * One saved resume: edit it, or look at where it came from.
 *
 * Saving is version-additive — `PUT /api/resumes/{id}/content` appends a new
 * version rather than overwriting, and the first save of an imported resume
 * turns that version into a manually authored one. The button therefore says
 * "Save as new version", because that is what it does, and the version count
 * in the header is the receipt.
 */
export function ResumeDetailView({ id }: { id: string }) {
  const router = useRouter();
  const query = useResume(id);
  const update = useUpdateResumeContent(id);
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
    // Re-seeded when the stored version changes — a save, or an import that
    // added a version in another tab.
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
      <PageContainer width="wide">
        <PageHeader title="Resume" />
        <div className="mt-8">
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
      <PageContainer>
        <PageHeader title="Resume" />
        <div className="mt-8 space-y-3">
          <ErrorState
            error={query.error ?? new Error("This resume could not be loaded.")}
            title={resumeErrorGuidance(query.error)?.title}
            onRetry={() => void query.refetch()}
            action={
              <Button variant="ghost" size="sm" render={<Link href="/resumes" />}>
                Back to all resumes
              </Button>
            }
          />
        </div>
      </PageContainer>
    );
  }

  const updated = resume.updated_at ?? resume.created_at;
  const scanned = isLowConfidenceSource(resume.source_type);

  return (
    <PageContainer width="wide">
      <PageHeader
        title={resume.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span title={sourceHint(resume.source_type)}>
              {sourceLabel(resume.source_type)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              version {resume.version}
            </span>
            {updated ? (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={updated} title={absoluteTime(updated)}>
                  updated {relativeTime(updated)}
                </time>
              </>
            ) : null}
            {scanned ? (
              <Badge className="border-warning-border bg-warning text-warning-foreground">
                Read from page images
              </Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              render={<Link href="/resumes" />}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              All resumes
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenaming(true)}
            >
              <PencilIcon data-icon="inline-start" />
              Rename
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDownload()}
              disabled={compile.isPending}
            >
              {compile.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <DownloadIcon data-icon="inline-start" />
              )}
              Download saved PDF
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmingDelete(true)}
            >
              <TrashIcon data-icon="inline-start" />
              Delete
            </Button>
          </>
        }
      />

      <Tabs defaultValue="edit" className="mt-6">
        <TabsList variant="line">
          <TabsTrigger value="edit">
            <SquarePenIcon data-icon="inline-start" />
            Edit
          </TabsTrigger>
          <TabsTrigger value="versions">
            <HistoryIcon data-icon="inline-start" />
            Versions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="pt-6">
          <ResumeBuilder
            // Remounting on id alone: a save changes the version but the form
            // already holds exactly what was saved, and remounting there would
            // throw away the user's scroll position and focus.
            key={resume.id}
            mode="edit"
            defaultValues={defaultValues}
            isSaving={update.isPending}
            saveError={update.error}
            onSubmit={async ({ draft, style }) => {
              await update.mutateAsync({ resume: draft, style });
              toast.success("Saved as a new version");
            }}
            footer={
              <p className="text-muted-foreground text-xs text-pretty">
                Saving appends a version; the previous wording stays in the
                Versions tab.
              </p>
            }
          />
        </TabsContent>

        <TabsContent value="versions" className="pt-6">
          <VersionsPanel resume={resume} />
        </TabsContent>
      </Tabs>

      <RenameResumeDialog
        resume={renaming ? { id: resume.id, name: resume.name } : null}
        onOpenChange={(open) => setRenaming(open)}
      />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete “${resume.name}”?`}
        description="Every version of it goes too. Tailoring runs made from it keep their own copy of the resume and are not affected. This cannot be undone."
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
