"use client";

import * as React from "react";
import { TriangleAlertIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "./loading-state";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** Say what will happen and whether it can be undone. */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * May return a promise. The dialog stays open and busy until it settles, and
   * closes only if it resolves — see the note on error handling below.
   */
  onConfirm: () => void | Promise<unknown>;
  /** Red confirm button and a warning glyph. Default true; these are deletes. */
  destructive?: boolean;
  /** Drive the busy state from a mutation instead of the internal promise. */
  pending?: boolean;
  /** Extra content between the description and the buttons. */
  children?: React.ReactNode;
}

/**
 * The confirmation step in front of anything irreversible: deleting a resume, a
 * job description, a run, or the account itself.
 *
 * Built on alert-dialog rather than dialog because that is the role for a
 * decision the user must make before continuing — it traps focus, starts focus
 * on the dialog, and cannot be dismissed by clicking the backdrop.
 *
 * ERROR HANDLING CONTRACT: if `onConfirm` rejects, the dialog stays open and
 * this component reports nothing. That is deliberate — the caller owns the
 * mutation and is the only thing that can say *what* failed, usually with a
 * toast or an <ErrorState> on the page behind. It must not be silent.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  destructive = true,
  pending,
  children,
}: ConfirmDialogProps) {
  const [confirming, setConfirming] = React.useState(false);
  const busy = pending || confirming;

  async function handleConfirm() {
    try {
      setConfirming(true);
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Intentionally swallowed here; see the contract above.
    } finally {
      setConfirming(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      // Escape and the Cancel button both route through here. While the action
      // is in flight the dialog refuses to close, so the user cannot lose the
      // busy state and fire the same delete twice.
      onOpenChange={(next) => {
        if (busy && !next) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          {destructive ? (
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <TriangleAlertIcon aria-hidden="true" />
            </AlertDialogMedia>
          ) : null}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>

        {children}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={handleConfirm}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
