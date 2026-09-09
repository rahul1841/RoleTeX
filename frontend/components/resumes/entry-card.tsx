"use client";

import * as React from "react";
import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Reordering, announced.
 *
 * Move-up/move-down buttons rather than drag-and-drop. Drag is the obvious
 * choice and the wrong one here: it is unusable from a keyboard, awkward with
 * a screen reader, and unreliable on touch inside a scrolling form. Buttons
 * are operable by every input method, and the resume sections being reordered
 * are short lists where two clicks is not a hardship.
 *
 * Two things buttons still have to get right, and both are handled below:
 * where focus goes after the move, and telling a screen reader it happened.
 */

type Announce = (message: string) => void;

const AnnouncerContext = React.createContext<Announce>(() => {});

/**
 * One polite live region for the whole form.
 *
 * A live region per row would mean forty of them on a full resume, and moving
 * a row would race several of them. One region, updated by whichever control
 * acted, is what actually gets announced.
 */
export function ReorderAnnouncer({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = React.useState("");
  const announce = React.useCallback<Announce>((next) => {
    // Re-announce an identical message (moving the same row twice) by clearing
    // first: a live region whose text did not change says nothing.
    setMessage("");
    window.setTimeout(() => setMessage(next), 30);
  }, []);

  return (
    <AnnouncerContext value={announce}>
      {children}
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>
    </AnnouncerContext>
  );
}

export function useAnnounce(): Announce {
  return React.use(AnnouncerContext);
}

export interface MoveButtonsProps {
  /** Zero-based position of the row being moved. */
  index: number;
  /** How many rows are in the list. */
  count: number;
  /** Singular noun for the row: "Experience", "Bullet", "Link". */
  subject: string;
  onMove: (from: number, to: number) => void;
  size?: "icon-xs" | "icon-sm";
}

/**
 * Up/down controls for one row.
 *
 * FOCUS. React keeps the focused button with its row when `useFieldArray`
 * swaps two entries, because rows are keyed by the field's own id. But a row
 * that lands at the top has its Move-up button disabled, and focus on a
 * disabled element is dropped to <body> — the keyboard user is thrown back to
 * the start of the document mid-edit. So when a move will disable the button
 * that was clicked, focus is handed to its sibling first.
 */
export function MoveButtons({
  index,
  count,
  subject,
  onMove,
  size = "icon-xs",
}: MoveButtonsProps) {
  const upRef = React.useRef<HTMLButtonElement>(null);
  const downRef = React.useRef<HTMLButtonElement>(null);
  const announce = useAnnounce();

  function move(direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= count) return;
    onMove(index, to);
    announce(`${subject} moved to position ${to + 1} of ${count}.`);
    if (direction === -1 && to === 0) {
      requestAnimationFrame(() => downRef.current?.focus());
    } else if (direction === 1 && to === count - 1) {
      requestAnimationFrame(() => upRef.current?.focus());
    }
  }

  return (
    <>
      <Button
        ref={upRef}
        type="button"
        variant="ghost"
        size={size}
        disabled={index === 0}
        onClick={() => move(-1)}
        aria-label={`Move ${subject.toLowerCase()} ${index + 1} up`}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        ref={downRef}
        type="button"
        variant="ghost"
        size={size}
        disabled={index >= count - 1}
        onClick={() => move(1)}
        aria-label={`Move ${subject.toLowerCase()} ${index + 1} down`}
      >
        <ArrowDownIcon />
      </Button>
    </>
  );
}

export interface EntryCardProps {
  index: number;
  count: number;
  /** Singular noun used in every control's accessible name. */
  subject: string;
  /** The row's own heading — a job title, a project name, a group name. */
  title: React.ReactNode;
  /** Secondary line under the title. */
  meta?: React.ReactNode;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * One entry in a repeatable section.
 *
 * A `<fieldset>` with a `<legend>`, not a div: this is a group of related
 * controls, the legend is what a screen reader reads before each field inside
 * it ("Experience 2, Company"), and it is the difference between a hundred
 * unmoored text boxes and a navigable form. The legend is visually hidden
 * because the visible heading says the same thing more usefully.
 */
export function EntryCard({
  index,
  count,
  subject,
  title,
  meta,
  onMove,
  onRemove,
  children,
  className,
}: EntryCardProps) {
  const announce = useAnnounce();

  return (
    <fieldset
      className={cn(
        "bg-card relative rounded-lg border p-3 sm:p-4",
        className,
      )}
    >
      <legend className="sr-only">{`${subject} ${index + 1} of ${count}`}</legend>

      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {title || (
              <span className="text-muted-foreground italic">
                Untitled {subject.toLowerCase()}
              </span>
            )}
          </p>
          {meta ? (
            <p className="text-muted-foreground truncate text-xs">{meta}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <MoveButtons
            index={index}
            count={count}
            subject={subject}
            onMove={onMove}
            size="icon-sm"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => {
              onRemove();
              announce(`${subject} ${index + 1} removed.`);
            }}
            aria-label={`Remove ${subject.toLowerCase()} ${index + 1}`}
          >
            <TrashIcon />
          </Button>
        </div>
      </div>

      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}
