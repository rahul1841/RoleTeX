"use client";

import { LinkIcon, TrashIcon, UserIcon } from "lucide-react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { MoveButtons, useAnnounce } from "../entry-card";
import { CharacterCount, TextAreaField, TextField } from "../fields";
import {
  BLANK,
  LIMITS,
  MAX_ENTRIES,
  type ResumeFormValues,
} from "../resume-form";
import { AddEntryButton, FormSection } from "./section-frame";

/**
 * Name, contact line, and the links that render under it.
 *
 * Name and email are the only two fields in the whole builder that are
 * unconditionally required — `_validate_identity` in app/builder.py — so they
 * are the only ones marked required here. Everything else on a resume is
 * optional until you start filling it in.
 */
export function IdentitySection() {
  const { control } = useFormContext<ResumeFormValues>();
  const links = useFieldArray({ control, name: "identity.links" });
  const announce = useAnnounce();

  return (
    <FormSection
      id="identity"
      icon={UserIcon}
      title="You"
      description="The contact block at the top of the page. Name and email are required; the rest appears only if you fill it in."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="identity.name"
          label="Full name"
          placeholder="Ada Lovelace"
          autoComplete="name"
        />
        <TextField
          name="identity.email"
          label="Email"
          type="email"
          inputMode="email"
          placeholder="ada@example.com"
          autoComplete="email"
        />
        <TextField
          name="identity.phone"
          label="Phone"
          type="tel"
          inputMode="tel"
          placeholder="+1 555 0100"
          autoComplete="tel"
        />
        <TextField
          name="identity.location"
          label="Location"
          placeholder="London, UK"
          autoComplete="address-level2"
        />
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <LinkIcon aria-hidden="true" className="size-3" />
            Links
          </span>
          <AddEntryButton
            label="Add link"
            onClick={() => {
              links.append(BLANK.link());
              announce("Link added.");
            }}
            limitReached={links.fields.length >= MAX_ENTRIES.links}
          />
        </div>

        {links.fields.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            GitHub, a portfolio, LinkedIn — each becomes a clickable label in
            the PDF, so the address itself never has to be printed.
          </p>
        ) : (
          <ul className="space-y-2">
            {links.fields.map((field, index) => (
              <li key={field.id} className="flex items-end gap-1">
                <TextField
                  name={`identity.links.${index}.label`}
                  label={`Link ${index + 1} label`}
                  hideLabel
                  placeholder="GitHub"
                  className="w-32 shrink-0 sm:w-40"
                />
                <TextField
                  name={`identity.links.${index}.url`}
                  label={`Link ${index + 1} address`}
                  hideLabel
                  type="url"
                  inputMode="url"
                  placeholder="https://github.com/ada"
                  className="min-w-0 flex-1"
                />
                <div className="flex shrink-0 items-center pb-0.5">
                  <MoveButtons
                    index={index}
                    count={links.fields.length}
                    subject="Link"
                    onMove={links.move}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      links.remove(index);
                      announce(`Link ${index + 1} removed.`);
                    }}
                    aria-label={`Remove link ${index + 1}`}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <TextAreaField
          name="summary"
          label="Headline"
          rows={2}
          placeholder="Backend engineer — distributed systems, Python, Go"
          hint={`One line under your name. At most ${LIMITS.summaryWords} words.`}
          action={<CharacterCount name="summary" max={LIMITS.summaryChars} />}
        />
      </div>
    </FormSection>
  );
}
