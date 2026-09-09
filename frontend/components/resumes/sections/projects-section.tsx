"use client";

import { FolderGitIcon } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { EntryCard, useAnnounce } from "../entry-card";
import { TextField } from "../fields";
import { BLANK, MAX_ENTRIES, type ResumeFormValues } from "../resume-form";
import { TextListField } from "../text-list-field";
import { AddEntryButton, FormSection, SectionEmpty } from "./section-frame";

function ProjectEntry({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  const { control } = useFormContext<ResumeFormValues>();
  const name = useWatch({ control, name: `projects.${index}.name` });
  const technologies = useWatch({
    control,
    name: `projects.${index}.technologies`,
  });

  return (
    <EntryCard
      index={index}
      count={count}
      subject="Project"
      title={name}
      meta={technologies}
      onMove={onMove}
      onRemove={onRemove}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name={`projects.${index}.name`}
          label="Project name"
          placeholder="roletex"
        />
        <TextField
          name={`projects.${index}.url`}
          label="Link"
          type="url"
          inputMode="url"
          placeholder="https://github.com/you/roletex"
          hint="Optional. Rendered as a clickable project title."
        />
      </div>
      <TextField
        name={`projects.${index}.technologies`}
        label="Technologies"
        placeholder="Python, FastAPI, MongoDB, LaTeX"
        hint="Separate with commas."
      />
      <TextListField
        name={`projects.${index}.bullets`}
        subject="Bullet"
        label="What it does"
        max={MAX_ENTRIES.bullets}
        placeholder="Compiles a tailored resume to PDF in under three seconds using a locked LaTeX template."
      />
    </EntryCard>
  );
}

export function ProjectsSection() {
  const { control } = useFormContext<ResumeFormValues>();
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "projects",
  });
  const announce = useAnnounce();

  return (
    <FormSection
      id="projects"
      icon={FolderGitIcon}
      title="Projects"
      badge={fields.length > 0 ? fields.length : undefined}
      description="Things you built that are not a job. Useful when your experience section is short."
      action={
        <AddEntryButton
          label="Add project"
          onClick={() => {
            append(BLANK.project());
            announce("Project added.");
          }}
          limitReached={fields.length >= MAX_ENTRIES.projects}
        />
      }
    >
      {fields.length === 0 ? (
        <SectionEmpty>No projects yet.</SectionEmpty>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <ProjectEntry
              key={field.id}
              index={index}
              count={fields.length}
              onMove={move}
              onRemove={() => {
                remove(index);
                announce(`Project ${index + 1} removed.`);
              }}
            />
          ))}
        </div>
      )}
    </FormSection>
  );
}
