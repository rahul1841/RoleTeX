"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageContainer, PageHero } from "@/components/common";
import { useCreateResume } from "@/hooks/use-resumes";
import { ImportResumeDialog } from "./import-dialog";
import { ResumeBuilder } from "./resume-builder";
import { emptyResumeForm } from "./resume-form";

/**
 * Write a resume from scratch.
 *
 * `POST /api/resumes/manual` — no LLM call, no provider key, no long timeout.
 * That is the point of this screen existing next to the import dialog: the
 * builder is the path that works on an account with no keys and on a server
 * with no provider configured at all.
 */
export function NewResumeView() {
  const router = useRouter();
  const create = useCreateResume();

  // Computed once: `useForm` reads defaults at mount, and a fresh object on
  // every render would do nothing except allocate.
  const defaultValues = React.useMemo(() => emptyResumeForm(), []);
  const [importing, setImporting] = React.useState(false);

  return (
    <PageContainer width="wide" className="sm:pt-12 sm:pb-16">
      <PageHero
        eyebrow="New resume · no AI key needed"
        title="Write your resume"
        description="Fill in what you can and watch the PDF compile beside you. Nothing is saved until you create it."
        actions={
          <>
            <ButtonLink variant="ghost" href="/resumes" className="h-10 rounded-xl px-3">
              <ArrowLeftIcon data-icon="inline-start" />
              All resumes
            </ButtonLink>
            <Button
              variant="outline"
              className="h-10 rounded-xl px-4"
              onClick={() => setImporting(true)}
            >
              <UploadIcon data-icon="inline-start" />
              Import instead
            </Button>
          </>
        }
      />

      <div className="mt-10">
        <ResumeBuilder
          mode="create"
          defaultValues={defaultValues}
          isSaving={create.isPending}
          saveError={create.error}
          onSubmit={async ({ draft, style, name }) => {
            const response = await create.mutateAsync({
              resume: draft,
              style,
              // The server derives a name from the identity when this is null;
              // sending "" would be a 422 (min_length=1).
              name: name || null,
            });
            toast.success("Resume created");
            router.push(`/resumes?id=${encodeURIComponent(response.resume.id)}`);
          }}
        />
      </div>

      <ImportResumeDialog
        open={importing}
        onOpenChange={setImporting}
        target={{ kind: "new" }}
      />
    </PageContainer>
  );
}
