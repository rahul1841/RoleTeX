"use client";

import * as React from "react";
import { cn } from "cn";
import { ListChecksIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/common";
import type { ResumeChange } from "@/lib/api/types";
import { describeFieldId } from "./field-id";
import { wordDiff, type DiffSpan } from "./word-diff";

/**
 * The reviewable change list — the screen rules.md R-14 is about.
 *
 * Every edit the model proposed is shown as a before/after pair, in the
 * `diff-removed` / `diff-added` tokens, with the words that actually moved
 * emphasised inside the line. Nothing here is hidden behind a tab or a
 * disclosure: the list renders in full, next to the compiled PDF, always.
 *
 * The per-change "Reviewed" checkbox is a READING AID and nothing else. It is
 * local, unsaved, and gates nothing — a twenty-change run is hard to track by
 * eye, and losing your place is the failure mode this prevents. It is
 * deliberately not a gate on downloading: an artificial lock would train
 * people to click through it, which is the opposite of reviewing.
 */

export interface ChangeListProps {
  changes: ResumeChange[];
  /** Whether a PDF was compiled, which decides how the framing line reads. */
  compiled: boolean;
  className?: string;
}

export function ChangeList({ changes, compiled, className }: ChangeListProps) {
  const [reviewed, setReviewed] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // A new run is a new review. Resetting during render (rather than in an
  // effect) means the counter is never briefly wrong for the new result.
  const [seen, setSeen] = React.useState(changes);
  if (seen !== changes) {
    setSeen(changes);
    setReviewed(new Set());
  }

  const toggle = React.useCallback((fieldId: string, checked: boolean) => {
    setReviewed((current) => {
      const next = new Set(current);
      if (checked) next.add(fieldId);
      else next.delete(fieldId);
      return next;
    });
  }, []);

  const allReviewed = changes.length > 0 && reviewed.size === changes.length;

  if (changes.length === 0) {
    return (
      <section aria-labelledby="changes-heading" className={className}>
        <h2 id="changes-heading" className="font-heading text-sm font-medium">
          Proposed changes
        </h2>
        <EmptyState
          className="mt-3"
          icon={ListChecksIcon}
          title="The model proposed no changes"
          description="It read the job description and left your resume as it is. That is a real answer, not a failure — try a more specific job description, or a different model."
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="changes-heading" className={className}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="changes-heading" className="font-heading text-sm font-medium">
          Proposed changes
        </h2>
        <Badge variant="secondary" className="tabular-nums">
          {changes.length}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <span
            aria-live="polite"
            className="text-muted-foreground text-xs tabular-nums"
          >
            {reviewed.size} of {changes.length} reviewed
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() =>
              setReviewed(
                allReviewed
                  ? new Set()
                  : new Set(changes.map((change) => change.field_id)),
              )
            }
          >
            {allReviewed ? "Clear" : "Mark all"}
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground mt-1.5 text-xs text-pretty">
        {compiled
          ? "The PDF alongside was compiled with all of these applied. Your saved resume is untouched — nothing is written back."
          : "These are the edits the model proposed. No PDF was compiled and your saved resume is untouched."}
      </p>

      <ul className="mt-3 space-y-2.5">
        {changes.map((change) => (
          <ChangeCard
            key={change.field_id}
            change={change}
            reviewed={reviewed.has(change.field_id)}
            onReviewedChange={(checked) => toggle(change.field_id, checked)}
          />
        ))}
      </ul>
    </section>
  );
}

const KIND_LABEL = {
  summary: "Headline",
  skills: "Reordered",
  bullet: "Rewritten",
  other: "Edited",
} as const;

function ChangeCard({
  change,
  reviewed,
  onReviewedChange,
}: {
  change: ResumeChange;
  reviewed: boolean;
  onReviewedChange: (checked: boolean) => void;
}) {
  const location = describeFieldId(change.field_id);
  const spans = React.useMemo(
    () => wordDiff(change.before, change.after),
    [change.before, change.after],
  );
  const checkboxId = `reviewed-${change.field_id}`;

  return (
    <li
      className={cn(
        "bg-card overflow-hidden rounded-xl ring-1 transition-opacity",
        reviewed ? "ring-border/60 opacity-70" : "ring-foreground/10",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Checkbox
          id={checkboxId}
          checked={reviewed}
          onCheckedChange={(checked) => onReviewedChange(checked)}
          aria-label={`Mark ${location.section}${location.detail ? ` ${location.detail}` : ""} as reviewed`}
        />
        <label
          htmlFor={checkboxId}
          className="min-w-0 cursor-pointer text-sm font-medium"
        >
          {location.section}
          {location.detail ? (
            <span className="text-muted-foreground font-normal">
              {" · "}
              {location.detail}
            </span>
          ) : null}
        </label>
        <Badge variant="outline" className="ml-auto shrink-0">
          {KIND_LABEL[location.kind]}
        </Badge>
        <code className="text-muted-foreground/70 hidden shrink-0 text-[0.7rem] sm:inline">
          {change.field_id}
        </code>
      </div>

      <div className="space-y-1 px-3 pb-3">
        <ChangeLine
          tone="removed"
          label="Before"
          text={change.before}
          spans={spans?.before}
        />
        <ChangeLine
          tone="added"
          label="After"
          text={change.after}
          spans={spans?.after}
        />
      </div>
    </li>
  );
}

const TONES = {
  removed: {
    row: "bg-diff-removed text-diff-removed-foreground border-diff-removed-border",
    mark: "bg-diff-removed-border/60",
    sign: "−",
  },
  added: {
    row: "bg-diff-added text-diff-added-foreground border-diff-added-border",
    mark: "bg-diff-added-border/60",
    sign: "+",
  },
} as const;

function ChangeLine({
  tone,
  label,
  text,
  spans,
}: {
  tone: keyof typeof TONES;
  label: string;
  text: string;
  spans: DiffSpan[] | undefined;
}) {
  const style = TONES[tone];

  return (
    <div
      className={cn(
        "grid grid-cols-[1.15rem_1fr] items-start gap-x-1 rounded-md border-l-2 py-1.5 pr-2.5 text-sm",
        style.row,
      )}
    >
      <span
        aria-hidden="true"
        className="text-center font-mono leading-6 opacity-60 select-none"
      >
        {style.sign}
      </span>
      <p className="leading-6 text-pretty">
        <span className="sr-only">{label}: </span>
        {spans
          ? spans.map((span, index) =>
              span.changed ? (
                <mark
                  key={index}
                  className={cn(
                    "rounded-[3px] bg-transparent text-inherit",
                    style.mark,
                  )}
                >
                  {span.text}
                </mark>
              ) : (
                <React.Fragment key={index}>{span.text}</React.Fragment>
              ),
            )
          : text}
      </p>
    </div>
  );
}
