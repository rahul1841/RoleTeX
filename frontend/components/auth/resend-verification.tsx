"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { CheckIcon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState, Spinner } from "@/components/common";
import { useRequestVerification } from "@/hooks/use-auth";
import { useSession } from "@/hooks/use-session";
import { queryKeys } from "@/lib/api/query-keys";
import { apiErrorCode } from "./form-errors";

/**
 * "Send me another confirmation link" — `POST /api/auth/verify/request`.
 *
 * Deliberately a standalone, prop-free block rather than part of a page: two
 * places need this exact action. /verify-email offers it to someone whose link
 * died, and Settings is where the global "verify your email" banner sends
 * people. Reading the address from `useSession()` instead of taking it as a
 * prop is what lets both drop it in with no wiring.
 *
 * Three outcomes, all of them told honestly:
 *
 *  - `delivered: true`  — a mail transport exists and the link is on its way.
 *  - `delivered: false` — this server has no SMTP configured, so the link went
 *    to its log. Saying "sent!" here would leave someone refreshing an inbox
 *    that will never receive anything.
 *  - 409 `already_verified` — not a failure. The session is refreshed so the
 *    banner that sent them here disappears, and it is reported as good news.
 *
 * A 429 is rendered by <ErrorState>, which counts down `Retry-After`: these
 * routes carry their own tight per-IP AND per-address mail budget, so a
 * hammered "resend" button is exactly what the server is defending against.
 */
export function ResendVerification({ className }: { className?: string }) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const send = useRequestVerification();

  const [delivered, setDelivered] = React.useState<boolean | null>(null);
  const [failure, setFailure] = React.useState<unknown>(null);

  const alreadyVerified = apiErrorCode(failure) === "already_verified";

  async function resend() {
    setFailure(null);
    setDelivered(null);
    try {
      const response = await send.mutateAsync();
      setDelivered(response.delivered);
    } catch (error) {
      if (apiErrorCode(error) === "already_verified") {
        // The server knows something this browser did not; catch the cache up
        // so the verification banner stops nagging.
        void queryClient.invalidateQueries({ queryKey: queryKeys.session.me });
      }
      setFailure(error);
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void resend()}
        disabled={send.isPending}
      >
        {send.isPending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <SendIcon data-icon="inline-start" aria-hidden="true" />
        )}
        Send a verification link
      </Button>

      {delivered === true ? (
        <p role="status" className="text-muted-foreground text-sm text-pretty">
          Sent to{" "}
          <span className="text-foreground font-medium">{user?.email}</span>. The
          link works once and expires; open it soon.
        </p>
      ) : null}

      {delivered === false ? (
        <p role="status" className="text-warning-foreground text-sm text-pretty">
          This server has no mail transport configured, so nothing was
          delivered — the link was written to the server log instead. Whoever
          runs this deployment can read it from there.
        </p>
      ) : null}

      {alreadyVerified ? (
        <p
          role="status"
          className="text-diff-added-foreground flex items-center gap-1.5 text-sm"
        >
          <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
          This address is already verified.
        </p>
      ) : failure ? (
        <ErrorState error={failure} title="Could not send the link" />
      ) : null}
    </div>
  );
}
