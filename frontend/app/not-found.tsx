import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth";
import { AuthPage } from "@/components/auth/auth-page";
import { ButtonLink } from "@/components/ui/button";
import { RequestedPath } from "./requested-path";

export const metadata: Metadata = {
  title: "Page not found",
};

const LINK = "text-foreground font-medium underline underline-offset-3";

/**
 * Every address the app has no page for.
 *
 * Under `output: "export"` this becomes 404.html, which FastAPI's StaticFiles
 * serves for any unknown path — so it has to make sense to a signed-in user and
 * a signed-out visitor alike. It borrows the signed-out
 * screens' frame: one column, one card, one way out, with the theme control
 * still in reach.
 */
export default function NotFound() {
  return (
    <AuthShell>
      <AuthPage
        title="Page not found"
        description="There is nothing at this address. The link may be mistyped or out of date — nothing you have saved is affected."
        footer={
          <span>
            Or go straight to{" "}
            <Link href="/resumes" className={LINK}>
              Resumes
            </Link>
            ,{" "}
            <Link href="/jds" className={LINK}>
              Job descriptions
            </Link>{" "}
            or{" "}
            <Link href="/history" className={LINK}>
              History
            </Link>
            .
          </span>
        }
      >
        <div className="space-y-4">
          <RequestedPath />
          <ButtonLink href="/" size="lg" className="w-full">
            Go to RoleTeX
          </ButtonLink>
        </div>
      </AuthPage>
    </AuthShell>
  );
}
