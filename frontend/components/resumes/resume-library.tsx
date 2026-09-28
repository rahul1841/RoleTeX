"use client";

import * as React from "react";
import {
  ArrowRightIcon,
  FileUpIcon,
  PenLineIcon,
  PlusIcon,
  UploadIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  CardGridSkeleton,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  PageContainer,
  PageHero,
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
 * primary button, because it is the one that always works. An empty library
 * turns the two into the whole page, numbered like the landing page's steps.
 */
const NEW_RESUME = { pathname: "/resumes", query: { new: "1" } } as const;

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

  const count = query.data ? resumes.length : null;

  return (
    <PageContainer width="wide" className="sm:pt-12 sm:pb-16">
      <PageHero
        eyebrow={
          count === null
            ? "Library"
            : `${count} ${count === 1 ? "resume" : "resumes"}`
        }
        title="Your resumes"
        description="Everything you can tailor from. Every save keeps the version before it, so nothing you wrote is ever lost."
        actions={
          <>
            <Button
              variant="outline"
              className="h-10 rounded-xl px-4"
              onClick={() => setImporting(true)}
            >
              <UploadIcon data-icon="inline-start" />
              Import
            </Button>
            <ButtonLink href={NEW_RESUME} className="h-10 rounded-xl px-4">
              <PlusIcon data-icon="inline-start" />
              New resume
            </ButtonLink>
          </>
        }
      />

      <div className="mt-10">
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
          <WaysIn onImport={() => setImporting(true)} />
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {resumes.map((resume) => (
              <li key={resume.id} className="flex">
                <ResumeCard
                  resume={resume}
                  onRename={setRenaming}
                  onDelete={setDeleting}
                />
              </li>
            ))}
            <li className="flex">
              <AddTile onImport={() => setImporting(true)} />
            </li>
          </ul>
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

/** The last tile in the grid: the same two ways in, at card size. */
function AddTile({ onImport }: { onImport: () => void }) {
  return (
    <div className="text-muted-foreground flex min-h-80 w-full flex-col items-center justify-center gap-4 rounded-[1.25rem] border border-dashed p-6 text-center">
      <span
        aria-hidden="true"
        className="bg-muted text-foreground flex size-10 items-center justify-center rounded-xl"
      >
        <PlusIcon className="size-5" />
      </span>
      <p className="max-w-56 text-sm text-pretty">
        Another role in mind? Start one from scratch or bring in a document.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink href={NEW_RESUME} size="sm" variant="outline" className="rounded-lg">
          Write one
        </ButtonLink>
        <Button size="sm" variant="ghost" className="rounded-lg" onClick={onImport}>
          Import
        </Button>
      </div>
    </div>
  );
}

/**
 * The empty library: the two ways in, laid out like the landing page's "How it
 * works" — a picture on the code surface, a mono number, a heading, one line.
 */
function WaysIn({ onImport }: { onImport: () => void }) {
  return (
    <ol className="grid gap-6 lg:grid-cols-2">
      <WayIn
        number="01"
        icon={PenLineIcon}
        title="Write it here"
        body="No AI key needed. Fill in your roles, projects and skills, and watch the PDF compile beside you as you type."
        visual={<WriteVisual />}
        action={
          <ButtonLink href={NEW_RESUME} className="h-11 rounded-xl px-5 text-[0.9375rem]">
            Start writing
            <ArrowRightIcon data-icon="inline-end" />
          </ButtonLink>
        }
      />
      <WayIn
        number="02"
        icon={FileUpIcon}
        title="Import what you have"
        body="Upload a PDF or paste LaTeX. An AI model reads it into fields you can check and edit before you tailor anything."
        visual={<ImportVisual />}
        action={
          <Button
            variant="outline"
            className="h-11 rounded-xl px-5 text-[0.9375rem]"
            onClick={onImport}
          >
            Import a resume
          </Button>
        }
      />
    </ol>
  );
}

function WayIn({
  number,
  icon: Icon,
  title,
  body,
  visual,
  action,
}: {
  number: string;
  icon: LucideIcon;
  title: string;
  body: string;
  visual: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <li className="bg-card flex flex-col overflow-hidden rounded-[1.25rem] ring-1 ring-foreground/10">
      <div
        aria-hidden="true"
        className="bg-code flex h-52 items-center justify-center border-b px-8"
      >
        {visual}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-7">
        {/* The <ol> already numbers the two for assistive tech. */}
        <span aria-hidden="true" className="text-muted-foreground flex items-center gap-2 font-mono text-xs">
          {number}
          <Icon className="size-3.5" />
        </span>
        <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground max-w-md text-[0.9375rem] leading-6 text-pretty">
          {body}
        </p>
        <div className="mt-4">{action}</div>
      </div>
    </li>
  );
}

/** A few builder fields, drawn with spans: decoration, never focusable. */
function WriteVisual() {
  return (
    <div className="flex w-full max-w-72 flex-col gap-2">
      <span className="text-xs font-medium">Experience</span>
      <span className="bg-card flex h-8 items-center rounded-lg border px-2.5 text-[0.8125rem]">
        Senior Backend Engineer
      </span>
      <div className="grid grid-cols-2 gap-2">
        <span className="bg-card flex h-8 items-center truncate rounded-lg border px-2.5 text-[0.8125rem] whitespace-nowrap">
          Brightline Payments
        </span>
        <span className="bg-card text-muted-foreground flex h-8 items-center truncate rounded-lg border px-2.5 text-[0.8125rem] whitespace-nowrap">
          2022 – Present
        </span>
      </div>
      <span className="bg-card text-muted-foreground flex h-12 items-start rounded-lg border px-2.5 py-1.5 text-xs leading-4">
        Rebuilt the settlement pipeline in Python and Kafka…
      </span>
    </div>
  );
}

/** A PDF dropped onto a drop zone, drawn with spans. */
function ImportVisual() {
  return (
    <div className="flex w-full max-w-72 flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-6">
      <span className="bg-card flex items-center gap-2 rounded-lg border px-3 py-2 text-[0.8125rem] font-medium shadow-[0_6px_20px_rgb(21_24_31/0.08)]">
        <FileUpIcon className="text-primary size-4" />
        resume.pdf
      </span>
      <span className="text-muted-foreground font-mono text-[0.6875rem]">
        PDF or LaTeX · up to 3 pages
      </span>
    </div>
  );
}
