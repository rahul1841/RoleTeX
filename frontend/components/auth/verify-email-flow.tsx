"use client";

import * as React from "react";
import Link from "next/link";
import {
  LinkIcon,
  MailWarningIcon,
  MailCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { ErrorState, Spinner } from "@/components/common";
import { useConfirmVerification, useLogout } from "@/hooks/use-auth";
import { useSession } from "@/hooks/use-session";
import { AuthGate } from "./auth-gate";
import { AuthPage, AuthStatus, InlineCode } from "./auth-page";
import { apiErrorCode } from "./form-errors";
import { ResendVerification } from "./resend-verification";
import { clearFragmentToken, useFragmentToken } from "./use-fragment-token";

/**
 * `/verify-email` — redeem a confirmation link, or ask for a new one.
 *
 * Redemption is automatic. The user already expressed intent by clicking the
 * link in their inbox; putting a "Confirm" button in front of it just adds a
 * step that can be abandoned. The single-use token is spent exactly once
 * regardless, guarded by a ref so React's development double-effect cannot
 * burn it on the first render and then report the replay as an invalid link.
 *
 * The route is NOT gated on being signed in, and the confirm endpoint is
 * unauthenticated on the server for the same reason: verification links get
 * opened on a phone, or in whichever browser is default, which is very often
 * not the one that asked for the link. The token is the proof.
 *
 * Without a token the page becomes the place to get one, which is where the
 * global "verify your email" banner ultimately wants to send people.
 */
export function VerifyEmailFlow() {
  const token = useFragmentToken();
  const session = useSession();
  const confirm = useConfirmVerification();
  const signOut = useLogout();

  const { mutate: confirmToken } = confirm;
  const attempted = React.useRef(false);

  React.useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    confirmToken({ token });
  }, [token, confirmToken]);

  React.useEffect(() => {
    // Spent, and therefore worth removing from the address bar — but only now
    // that it is spent. See clearFragmentToken() for why not on mount.
    if (confirm.isSuccess) clearFragmentToken();
  }, [confirm.isSuccess]);

  const continueAction = session.isAuthenticated ? (
    <ButtonLink href="/" size="sm">
      Continue to RoleTeX
    </ButtonLink>
  ) : (
    <ButtonLink href="/sign-in" size="sm">
      Sign in
    </ButtonLink>
  );

  if (token === undefined) {
    return <Working label="Opening your verification link…" />;
  }

  if (token) {
    if (confirm.isPending || confirm.isIdle) {
      return <Working label="Confirming your email address…" />;
    }

    if (confirm.isSuccess) {
      return (
        <AuthGate>
          <AuthPage title="Email confirmed">
            <AuthStatus
              tone="success"
              icon={MailCheckIcon}
              actions={continueAction}
            >
              <p>
                This address is verified. Everything that was waiting on it —
                tailoring, saving resumes and job descriptions — is available
                now.
              </p>
            </AuthStatus>
          </AuthPage>
        </AuthGate>
      );
    }

    const expired = apiErrorCode(confirm.error) === "invalid_token";
    return (
      <AuthGate>
        <AuthPage
          title={expired ? "This link no longer works" : "Could not confirm"}
          description={
            expired
              ? "Verification links can be used once, and they expire."
              : undefined
          }
        >
          {expired ? (
            <AuthStatus
              tone="warning"
              icon={TriangleAlertIcon}
              actions={session.isAuthenticated ? undefined : continueAction}
            >
              <p>
                It has either already been used or run out of time. Ask for a
                fresh one — the new link replaces this one.
              </p>
              {session.isAuthenticated ? (
                <ResendVerification className="pt-1" />
              ) : (
                <p>Sign in first and this page will offer you a new link.</p>
              )}
            </AuthStatus>
          ) : (
            <ErrorState
              error={confirm.error}
              title="Could not confirm this address"
            />
          )}
        </AuthPage>
      </AuthGate>
    );
  }

  // No token in the fragment: this is someone who navigated here rather than
  // following a link.
  if (!session.isAuthenticated) {
    return (
      <AuthGate>
        <AuthPage
          title="Confirm your email"
          description="Open the link from the email RoleTeX sent you."
          footer={
            <span>
              Need a new link?{" "}
              <Link
                href="/sign-in"
                className="text-foreground font-medium underline underline-offset-3"
              >
                Sign in
              </Link>{" "}
              and this page will send one.
            </span>
          }
        >
          <AuthStatus tone="info" icon={LinkIcon} actions={continueAction}>
            <p>
              The confirmation travels in the part of the link after the{" "}
              <InlineCode>#</InlineCode>, so copy the whole address if your mail
              client shortened it.
            </p>
          </AuthStatus>
        </AuthPage>
      </AuthGate>
    );
  }

  if (session.user?.email_verified) {
    return (
      <AuthGate>
        <AuthPage title="Already confirmed">
          <AuthStatus
            tone="success"
            icon={MailCheckIcon}
            actions={continueAction}
          >
            <p>
              <span className="font-medium">{session.user.email}</span> is
              verified. There is nothing left to do here.
            </p>
          </AuthStatus>
        </AuthPage>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <AuthPage
        title="Confirm your email"
        description="This server wants a verified address before you can tailor or save anything."
        footer={
          <span>
            Signed in as{" "}
            <span className="text-foreground font-medium">
              {session.user?.email}
            </span>{". "}
            Wrong account?{" "}
            <button
              type="button"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
              className="text-foreground font-medium underline underline-offset-3 disabled:opacity-50"
            >
              Sign out
            </button>
          </span>
        }
      >
        <AuthStatus tone="warning" icon={MailWarningIcon}>
          <p>
            Send yourself a link and open it in any browser — it does not have
            to be this one.
          </p>
          <ResendVerification className="pt-1" />
        </AuthStatus>
      </AuthPage>
    </AuthGate>
  );
}

function Working({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="text-muted-foreground flex items-center justify-center gap-2.5 py-8 text-sm"
    >
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
