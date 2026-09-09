"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Spinner } from "@/components/common";
import { useRegister } from "@/hooks/use-auth";
import { AuthGate } from "./auth-gate";
import { AuthPage, AuthStatus, InlineCode } from "./auth-page";
import { Field, PasswordInput, describedBy } from "./field";
import { apiErrorCode, applyApiFieldError } from "./form-errors";
import { useRegistrationStatus } from "./registration-status";
import { emailField, nameField, passwordField } from "./validation";

const registerSchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField("Choose a password"),
});

type RegisterValues = z.infer<typeof registerSchema>;

/** Server codes this form can point at a specific input. */
const FIELD_FOR_CODE = {
  invalid_email: "email",
  email_taken: "email",
  weak_password: "password",
} as const;

/**
 * `POST /api/auth/register`.
 *
 * The server opens a session on success, so a new account lands straight in
 * the app rather than being asked to sign in with credentials it just chose.
 *
 * Two things this form does NOT do:
 *
 *  - It does not ask for the password twice. The reveal toggle on <PasswordInput>
 *    catches the typo a confirmation field is there to catch, and does it while
 *    the user can still see what they typed.
 *  - It does not state the password policy. `app/security.py` owns the rule and
 *    returns `weak_password` with its own message ("Password must be at least 8
 *    characters"), which is attached to the field. A hard-coded "8 characters"
 *    here would be a second copy of a rule the operator can change.
 */
export function RegisterForm() {
  const createAccount = useRegister();
  const registration = useRegistrationStatus();
  const [failure, setFailure] = React.useState<unknown>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const pending = isSubmitting || createAccount.isSuccess;

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await createAccount.mutateAsync({
        email: values.email,
        password: values.password,
        // The field is optional to the person filling it in, but the request
        // model requires the key (Pydantic `extra="forbid"`, `name` defaults
        // to ""), so it is always sent.
        name: values.name ?? "",
      });
    } catch (error) {
      if (apiErrorCode(error) === "registration_disabled") {
        // Remembered by the (auth) layout, so /sign-in stops advertising an
        // account this server will never create.
        registration.markDisabled();
        return;
      }
      if (!applyApiFieldError(error, setError, FIELD_FOR_CODE)) {
        setFailure(error);
      }
    }
  });

  if (registration.open === false) {
    return (
      <AuthGate redirectWhenAuthenticated>
        <AuthPage
          title="Registration is closed"
          description="This RoleTeX server is not accepting new accounts."
          footer={
            <span>
              Already have an account?{" "}
              <Link
                href="/sign-in"
                className="text-foreground font-medium underline underline-offset-3"
              >
                Sign in
              </Link>
            </span>
          }
        >
          <AuthStatus tone="info" icon={LockIcon}>
            <p>
              The operator has set{" "}
              <InlineCode>ALLOW_REGISTRATION=false</InlineCode>, so accounts can
              only be created by whoever runs this deployment.
            </p>
            <p>
              If you should have access, ask them to create an account for you
              or to turn registration back on.
            </p>
          </AuthStatus>
        </AuthPage>
      </AuthGate>
    );
  }

  return (
    <AuthGate redirectWhenAuthenticated>
      <AuthPage
        title="Create your account"
        description="One account holds your resumes, job descriptions and every tailoring run."
        footer={
          <span>
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="text-foreground font-medium underline underline-offset-3"
            >
              Sign in
            </Link>
          </span>
        }
      >
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {failure ? (
            <ErrorState error={failure} title="Could not create your account" />
          ) : null}

          <Field
            id="register-name"
            label="Name"
            error={errors.name?.message}
            hint="Optional. Shown in the app; not used on your resume."
          >
            <Input
              id="register-name"
              autoComplete="name"
              autoFocus
              aria-invalid={Boolean(errors.name)}
              aria-describedby={describedBy("register-name", {
                error: errors.name,
                hint: true,
              })}
              {...register("name")}
            />
          </Field>

          <Field id="register-email" label="Email" error={errors.email?.message}>
            <Input
              id="register-email"
              type="email"
              autoComplete="username"
              spellCheck={false}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy("register-email", {
                error: errors.email,
              })}
              {...register("email")}
            />
          </Field>

          <Field
            id="register-password"
            label="Password"
            error={errors.password?.message}
            hint="Long and unique beats clever. The server will say if it is not strong enough."
          >
            <PasswordInput
              id="register-password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={describedBy("register-password", {
                error: errors.password,
                hint: true,
              })}
              {...register("password")}
            />
          </Field>

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Create account
          </Button>
        </form>
      </AuthPage>
    </AuthGate>
  );
}
