"use client";

import { TrashIcon, WrenchIcon } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { MoveButtons, useAnnounce } from "../entry-card";
import { TextField } from "../fields";
import { BLANK, MAX_ENTRIES, type ResumeFormValues } from "../resume-form";
import { AddEntryButton, FormSection, SectionEmpty } from "./section-frame";

/**
 * A preview of how a comma-separated list will actually be read.
 *
 * The field is one text input rather than a chip editor — typing "Python, Go,
 * Rust" is faster than three add-item interactions — but that leaves the
 * splitting invisible, and "Node.js, React" versus "Node.js React" is a
 * mistake worth catching before it reaches the PDF. So the parsed result is
 * echoed back.
 */
function ParsedItems({ value }: { value: string }) {
  const items = value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (items.length === 0) return null;

  return (
    <ul aria-hidden="true" className="flex flex-wrap gap-1">
      {items.map((item, index) => (
        <li
          key={`${item}-${index}`}
          className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[0.7rem]"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function SkillRow({
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
  const items = useWatch({ control, name: `skills.${index}.items` }) ?? "";

  return (
    <li className="bg-card rounded-lg border p-3">
      <div className="flex items-end gap-1">
        <TextField
          name={`skills.${index}.category`}
          label={`Group ${index + 1} name`}
          hideLabel
          placeholder="Languages"
          className="w-32 shrink-0 sm:w-44"
        />
        <TextField
          name={`skills.${index}.items`}
          label={`Group ${index + 1} skills`}
          hideLabel
          placeholder="Python, Go, TypeScript, SQL"
          className="min-w-0 flex-1"
        />
        <div className="flex shrink-0 items-center pb-0.5">
          <MoveButtons
            index={index}
            count={count}
            subject="Skill group"
            onMove={onMove}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            aria-label={`Remove skill group ${index + 1}`}
          >
            <TrashIcon />
          </Button>
        </div>
      </div>
      <div className="mt-2 pl-0.5">
        <ParsedItems value={items} />
      </div>
    </li>
  );
}

export function SkillsSection() {
  const { control } = useFormContext<ResumeFormValues>();
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "skills",
  });
  const announce = useAnnounce();

  return (
    <FormSection
      id="skills"
      icon={WrenchIcon}
      title="Skills"
      badge={fields.length > 0 ? fields.length : undefined}
      description="Grouped, one group per line: a name on the left, the skills on the right separated by commas."
      action={
        <AddEntryButton
          label="Add group"
          onClick={() => {
            append(BLANK.skill());
            announce("Skill group added.");
          }}
          limitReached={fields.length >= MAX_ENTRIES.skills}
        />
      }
    >
      {fields.length === 0 ? (
        <SectionEmpty>
          No skill groups yet. &ldquo;Languages&rdquo;, &ldquo;Infrastructure&rdquo; and
          &ldquo;Tools&rdquo; is a reasonable start.
        </SectionEmpty>
      ) : (
        <ul className="space-y-2">
          {fields.map((field, index) => (
            <SkillRow
              key={field.id}
              index={index}
              count={fields.length}
              onMove={move}
              onRemove={() => {
                remove(index);
                announce(`Skill group ${index + 1} removed.`);
              }}
            />
          ))}
        </ul>
      )}
    </FormSection>
  );
}
