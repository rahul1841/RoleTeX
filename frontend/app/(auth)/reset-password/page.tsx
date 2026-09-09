import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Reset password",
};

/**
 * Target of the reset link the backend emails.
 *
 * The one-time token arrives in the URL FRAGMENT — either the legacy
 * `/#/reset-password?token=...` that <AuthRuntime> rewrites, or the modern
 * `/reset-password/#token=...`. It is read with `location.hash`, never
 * `useSearchParams()`, so it is never put on the wire. See
 * components/auth/token-link.ts.
 */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
