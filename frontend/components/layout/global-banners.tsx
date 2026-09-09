"use client";

import Link from "next/link";
import { DatabaseIcon, MailWarningIcon } from "lucide-react";
import type { AppMode } from "@/lib/api/types";

/**
 * Banners that belong to the application as a whole rather than to any page.
 *
 * Both are deliberately non-dismissible. They describe conditions that are
 * still true after they are dismissed, and a user who hides "your email is not
 * verified" and then hits a 403 has been failed by the UI, not helped by it.
 */
export function GlobalBanners({
  mode,
  needsEmailVerification,
}: {
  mode: AppMode | null;
  needsEmailVerification: boolean;
}) {
  return (
    <>
      {mode === "demo" ? <DemoModeBanner /> : null}
      {needsEmailVerification ? <VerifyEmailBanner /> : null}
    </>
  );
}

/**
 * Demo mode is a real deployment shape, not a degraded one: the server runs
 * without a database on purpose. The banner therefore states what is missing
 * and what still works, rather than apologising or implying a fault.
 */
function DemoModeBanner() {
  return (
    <div className="bg-muted/60 border-b">
      <div className="text-muted-foreground mx-auto flex w-full max-w-[96rem] items-start gap-2.5 px-4 py-2.5 text-sm sm:px-6 lg:px-8">
        <DatabaseIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0"
        />
        <p className="text-pretty">
          <span className="text-foreground font-medium">Demo mode.</span> No
          database is configured on this server, so there are no accounts and
          nothing can be saved — resumes, job descriptions and run history are
          all unavailable. Tailoring a resume and downloading the PDF still
          work.
        </p>
      </div>
    </div>
  );
}

function VerifyEmailBanner() {
  return (
    <div className="bg-warning border-warning-border/70 border-b">
      <div className="text-warning-foreground mx-auto flex w-full max-w-[96rem] items-start gap-2.5 px-4 py-2.5 text-sm sm:px-6 lg:px-8">
        <MailWarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p className="text-pretty">
          <span className="font-medium">Verify your email address.</span> This
          server requires a verified address before you can tailor or save
          anything.{" "}
          <Link
            href="/settings"
            className="font-medium underline underline-offset-3"
          >
            Send a new verification link
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
