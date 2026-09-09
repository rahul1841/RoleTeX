"use client";

import { GraduationCapIcon } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { EntryCard, useAnnounce } from "../entry-card";
import { TextField } from "../fields";
import { BLANK, MAX_ENTRIES, type ResumeFormValues } from "../resume-form";
import { TextListField } from "../text-list-field";
import { AddEntryButton, FormSection, SectionEmpty } from "./section-frame";

function EducationEntry({
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
  const institution = useWatch({
    control,
    name: `education.${index}.institution`,
  });
  const degree = useWatch({ control, name: `education.${index}.degree` });

  return (
    <EntryCard
      index={index}
      count={count}
      subject="Education"
      title={institution}
      meta={degree}
      onMove={onMove}
      onRemove={onRemove}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name={`education.${index}.institution`}
          label="School"
          placeholder="University of Cambridge"
        />
        <TextField
          name={`education.${index}.degree`}
          label="Degree"
          placeholder="BA, Computer Science"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          name={`education.${index}.start`}
          label="Start"
          placeholder="2018"
        />
        <TextField
          name={`education.${index}.end`}
          label="End"
          placeholder="2022"
        />
        <TextField
          name={`education.${index}.location`}
          label="Location"
          placeholder="Cambridge, UK"
        />
      </div>
      <TextListField
        name={`education.${index}.details`}
        subject="Detail"
        label="Details"
        max={MAX_ENTRIES.details}
        rows={1}
        placeholder="First-class honours"
        hint="Short lines only"
      />
    </EntryCard>
  );
}

export function EducationSection() {
  const { control } = useFormContext<ResumeFormValues>();
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "education",
  });
  const announce = useAnnounce();

  return (
    <FormSection
      id="education"
      icon={GraduationCapIcon}
      title="Education"
      badge={fields.length > 0 ? fields.length : undefined}
      action={
        <AddEntryButton
          label="Add school"
          onClick={() => {
            append(BLANK.education());
            announce("Education added.");
          }}
          limitReached={fields.length >= MAX_ENTRIES.education}
        />
      }
    >
      {fields.length === 0 ? (
        <SectionEmpty>No education yet.</SectionEmpty>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <EducationEntry
              key={field.id}
              index={index}
              count={fields.length}
              onMove={move}
              onRemove={() => {
                remove(index);
                announce(`Education ${index + 1} removed.`);
              }}
            />
          ))}
        </div>
      )}
    </FormSection>
  );
}
