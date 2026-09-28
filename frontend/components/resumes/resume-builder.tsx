"use client";

import * as React from "react";
import { cn } from "cn";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  FormProvider,
  useForm,
  useFormContext,
  useWatch,
} from "react-hook-form";
import { SaveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Canvas, ErrorState, Spinner } from "@/components/common";
import { ReorderAnnouncer } from "./entry-card";
import { resumeErrorGuidance } from "./errors";
import { TextField } from "./fields";
import { PreviewPanel } from "./preview-panel";
import {
  formToDraft,
  formToStyle,
  hasContent,
  resumeFormSchema,
  type ResumeFormValues,
} from "./resume-form";
import {
  AchievementsSection,
  CustomSectionsSection,
  EducationSection,
  ExperienceSection,
  IdentitySection,
  ProjectsSection,
  SkillsSection,
  StyleSection,
} from "./sections";
import { useLivePreview } from "./use-live-preview";
import type { ResumeDraft, ResumeStyleInput } from "@/lib/api/types";

/**
 * The resume editor: a long structured form beside a live compile of it.
 *
 * The form is the hardest surface in the app — eight sections, four of them
 * arrays of entries that each contain another array — so the machinery is
 * pushed out to the pieces around it (`fields.tsx` for labelling and aria,
 * `entry-card.tsx` for reordering, `text-list-field.tsx` for bullet lists,
 * `resume-form.ts` for the shape and the rules). What is left here is
 * composition, submit, and the wiring between the draft and the preview.
 *
 * Only the preview subscribes to every keystroke. `useWatch({ control })` in
 * <LivePreviewPane> re-renders that one component; if the builder itself
 * watched the whole form, typing a single character would re-render every
 * section and every bullet in the document.
 */

const SECTIONS = [
  { id: "identity", label: "You", key: "identity" },
  { id: "experience", label: "Experience", key: "experience" },
  { id: "projects", label: "Projects", key: "projects" },
  { id: "education", label: "Education", key: "education" },
  { id: "skills", label: "Skills", key: "skills" },
  { id: "achievements", label: "Achievements", key: "achievements" },
  { id: "custom", label: "Sections", key: "custom_sections" },
  { id: "style", label: "Layout", key: "style" },
] as const;

