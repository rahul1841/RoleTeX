"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LinkIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState, Spinner } from "@/components/common";
import { useResetPassword } from "@/hooks/use-auth";
import { AuthGate } from "./auth-gate";
import { AuthPage, AuthStatus, InlineCode } from "./auth-page";
import { Field, PasswordInput, describedBy } from "./field";
import { apiErrorCode, applyApiFieldError } from "./form-errors";
import { useFragmentToken } from "./use-fragment-token";
import { passwordField } from "./validation";

const resetSchema = z.object({
  password: passwordField("Choose a new password"),
});

type ResetValues = z.infer<typeof resetSchema>;

const FIELD_FOR_CODE = { weak_password: "password" } as const;

/**
 * `POST /api/auth/password/reset`.
 *
 * The token comes from the URL FRAGMENT and is never read from
 * `useSearchParams()` — see token-link.ts for why that distinction is the
 * whole point of this flow.
 *
 * No `redirectWhenAuthenticated` on the gate: someone signed in on this
 * browser may well be the person who asked for the link, and bouncing them to
 * the app would strand a token they cannot use anywhere else. The server
 * revokes every session on success anyway, so they end up signed out and back
 * at /sign-in either way — which `useResetPassword` handles.
 */
export function ResetPasswordForm() {
  const token = useFragmentToken();
  const reset = useResetPassword();
  const [failure, setFailure] = React.useState<unknown>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "" },
  });

  const pending = isSubmitting || reset.isSuccess;
  const linkIsDead = apiErrorCode(failure) === "invalid_token";

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return;
    setFailure(null);
    try {
      await reset.mutateAsync({ token, new_password: values.password });
    } catch (error) {
      if (!applyApiFieldError(error, setError, FIELD_FOR_CODE)) {
        setFailure(error);
      }
    }
  });

  const requestAnother = (
    <Button render={<Link href="/forgot-password" />} size="sm">
      Request a new link
    </Button>
  );

  // The fragment has not been read yet. One frame, and holding still beats
  // telling someone with a perfectly good link that it is broken.
  if (token === undefined) {
    return (
      <div
        role="status"
        className="text-muted-foreground flex items-center justify-center gap-2.5 py-8 text-sm"
      >
        <Spinner />
        <span>Opening your reset link…</span>
      </div>
    );
  }

  if (token === null) {
    return (
      <AuthGate>
        <AuthPage
          title="This link is incomplete"
          description="The address you opened has no reset token in it."
        >
          <AuthStatus tone="warning" icon={LinkIcon} actions={requestAnother}>
            <p>
              Mail clients sometimes shorten or rewrite links, and the part that
              proves the request is yours travels after the{" "}
              <InlineCode>#</InlineCode>. Copy the whole address from the email,
              or ask for a fresh link.
            </p>
          </AuthStatus>
        </AuthPage>
      </AuthGate>
    );
  }

  if (linkIsDead) {
    return (
      <AuthGate>
        <AuthPage
          title="This link no longer works"
          description="Reset links can be used once, and they expire."
        >
          <AuthStatus
            tone="warning"
            icon={TriangleAlertIcon}
            actions={requestAnother}
          >
            <p>
              It has either already been used, expired, or been cancelled by a
              newer request. Your password has not changed.
            </p>
          </AuthStatus>
        </AuthPage>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <AuthPage
        title="Choose a new password"
        description="Signing in everywhere else will stop working — that is the point of a reset."
        footer={
          <span>
            Changed your mind?{" "}
            <Link
              href="/sign-in"
              className="text-foreground font-medium underline underline-offset-3"
            >
              Back to sign in
            </Link>
          </span>
        }
      >
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {failure ? (
            <ErrorState error={failure} title="Could not reset your password" />
          ) : null}

          <Field
            id="reset-password"
            label="New password"
            error={errors.password?.message}
            hint="Long and unique beats clever. The server will say if it is not strong enough."
          >
            <PasswordInput
              id="reset-password"
              autoComplete="new-password"
              autoFocus
              aria-invalid={Boolean(errors.password)}
              aria-describedby={describedBy("reset-password", {
                error: errors.password,
                hint: true,
              })}
              {...register("password")}
            />
          </Field>

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Set new password
          </Button>
        </form>
      </AuthPage>
    </AuthGate>
  );
}
