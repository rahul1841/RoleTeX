import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * Where <AppShell> sends every signed-out visitor on a multi-user server.
 */
export default function SignInPage() {
  return <SignInForm />;
}