/** Jump links, with a marker on any section that is holding an error. */
function SectionRail() {
  const {
    formState: { errors },
  } = useFormContext<ResumeFormValues>();

  return (
    <nav aria-label="Resume sections" className="min-w-0 flex-1">
      {/* Beside the save button the rail rarely fits, and a hard edge cuts a
          label mid-word. The fade says "scroll for more" instead; the end
          padding lets the last link scroll clear of it. */}
      <ul className="flex gap-1 overflow-x-auto pr-6 pb-0.5 [mask-image:linear-gradient(to_right,#000_calc(100%_-_1.5rem),transparent)]">
        {SECTIONS.map((section) => {
          const invalid = Boolean(errors[section.key as keyof typeof errors]);
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className={cn(
                  "hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:outline-none",
                  invalid
                    ? "text-destructive font-medium"
                    : "text-muted-foreground",
                )}
              >
                {section.label}
                {invalid ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="bg-destructive size-1.5 rounded-full"
                    />
                    <span className="sr-only">(has errors)</span>
                  </>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The preview column.
 *
 * Kept as its own component purely so the whole-form subscription lives in one
 * leaf. It also decides when a compile is worth attempting: the server
 * validates identity even for a preview (`require_content=False` relaxes the
 * "must have a section" rule, not the "must have a name and an email" one), so
 * sending a draft without them buys a guaranteed 422.
 */
function LivePreviewPane({ className }: { className?: string }) {
  const { control } = useFormContext<ResumeFormValues>();
  const values = useWatch({ control }) as ResumeFormValues;

  const previewable =
    Boolean(values?.identity?.name?.trim()) &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values?.identity?.email?.trim() ?? "");

  const request = React.useMemo(
    () =>
      previewable
        ? { resume: formToDraft(values), style: formToStyle(values) }
        : null,
    [previewable, values],
  );

  const preview = useLivePreview({ request });
  const downloadName =
    values?.resumeName?.trim() || values?.identity?.name?.trim() || "resume";

  return (
    <PreviewPanel
      preview={preview}
      downloadName={downloadName}
      className={className}
      placeholder={
        previewable ? undefined : (
          <p className="text-muted-foreground max-w-xs text-center text-sm text-pretty">
            The preview compiles once you have entered a name and an email
            address — the two fields the template cannot render without.
          </p>
        )
      }
    />
  );
}

export interface ResumeBuilderSubmit {
  draft: ResumeDraft;
  style: ResumeStyleInput;
  /** Only meaningful when creating; the server derives one if it is empty. */
  name: string;
}

export interface ResumeBuilderProps {
  mode: "create" | "edit";
  defaultValues: ResumeFormValues;
  isSaving: boolean;
  saveError: unknown;
  /** Resolve to keep the edits and mark the form clean; reject to keep it dirty. */
  onSubmit: (payload: ResumeBuilderSubmit) => Promise<void>;
  /** Rendered next to the save button — a version note, a cancel link. */
  footer?: React.ReactNode;
  className?: string;
}

export function ResumeBuilder({
  mode,
  defaultValues,
  isSaving,
  saveError,
  onSubmit,
  footer,
  className,
}: ResumeBuilderProps) {
  const form = useForm<ResumeFormValues>({
    resolver: zodResolver(resumeFormSchema),
    defaultValues,
    // Errors appear on submit and then correct themselves as the user types.
    // Validating on every change in a form this size means an error appears
    // under a field the moment it is focused and emptied, which reads as the
    // form arguing with you.
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const guidance = resumeErrorGuidance(saveError);

  const handleSubmit = form.handleSubmit(async (values) => {
    // The "at least one section" rule is a save-time rule only: previewing a
    // contact-block-only resume is allowed and useful. It has no field to
    // attach to, so it becomes a form-level error next to the save button.
    if (!hasContent(values)) {
      form.setError("root.content", {
        type: "manual",
        message:
          "Add at least one section — a role, a project, education, skills, an achievement, or a section of your own.",
      });
      return;
    }
    form.clearErrors("root.content");

    await onSubmit({
      draft: formToDraft(values),
      style: formToStyle(values),
      name: values.resumeName.trim(),
    });
    // Marks the form clean without discarding anything typed while the save
    // was in flight — `getValues()` is read after the await, so it is the
    // current content, not the snapshot that was submitted.
    form.reset(form.getValues());
  });

  const rootError = form.formState.errors.root?.content?.message;
  const isDirty = form.formState.isDirty;

  return (
    <FormProvider {...form}>
      <ReorderAnnouncer>
        <div
          className={cn(
            "grid min-h-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,34rem)] xl:gap-8",
            className,
          )}
        >
          <form onSubmit={handleSubmit} noValidate className="min-w-0">
            {/* Floats under the app header: the section jumps on the left, the
                save on the right, both reachable from anywhere in a long form. */}
            <div className="bg-card/90 supports-backdrop-filter:bg-card/75 sticky top-[4.75rem] z-20 mb-6 flex flex-wrap items-center gap-2 rounded-2xl py-1.5 pr-1.5 pl-1.5 shadow-[0_8px_24px_rgb(21_24_31/0.06)] ring-1 ring-foreground/10 backdrop-blur lg:top-[5.25rem]">
              <SectionRail />
              <div className="flex shrink-0 items-center gap-2.5">
                {isDirty ? (
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <span aria-hidden="true" className="bg-warning-foreground/70 size-1.5 rounded-full" />
                    Unsaved changes
                  </span>
                ) : null}
                <Button type="submit" disabled={isSaving} className="h-9 rounded-xl px-4">
                  {isSaving ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <SaveIcon data-icon="inline-start" />
                  )}
                  {mode === "create" ? "Create resume" : "Save as new version"}
                </Button>
              </div>
            </div>

            <div className="space-y-5">
              {mode === "create" ? (
                <div className="bg-card rounded-[1.25rem] px-5 py-6 ring-1 ring-foreground/10 sm:px-7">
                  <TextField
                    name="resumeName"
                    label="Resume name"
                    placeholder="Backend roles — 2026"
                    hint="Just for your library. Leave it empty and your own name is used."
                    className="max-w-md"
                  />
                </div>
              ) : null}

              <IdentitySection />
              <ExperienceSection />
              <ProjectsSection />
              <EducationSection />
              <SkillsSection />
              <AchievementsSection />
              <CustomSectionsSection />
              <StyleSection />
            </div>

            <div className="mt-6 space-y-3">
              {rootError ? (
                <p
                  role="alert"
                  className="border-destructive/25 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm text-pretty"
                >
                  {rootError}
                </p>
              ) : null}

              {saveError ? (
                <div className="space-y-2">
                  <ErrorState error={saveError} title={guidance?.title} />
                  {guidance?.hint ? (
                    <p className="text-muted-foreground text-xs text-pretty">
                      {guidance.hint}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                {footer}
                <Button type="submit" disabled={isSaving} className="h-11 rounded-xl px-5 text-[0.9375rem]">
                  {isSaving ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <SaveIcon data-icon="inline-start" />
                  )}
                  {mode === "create" ? "Create resume" : "Save as new version"}
                </Button>
              </div>
            </div>
          </form>

          <aside className="lg:sticky lg:top-[5.25rem] lg:h-[calc(100svh-6.5rem)]">
            <Canvas className="flex h-full flex-col p-3 sm:p-4">
              <LivePreviewPane className="h-full" />
            </Canvas>
          </aside>
        </div>
      </ReorderAnnouncer>
    </FormProvider>
  );
}
