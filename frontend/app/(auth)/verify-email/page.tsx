import type { Metadata } from "next";
import { VerifyEmailFlow } from "@/components/auth/verify-email-flow";

export const metadata: Metadata = {
  title: "Confirm your email",
};

/**
 * Target of the verification link the backend emails, and the place to ask for
 * a new one. Token handling is identical to /reset-password.
 */
export default function VerifyEmailPage() {
  return <VerifyEmailFlow />;
}
