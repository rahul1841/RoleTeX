"use client";

import * as React from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeftIcon, LockIcon, MailCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Spinner } from "@/components/common";
import { useRegister, useRequestSignupCode } from "@/hooks/use-auth";
import { AuthGate } from "./auth-gate";
import { AuthPage, AuthStatus, InlineCode } from "./auth-page";
import { Field, PasswordInput, describedBy } from "./field";
import { apiErrorCode, applyApiFieldError } from "./form-errors";
import { PasswordChecklist, newPasswordField } from "./password-rules";
import { useRegistrationStatus } from "./registration-status";
import { emailField, nameField } from "./validation";

const registerSchema = z.object({
  name: nameField,
  email: emailField,
  password: newPasswordField("Choose a password"),
  // Checked by hand on the code step: it is empty and irrelevant on the first.
  code: z.string(),
});

type RegisterValues = z.infer<typeof registerSchema>;

/** Server codes that belong to a field on the DETAILS step. */
const DETAILS_FIELD_FOR_CODE = {
  invalid_email: "email",
  email_taken: "email",
  weak_password: "password",
} as const;

/** Server codes that belong to the code input on the CODE step. */
const CODE_FIELD_FOR_CODE = {
  invalid_code: "code",
  code_required: "code",
} as const;

/** Seconds before "Resend code" is offered again. */
const RESEND_AFTER_SECONDS = 60;

const CODE_PATTERN = /^[0-9]{6}$/;

type Step = "details" | "code";

/**
 * Creating an account: `POST /api/auth/register/code`, then
 * `POST /api/auth/register` with the code it mailed. Always both — the server
 * refuses an account without a valid code.
 *
 * Two steps on one form. The details step collects name, email and password
 * and checks the password against the live checklist; submitting it mails a
 * six-digit code. The code step takes that code and sends everything together.
 * Nothing is created until the code is right, so an abandoned sign-up leaves no
 * account behind, and the account that is created starts verified.
 *
 * Going back from the code step keeps every value, and a server rejection is
 * routed to the step that can fix it: a wrong code stays on the code step, a
 * weak password sends the user back to the password.
 *
 * It does not ask for the password twice. The reveal toggle on <PasswordInput>
 * catches the typo a confirmation field is there to catch, and does it while
 * the user can still see what they typed.
 */
