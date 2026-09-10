"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { toast } from "sonner";
import { ButtonLink } from "@/components/ui/button";
import { PageContainer, PageHeader } from "@/components/common";
import { useCreateResume } from "@/hooks/use-resumes";
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

  return (
    <PageContainer width="wide">
      <PageHeader
        title="New resume"
        description="Fill in what you can and watch the PDF compile beside you. Nothing is saved until you create it."
        actions={
          <ButtonLink variant="ghost" size="sm" href="/resumes">
            <ArrowLeftIcon data-icon="inline-start" />
            All resumes
          </ButtonLink>
        }
      />

      <div className="mt-6">
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
    </PageContainer>
  );
}
