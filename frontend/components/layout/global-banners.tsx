"use client";

import Link from "next/link";
import { MailWarningIcon } from "lucide-react";

/**
 * Banners that belong to the application as a whole rather than to any page.
 *
 * Deliberately non-dismissible. It describes a condition that is still true
 * after it is dismissed, and a user who hides "your email is not verified" and
 * then hits a 403 has been failed by the UI, not helped by it.
 */
export function GlobalBanners({
  needsEmailVerification,
}: {
  needsEmailVerification: boolean;
}) {
  return needsEmailVerification ? <VerifyEmailBanner /> : null;
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
