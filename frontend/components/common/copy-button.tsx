"use client";

import * as React from "react";
import { cn } from "cn";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export interface CopyButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "value" | "onClick"> {
  /** The text placed on the clipboard. */
  value: string;
  /** Visible label. Omit for an icon-only button; the aria-label still applies. */
  label?: string;
  /** Used for the aria-label and the toast: "LaTeX source copied". */
  subject?: string;
}

const RESET_AFTER_MS = 2000;

/**
 * Copy-to-clipboard with confirmation, used anywhere the app shows text the
 * user will want elsewhere: LaTeX source, compiler logs, a reset token.
 *
 * Two things that are easy to get wrong and are handled here:
 *
 *  - `navigator.clipboard` is undefined outside a secure context, and can also
 *    reject when the browser denies permission. Both paths tell the user
 *    instead of appearing to do nothing.
 *  - The confirmation is a live region, not just a swapped icon, so it is not
 *    invisible to a screen reader. The icons themselves are `aria-hidden`.
 */
export function CopyButton({
  value,
  label,
  subject = "Text",
  variant = "outline",
  size,
  className,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timeoutRef = React.useRef<number | null>(null);

  // A component unmounted inside the confirmation window (a dialog closing, a
  // row being deleted) must not leave a timer pointing at dead state.
  React.useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  async function handleCopy() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(
        () => setCopied(false),
        RESET_AFTER_MS,
      );
    } catch {
      toast.error("Could not copy to the clipboard", {
        description: "Your browser blocked it. Select the text and copy it manually.",
      });
    }
  }

  const resolvedSize = size ?? (label ? "sm" : "icon-sm");

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={resolvedSize}
        onClick={handleCopy}
        aria-label={label ? undefined : `Copy ${subject.toLowerCase()}`}
        className={cn(className)}
        {...props}
      >
        {copied ? (
          <CheckIcon
            aria-hidden="true"
            data-icon={label ? "inline-start" : undefined}
            className="text-diff-added-foreground"
          />
        ) : (
          <CopyIcon
            aria-hidden="true"
            data-icon={label ? "inline-start" : undefined}
          />
        )}
        {label ? (copied ? "Copied" : label) : null}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `${subject} copied to the clipboard` : ""}
      </span>
    </>
  );
}
