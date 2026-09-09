"use client";

import * as React from "react";
import { cn } from "cn";
import { CircleAlertIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api/errors";

/**
 * Counts down to zero from `seconds`, restarting whenever `resetToken` changes.
 *
 * Deadline-based rather than decrement-based: background tabs throttle timers,
 * and a naive `remaining - 1` every tick would drift into telling the user to
 * wait long after the rate limit had already lifted.
 */
function useRetryCountdown(seconds: number | null, resetToken: unknown) {
  const [token, setToken] = React.useState(resetToken);
  const [remaining, setRemaining] = React.useState(() => seconds ?? 0);

  // Resetting derived state *during render* rather than in an effect is React's
  // prescribed pattern for "a prop changed, recompute": it re-renders before
  // anything is painted, so the user never sees one frame of the previous
  // error's countdown. `resetToken` is the error identity — the same 429 thrown
  // again must restart the clock even though `seconds` is unchanged.
  if (token !== resetToken) {
    setToken(resetToken);
    setRemaining(seconds ?? 0);
  }

  React.useEffect(() => {
    if (!seconds || seconds <= 0) return;
    const deadline = Date.now() + seconds * 1000;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) window.clearInterval(id);
    }, 500);
    return () => window.clearInterval(id);
  }, [seconds, resetToken]);

  return remaining;
}

export interface ErrorStateProps {
  /** Anything thrown by the API client, a mutation, or a query. */
  error: unknown;
  /** Omit for errors the user cannot do anything about. */
  onRetry?: () => void;
  /** Overrides the default heading; the error's own message stays below it. */
  title?: React.ReactNode;
  /** Extra actions rendered next to Try again — a link to Settings, say. */
  action?: React.ReactNode;
  className?: string;
  /** `bare` drops the bordered container when the caller supplies one. */
  variant?: "card" | "bare";
  retryLabel?: string;
}

/**
 * The standard way to render a failure.
 *
 * Everything the API client throws is an `ApiError`, so this knows how to show
 * all of it: the human message, the per-field problems a 422 carries, and the
 * machine code (worth showing in a developer tool — it is what the backend
 * logs and what a bug report needs).
 *
 * The one piece of real logic is rate limiting: a 429 carries `retryAfter`, and
 * offering an enabled Retry button during that window only deepens the limit.
 * The button is disabled and counts down instead.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  action,
  className,
  variant = "card",
  retryLabel = "Try again",
}: ErrorStateProps) {
  const apiError = isApiError(error) ? error : null;
  const message = apiError
    ? apiError.message
    : error instanceof Error
      ? error.message
      : "Something went wrong. Please try again.";

  const retryAfter =
    apiError?.isRateLimited && apiError.retryAfter ? apiError.retryAfter : null;
  const remaining = useRetryCountdown(retryAfter, error);
  const waiting = remaining > 0;

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 text-sm",
        variant === "card" &&
          "border-destructive/25 bg-destructive/5 rounded-xl border p-4",
        className,
      )}
    >
      <div className="flex gap-3">
        <CircleAlertIcon
          aria-hidden="true"
          className="text-destructive mt-0.5 size-4 shrink-0"
        />
        <div className="min-w-0 space-y-2">
          <p className="text-destructive font-medium text-pretty">
            {title ?? "That did not work"}
          </p>
          <p className="text-foreground/80 text-pretty">{message}</p>

          {apiError && apiError.fieldErrors.length > 0 ? (
            <ul className="text-muted-foreground list-disc space-y-0.5 pl-4">
              {apiError.fieldErrors.map((fieldError) => (
                <li key={fieldError}>{fieldError}</li>
              ))}
            </ul>
          ) : null}

          {apiError ? (
            <p className="text-muted-foreground font-mono text-xs">
              {apiError.status} · {apiError.code}
            </p>
          ) : null}
        </div>
      </div>

      {onRetry || action ? (
        <div className="flex flex-wrap items-center gap-2 pl-7">
          {onRetry ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={waiting}
            >
              <RefreshCwIcon data-icon="inline-start" />
              {waiting ? `Retry in ${remaining}s` : retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}

      {/* Announced separately so the countdown is spoken as it changes rather
          than re-reading the whole error every second. */}
      {waiting ? (
        <p aria-live="polite" className="sr-only">
          Rate limited. Retry available in {remaining} seconds.
        </p>
      ) : null}
    </div>
  );
}
