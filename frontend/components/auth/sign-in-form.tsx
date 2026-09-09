"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Spinner } from "@/components/common";
import { useLogin } from "@/hooks/use-auth";
import { AuthGate } from "./auth-gate";
import { AuthPage } from "./auth-page";
import { Field, PasswordInput, describedBy } from "./field";
import { useRegistrationStatus } from "./registration-status";
import { emailField, passwordField } from "./validation";

const signInSchema = z.object({
  email: emailField,
  password: passwordField("Enter your password"),
});

type SignInValues = z.infer<typeof signInSchema>;

/**
 * `POST /api/auth/login`.
 *
 * Every failure here is shown at form level rather than pinned to an input,
 * and that is a security decision, not a layout one. The server answers an
 * unknown address and a wrong password with the identical
 * `invalid_credentials` so that accounts cannot be enumerated; highlighting
 * the email field would hand back exactly the signal it withholds.
 *
 * <ErrorState> is doing real work for the other two failures this route has:
 * it renders 429 `too_many_attempts` with a live countdown off `Retry-After`
 * (the login throttle is per email AND per IP, so "try again" before it lifts
 * makes things worse), and it prints the status and code, which is what a
 * self-hosted user needs when the answer is really `database_unavailable`.
 */
export function SignInForm() {
  const signIn = useLogin();
  const registration = useRegistrationStatus();
  const [failure, setFailure] = React.useState<unknown>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  // `isSuccess` keeps the button busy through the navigation that follows, so
  // it cannot flick back to "Sign in" while the app is loading behind it.
  const pending = isSubmitting || signIn.isSuccess;

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await signIn.mutateAsync(values);
    } catch (error) {
      setFailure(error);
    }
  });

  return (
    <AuthGate redirectWhenAuthenticated>
      <AuthPage
        title="Sign in"
        description="Pick up your saved resumes, job descriptions and tailoring history."
        footer={
          registration.open === false ? (
            <span>
              This server is not accepting new accounts. Ask whoever runs it for
              an invitation.
            </span>
          ) : (
            <span>
              New to RoleTeX?{" "}
              <Link
                href="/register"
                className="text-foreground font-medium underline underline-offset-3"
              >
                Create an account
              </Link>
            </span>
          )
        }
      >
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {failure ? <ErrorState error={failure} title="Could not sign in" /> : null}

          <Field
            id="signin-email"
            label="Email"
            error={errors.email?.message}
          >
            <Input
              id="signin-email"
              type="email"
              autoComplete="username"
              // The first field on the first screen of the app: the caret
              // belongs here, and nothing else on the page competes for it.
              autoFocus
              spellCheck={false}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy("signin-email", {
                error: errors.email,
              })}
              {...register("email")}
            />
          </Field>

          <Field
            id="signin-password"
            label="Password"
            error={errors.password?.message}
            action={
              <Link
                href="/forgot-password"
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-3"
              >
                Forgot your password?
              </Link>
            }
          >
            <PasswordInput
              id="signin-password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={describedBy("signin-password", {
                error: errors.password,
              })}
              {...register("password")}
            />
          </Field>

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Sign in
          </Button>
        </form>
      </AuthPage>
    </AuthGate>
  );
}
