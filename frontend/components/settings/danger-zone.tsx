"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, ErrorState } from "@/components/common";
import { isApiError } from "@/lib/api/errors";
import { useSession } from "@/hooks/use-session";
import { useDeleteAccount } from "@/hooks/use-account";
import { SecretInput, SettingsField, describedBy } from "./field";

/**
 * Account deletion.
 *
 * `DELETE /api/me` takes a BODY — `DeleteMeRequest { password }` — which is
 * why `lib/api/client.ts` gives DELETE a body parameter at all. The server
 * verifies the password before it touches anything, and then removes the
 * sessions, the auth tokens, the stored API keys, the resumes, the job
 * descriptions, the runs and the user document, in that order, and clears the
 * session cookie in the response.
 *
 * Two independent confirmations guard it, because they fail in different ways:
 * the password proves it is really this person (and is the server's own check),
 * while typing the address proves they know which account they are deleting.
 * A password manager can supply the first without the human reading a word;
 * only the second forces them to look at the identity on screen.
 */
export function DangerZone() {
  const { user } = useSession();
  const [open, setOpen] = React.useState(false);
  // Bumped on every opening so the dialog remounts with empty fields. Keyed on
  // `open` instead would also remount on CLOSE, which would tear the dialog off
  // the screen mid-animation.
  const [opening, setOpening] = React.useState(0);

  if (!user) return null;

  return (
    <div className="border-destructive/30 bg-destructive/5 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-xl space-y-1">
          <h3 className="text-destructive text-sm font-medium">
            Delete this account
          </h3>
          <p className="text-foreground/80 text-sm text-pretty">
            Permanently removes your resumes and their version history, your
            saved job descriptions, every tailoring run and its compiled PDF,
            and every API key you have stored. Nothing is archived and nothing
            can be restored.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setOpening((count) => count + 1);
            setOpen(true);
          }}
        >
          <Trash2Icon data-icon="inline-start" aria-hidden="true" />
          Delete account
        </Button>
      </div>

      <DeleteAccountDialog
        // Remounted per opening so a half-typed password never survives a
        // cancel and sits in memory behind a closed dialog.
        key={opening}
        open={open}
        onOpenChange={setOpen}
        email={user.email}
      />
    </div>
  );
}

function DeleteAccountDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
}) {
  const deleteAccount = useDeleteAccount();
  const [failure, setFailure] = React.useState<unknown>(null);

  const schema = React.useMemo(
    () =>
      z.object({
        confirmation: z
          .string()
          .trim()
          .refine(
            (value) => value.toLowerCase() === email.trim().toLowerCase(),
            { message: `Type ${email} exactly to confirm.` },
          ),
        password: z.string().min(1, "Enter your password"),
      }),
    [email],
  );

  type DeleteValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DeleteValues>({
    resolver: zodResolver(schema),
    defaultValues: { confirmation: "", password: "" },
  });

  /**
   * Runs validation, then the delete, and reports whether the dialog may close.
   *
   * <ConfirmDialog> closes only when `onConfirm` resolves and stays open —
   * silently — when it rejects, so this throws for both failure modes and owns
   * the explanation for each: a field error for the two the server pins to an
   * input, an <ErrorState> inside the dialog for everything else.
   */
  async function attemptDelete() {
    setFailure(null);
    let deleted = false;

    // react-hook-form focuses the first invalid field itself, so a submit that
    // fails validation lands the caret in the same place a client-side error
    // would.
    await handleSubmit(async (values) => {
      try {
        await deleteAccount.mutateAsync({ password: values.password });
        deleted = true;
      } catch (error) {
        if (isApiError(error) && error.code === "invalid_credentials") {
          setError(
            "password",
            { type: "server", message: error.message },
            { shouldFocus: true },
          );
          return;
        }
        setFailure(error);
      }
    })();

    if (!deleted) {
      throw new Error("Account deletion did not complete");
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete your account?"
      description="This cannot be undone. Everything stored for this account is deleted immediately, including your encrypted provider keys."
      confirmLabel="Delete my account"
      cancelLabel="Keep my account"
      pending={deleteAccount.isPending}
      onConfirm={attemptDelete}
    >
      <div className="space-y-4 text-left">
        <SettingsField
          id="delete-confirmation"
          label={
            <>
              Type{" "}
              <span className="text-code-foreground bg-code border-code-border rounded border px-1 py-px font-mono text-xs">
                {email}
              </span>{" "}
              to confirm
            </>
          }
          error={errors.confirmation?.message}
        >
          <Input
            {...register("confirmation")}
            id="delete-confirmation"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            aria-invalid={errors.confirmation ? true : undefined}
            aria-describedby={describedBy("delete-confirmation", {
              error: errors.confirmation,
            })}
          />
        </SettingsField>

        <SettingsField
          id="delete-password"
          label="Your password"
          error={errors.password?.message}
        >
          <SecretInput
            {...register("password")}
            id="delete-password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={describedBy("delete-password", {
              error: errors.password,
            })}
          />
        </SettingsField>

        {failure ? (
          <ErrorState error={failure} title="Could not delete your account" />
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
