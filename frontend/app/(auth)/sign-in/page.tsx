import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * Where <AppShell> sends a signed-out visitor on a multi-user server — except
 * one arriving at the bare root, who sees the landing page (/welcome) first.
 */
export default function SignInPage() {
  return <SignInForm />;
}
