"use client";

import { BriefcaseIcon } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { EntryCard, useAnnounce } from "../entry-card";
import { TextField } from "../fields";
import {
  BLANK,
  MAX_ENTRIES,
  type ResumeFormValues,
} from "../resume-form";
import { TextListField } from "../text-list-field";
import { AddEntryButton, FormSection, SectionEmpty } from "./section-frame";

/**
 * One job.
 *
 * Its own component so the live title in the card header can subscribe to just
 * this row's role and company. `useWatch` on the whole `experience` array
 * would re-render every entry — and every bullet inside every entry — on each
 * keystroke anywhere in the section.
 */
function ExperienceEntry({
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
  const role = useWatch({ control, name: `experience.${index}.role` });
  const company = useWatch({ control, name: `experience.${index}.company` });
  const start = useWatch({ control, name: `experience.${index}.start` });
  const end = useWatch({ control, name: `experience.${index}.end` });

  const dates = [start, end].filter(Boolean).join(" – ");

  return (
    <EntryCard
      index={index}
      count={count}
      subject="Experience"
      title={[role, company].filter(Boolean).join(" · ")}
      meta={dates}
      onMove={onMove}
      onRemove={onRemove}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name={`experience.${index}.role`}
          label="Job title"
          placeholder="Senior Backend Engineer"
        />
        <TextField
          name={`experience.${index}.company`}
          label="Company"
          placeholder="Acme Corp"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          name={`experience.${index}.start`}
          label="Start"
          placeholder="Jan 2022"
        />
        <TextField
          name={`experience.${index}.end`}
          label="End"
          placeholder="Present"
        />
        <TextField
          name={`experience.${index}.location`}
          label="Location"
          placeholder="Remote"
        />
      </div>
      <TextListField
        name={`experience.${index}.bullets`}
        subject="Bullet"
        label="What you did"
        max={MAX_ENTRIES.bullets}
        placeholder="Cut p99 checkout latency from 1.4s to 220ms by replacing the synchronous pricing call with a cached read model."
      />
    </EntryCard>
  );
}

export function ExperienceSection() {
  const { control } = useFormContext<ResumeFormValues>();
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "experience",
  });
  const announce = useAnnounce();

  return (
    <FormSection
      id="experience"
      icon={BriefcaseIcon}
      title="Experience"
      badge={fields.length > 0 ? fields.length : undefined}
      description="Newest first. The tailor rewrites these bullets, so write what you actually did and let it match the wording to a job."
      action={
        <AddEntryButton
          label="Add role"
          onClick={() => {
            append(BLANK.experience());
            announce("Experience added.");
          }}
          limitReached={fields.length >= MAX_ENTRIES.experience}
        />
      }
    >
      {fields.length === 0 ? (
        <SectionEmpty>
          No roles yet. Add one, or import a resume to fill this in.
        </SectionEmpty>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <ExperienceEntry
              key={field.id}
              index={index}
              count={fields.length}
              onMove={move}
              onRemove={() => {
                remove(index);
                announce(`Experience ${index + 1} removed.`);
              }}
            />
          ))}
        </div>
      )}
    </FormSection>
  );
}
