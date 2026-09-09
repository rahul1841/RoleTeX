"use client";

import * as React from "react";
import { ServerCrashIcon } from "lucide-react";
import { ErrorState } from "@/components/common";
import { isApiError } from "@/lib/api/errors";

/**
 * The app could not start.
 *
 * `GET /api/health` is the first request the app makes and the one that decides
 * which mode everything else runs in, so there is no useful UI to show until it
 * answers. This mirrors the old app's `#boot-error` panel: say what failed, say
 * what usually causes it, and offer a retry that refetches rather than a page
 * reload the user has to think of themselves.
 */
export function BootError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => Promise<unknown>;
}) {
  const [retrying, setRetrying] = React.useState(false);

  async function handleRetry() {
    try {
      setRetrying(true);
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  // A 401/403 here means the server answered — the problem is the session, not
  // the server — so the "is it running?" hint would be misleading.
  const reachedServer = isApiError(error) && error.status > 0;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 px-4 py-20 text-center">
      <span
        aria-hidden="true"
        className="bg-destructive/10 text-destructive flex size-11 items-center justify-center rounded-full"
      >
        <ServerCrashIcon className="size-5" />
      </span>

      <div className="space-y-1.5">
        <h1 className="font-heading text-lg font-semibold tracking-tight">
          RoleTeX could not start
        </h1>
        <p className="text-muted-foreground text-sm text-pretty">
          {reachedServer
            ? "The server answered, but not with something the app can start from."
            : "The API did not respond. If you are running this locally, check that the FastAPI server is up."}
        </p>
      </div>

      <ErrorState
        error={error}
        onRetry={handleRetry}
        retryLabel={retrying ? "Retrying…" : "Try again"}
        title="Startup check failed"
        className="w-full text-left"
      />
    </div>
  );
}