export function RegisterForm() {
  const createAccount = useRegister();
  const sendCode = useRequestSignupCode();
  const registration = useRegistrationStatus();

  const [step, setStep] = React.useState<Step>("details");
  const [failure, setFailure] = React.useState<unknown>(null);
  const [sentTo, setSentTo] = React.useState("");
  const [delivered, setDelivered] = React.useState(true);
  const [resendIn, setResendIn] = React.useState(0);

  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", code: "" },
  });

  const password = useWatch({ control, name: "password" });

  React.useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const pending = isSubmitting || sendCode.isPending || createAccount.isSuccess;

  function handleFailure(error: unknown) {
    if (apiErrorCode(error) === "registration_disabled") {
      // Remembered by the (auth) layout, so /sign-in stops advertising an
      // account this server will never create.
      registration.markDisabled();
      return;
    }
    if (step === "code" && applyApiFieldError(error, setError, CODE_FIELD_FOR_CODE)) {
      return;
    }
    const code = apiErrorCode(error);
    if (code && code in DETAILS_FIELD_FOR_CODE) {
      // Only the details step can fix these; take the user back to it.
      setStep("details");
      requestAnimationFrame(() => {
        applyApiFieldError(error, setError, DETAILS_FIELD_FOR_CODE);
      });
      return;
    }
    setFailure(error);
  }

  async function requestCode(email: string): Promise<boolean> {
    try {
      const response = await sendCode.mutateAsync({ email });
      setSentTo(email.trim());
      setDelivered(response.delivered);
      setResendIn(RESEND_AFTER_SECONDS);
      return true;
    } catch (error) {
      handleFailure(error);
      return false;
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);

    if (step === "details") {
      if (await requestCode(values.email)) {
        setValue("code", "");
        clearErrors("code");
        setStep("code");
      }
      return;
    }

    const code = values.code.trim();
    if (!CODE_PATTERN.test(code)) {
      setError("code", { type: "manual", message: "Enter the 6-digit code from the email" }, { shouldFocus: true });
      return;
    }

    try {
      await createAccount.mutateAsync({
        email: values.email,
        password: values.password,
        // The field is optional to the person filling it in, but the request
        // model requires the key (Pydantic `extra="forbid"`, `name` defaults
        // to ""), so it is always sent.
        name: values.name ?? "",
        code,
      });
    } catch (error) {
      handleFailure(error);
    }
  });

  const footer = (
    <span>
      Already have an account?{" "}
      <Link
        href="/sign-in"
        className="text-foreground font-medium underline underline-offset-3"
      >
        Sign in
      </Link>
    </span>
  );

  if (registration.open === false) {
    return (
      <AuthGate redirectWhenAuthenticated>
        <AuthPage
          title="Registration is closed"
          description="This RoleTeX server is not accepting new accounts."
          footer={footer}
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

  if (step === "code") {
    const codeField = register("code");
    return (
      <AuthGate redirectWhenAuthenticated>
        <AuthPage
          title="Check your email"
          description={
            <>
              We sent a 6-digit code to{" "}
              <span className="text-foreground font-medium break-all">{sentTo}</span>.
              Enter it to create your account.
            </>
          }
          footer={footer}
        >
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {failure ? (
              <ErrorState error={failure} title="Could not create your account" />
            ) : null}

            {!delivered ? (
              <AuthStatus tone="info" icon={MailCheckIcon}>
                <p>
                  This server has no mail transport configured, so the code was
                  written to the server log instead of sent. Whoever runs it can
                  read it there.
                </p>
              </AuthStatus>
            ) : null}

            <Field
              id="register-code"
              label="Verification code"
              error={errors.code?.message}
              hint="It expires in a few minutes. Check spam if it has not arrived."
            >
              <Input
                id="register-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="••••••"
                className="h-14 text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em] md:text-2xl"
                aria-invalid={Boolean(errors.code)}
                aria-describedby={describedBy("register-code", {
                  error: errors.code,
                  hint: true,
                })}
                {...codeField}
                onChange={(event) => {
                  // Digits only; pasting "123 456" or "123-456" still works.
                  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
                  void codeField.onChange(event);
                  if (event.target.value.length === 6 && !pending) void onSubmit();
                }}
              />
            </Field>

            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Create account
            </Button>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2"
                disabled={pending}
                onClick={() => {
                  setFailure(null);
                  setStep("details");
                }}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Change details
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-mr-2"
                disabled={pending || resendIn > 0}
                onClick={async () => {
                  setFailure(null);
                  if (await requestCode(sentTo)) {
                    setValue("code", "");
                    clearErrors("code");
                    toast.success("A new code is on its way", { description: sentTo });
                  }
                }}
              >
                {sendCode.isPending ? <Spinner data-icon="inline-start" /> : null}
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </Button>
            </div>
          </form>
        </AuthPage>
      </AuthGate>
    );
  }

  return (
    <AuthGate redirectWhenAuthenticated>
      <AuthPage
        title="Create your account"
        description="One account holds your resumes, job descriptions and every tailoring run."
        footer={footer}
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

          <Field id="register-password" label="Password" error={errors.password?.message}>
            <PasswordInput
              id="register-password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                [
                  describedBy("register-password", { error: errors.password }),
                  "register-password-rules",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              {...register("password")}
            />
          </Field>
          <PasswordChecklist id="register-password-rules" password={password ?? ""} />

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Continue
          </Button>
          <p className="text-muted-foreground text-center text-xs text-pretty">
            We will email you a 6-digit code to confirm the address.
          </p>
        </form>
      </AuthPage>
    </AuthGate>
  );
}
