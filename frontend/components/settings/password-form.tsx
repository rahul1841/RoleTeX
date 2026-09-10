"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Spinner } from "@/components/common";
import { isApiError } from "@/lib/api/errors";
import { useChangePassword } from "@/hooks/use-account";
import { SecretInput, SettingsField, describedBy } from "./field";

/**
 * Only "you left this blank" is checked here.
 *
 * backend/app/security.py owns the password policy and reports a violation as
 * `weak_password` with a message written for a human ("Password must be at
 * least 8 characters"). Restating the rules here would create a second copy
 * that drifts the day the server's minimum changes and, worse, could reject a
 * password the server would have accepted.
 */
const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(1, "Enter a new password"),
});

type PasswordValues = z.infer<typeof passwordSchema>;

/**
 * `POST /api/auth/password`.
 *
 * The consequence stated up front rather than in a toast afterwards: the
 * server treats a password change as a response to suspected compromise and
 * destroys every other session for the account, plus any outstanding reset
 * links. That is the correct behaviour and it is also surprising, so it is
 * said before the button, not after.
 *
 * Field-level routing follows the server's own codes. `invalid_credentials`
 * belongs to the current-password input (unlike sign-in, there is no account to
 * enumerate — the session already proves who this is), `weak_password` and
 * `password_unchanged` belong to the new one, and anything else is a
 * whole-request failure that <ErrorState> renders with its status and code.
 */
export function PasswordForm() {
  const changePassword = useChangePassword();
  const [failure, setFailure] = React.useState<unknown>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await changePassword.mutateAsync({
        current_password: values.currentPassword,
        new_password: values.newPassword,
      });
      reset({ currentPassword: "", newPassword: "" });
      toast.success("Password changed", {
        description: "Every other signed-in session has been revoked.",
      });
    } catch (error) {
      if (isApiError(error)) {
        if (error.code === "invalid_credentials") {
          setError(
            "currentPassword",
            { type: "server", message: error.message },
            { shouldFocus: true },
          );
          return;
        }
        if (
          error.code === "weak_password" ||
          error.code === "password_unchanged"
        ) {
          setError(
            "newPassword",
            { type: "server", message: error.message },
            { shouldFocus: true },
          );
          return;
        }
      }
      setFailure(error);
    }
  });

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <SettingsField
        id="current-password"
        label="Current password"
        error={errors.currentPassword?.message}
      >
        <SecretInput
          {...register("currentPassword")}
          id="current-password"
          autoComplete="current-password"
          aria-invalid={errors.currentPassword ? true : undefined}
          aria-describedby={describedBy("current-password", {
            error: errors.currentPassword,
          })}
        />
      </SettingsField>

      <SettingsField
        id="new-password"
        label="New password"
        error={errors.newPassword?.message}
        hint="Changing it signs out every other device immediately."
      >
        <SecretInput
          {...register("newPassword")}
          id="new-password"
          autoComplete="new-password"
          aria-invalid={errors.newPassword ? true : undefined}
          aria-describedby={describedBy("new-password", {
            error: errors.newPassword,
            hint: true,
          })}
        />
      </SettingsField>

      {failure ? (
        <ErrorState error={failure} title="Could not change your password" />
      ) : null}

      <Button type="submit" size="sm" disabled={isSubmitting}>
        {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
        Change password
      </Button>
    </form>
  );
}
