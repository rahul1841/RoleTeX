"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailCheckIcon } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Spinner } from "@/components/common";
import { useForgotPassword } from "@/hooks/use-auth";
import { AuthGate } from "./auth-gate";
import { AuthPage, AuthStatus } from "./auth-page";
import { Field, describedBy } from "./field";
import { applyApiFieldError } from "./form-errors";
import { emailField } from "./validation";

const forgotSchema = z.object({ email: emailField });

type ForgotValues = z.infer<typeof forgotSchema>;

const FIELD_FOR_CODE = { invalid_email: "email" } as const;

/**
 * `POST /api/auth/password/forgot`.
 *
 * A PAGE, not a dialog on the sign-in card, for three reasons. It is a
 * destination the app needs to link TO — an expired reset link sends people
 * here, and so does the "request a new one" action on /reset-password, neither
 * of which can open a modal that lives inside another route. Its result is a
 * paragraph the user has to read and act on in their mail client, and a modal
 * is the one container people dismiss reflexively. And it is a task someone
 * arrives at already decided about, so making them open sign-in first to reach
 * it adds a step to the flow that is already the worst day of their week.
 *
 * THE COPY IS PART OF THE SECURITY MODEL. `app/routes_account.py` returns a
 * byte-identical response whether or not the address has an account, precisely
 * so the endpoint cannot be used to test whether someone is a user. So the
 * confirmation says "if there is an account" and never "we sent you an email".
 *
 * `delivered` is the one thing the response does report, and it is about the
 * SERVER, not the address: false means no SMTP transport is configured and the
 * link went to the server's own log instead of anyone's inbox. Hiding that
 * would leave a self-hosted user waiting for mail that is never coming.
 */
export function ForgotPasswordForm() {
  const requestReset = useForgotPassword();
  const [sent, setSent] = React.useState<{
    email: string;
    delivered: boolean;
  } | null>(null);
  const [failure, setFailure] = React.useState<unknown>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      const response = await requestReset.mutateAsync({ email: values.email });
      setSent({ email: values.email, delivered: response.delivered });
    } catch (error) {
      if (!applyApiFieldError(error, setError, FIELD_FOR_CODE)) {
        setFailure(error);
      }
    }
  });

  const backToSignIn = (
    <span>
      Remembered it?{" "}
      <Link
        href="/sign-in"
        className="text-foreground font-medium underline underline-offset-3"
      >
        Back to sign in
      </Link>
    </span>
  );

  if (sent) {
    return (
      <AuthGate redirectWhenAuthenticated>
        <AuthPage title="Check your email" footer={backToSignIn}>
          <AuthStatus
            tone="success"
            icon={MailCheckIcon}
            actions={
              <>
                <ButtonLink href="/sign-in" size="sm">
                  Back to sign in
                </ButtonLink>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSent(null)}
                >
                  Use a different address
                </Button>
              </>
            }
          >
            <p>
              If <span className="font-medium">{sent.email}</span> has a RoleTeX
              account, a reset link is on its way. It works once and expires
              shortly, so open it soon.
            </p>
            {sent.delivered ? null : (
              <p className="text-warning-foreground">
                This server has no mail transport configured, so nothing was
                actually delivered — the link was written to the server log
                instead. Whoever runs this deployment can read it from there.
              </p>
            )}
          </AuthStatus>
        </AuthPage>
      </AuthGate>
    );
  }

  return (
    <AuthGate redirectWhenAuthenticated>
      <AuthPage
        title="Reset your password"
        description="Enter the address on your account and we will send a link that lets you choose a new password."
        footer={backToSignIn}
      >
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {failure ? (
            <ErrorState error={failure} title="Could not send the link" />
          ) : null}

          <Field id="forgot-email" label="Email" error={errors.email?.message}>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="username"
              autoFocus
              spellCheck={false}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy("forgot-email", {
                error: errors.email,
              })}
              {...register("email")}
            />
          </Field>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            Send reset link
          </Button>
        </form>
      </AuthPage>
    </AuthGate>
  );
}
