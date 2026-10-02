import type { Metadata } from "next";
import { LandingPage } from "@/components/landing";

export const metadata: Metadata = {
  // The product name leads here, so the "%s · RoleTeX" template would repeat it.
  title: { absolute: "RoleTeX — tailor your resume to any job" },
  description:
    "Paste a job description and an AI model proposes edits to your resume. RoleTeX checks every edit, typesets the PDF in LaTeX, and shows you each change before you download.",
};

/**
 * The public front door, at "/". The app itself starts at /tailor.
 *
 * Outside both route groups on purpose: it is neither the signed-in shell nor
 * a single-task auth screen, and it has to render for everyone — signed out
 * and signed in.
 */
export default function WelcomePage() {
  return <LandingPage />;
}
