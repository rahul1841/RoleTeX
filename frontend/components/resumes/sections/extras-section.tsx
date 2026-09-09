"use client";

import { AwardIcon, LayoutListIcon } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { EntryCard, useAnnounce } from "../entry-card";
import { TextField } from "../fields";
import { BLANK, MAX_ENTRIES, type ResumeFormValues } from "../resume-form";
import { TextListField } from "../text-list-field";
import { AddEntryButton, FormSection, SectionEmpty } from "./section-frame";

/** A flat list of one-line accomplishments, rendered under its own heading. */
export function AchievementsSection() {
  return (
    <FormSection
      id="achievements"
      icon={AwardIcon}
      title="Achievements"
      description="Awards, talks, publications — anything that is one line and does not belong to a job."
    >
      <TextListField
        name="achievements"
        subject="Achievement"
        label="Achievements"
        hideLabel
        max={MAX_ENTRIES.achievements}
        rows={1}
        placeholder="Speaker, PyCon 2025 — “Compiling resumes on a budget”"
      />
    </FormSection>
  );
}

function CustomSectionEntry({
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
  const title = useWatch({ control, name: `custom_sections.${index}.title` });

  return (
    <EntryCard
      index={index}
      count={count}
      subject="Section"
      title={title}
      onMove={onMove}
      onRemove={onRemove}
    >
      <TextField
        name={`custom_sections.${index}.title`}
        label="Heading"
        placeholder="Certifications"
      />
      <TextListField
        name={`custom_sections.${index}.bullets`}
        subject="Line"
        label="Lines"
        max={MAX_ENTRIES.bullets}
        rows={1}
        placeholder="AWS Solutions Architect — Associate, 2024"
      />
    </EntryCard>
  );
}

/**
 * Sections of the user's own.
 *
 * The renderer places these after the built-in ones, in the order given here,
 * which is why they get the same move controls as everything else.
 */
export function CustomSectionsSection() {
  const { control } = useFormContext<ResumeFormValues>();
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "custom_sections",
  });
  const announce = useAnnounce();

  return (
    <FormSection
      id="custom"
      icon={LayoutListIcon}
      title="Your own sections"
      badge={fields.length > 0 ? fields.length : undefined}
      description="Certifications, languages, volunteering — a heading and a list of lines."
      action={
        <AddEntryButton
          label="Add section"
          onClick={() => {
            append(BLANK.customSection());
            announce("Section added.");
          }}
          limitReached={fields.length >= MAX_ENTRIES.customSections}
        />
      }
    >
      {fields.length === 0 ? (
        <SectionEmpty>No extra sections.</SectionEmpty>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <CustomSectionEntry
              key={field.id}
              index={index}
              count={fields.length}
              onMove={move}
              onRemove={() => {
                remove(index);
                announce(`Section ${index + 1} removed.`);
              }}
            />
          ))}
        </div>
      )}
    </FormSection>
  );
}
