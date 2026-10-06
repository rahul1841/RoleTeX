"use client";

import * as React from "react";
import { ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CardSkeleton, ErrorState, LoadingState, Spinner } from "@/components/common";
import type { TelegramLinkResponse } from "@/lib/api/types";
import { useLinkTelegram, useTelegram, useUnlinkTelegram } from "@/hooks/use-jobs";
import { formatAbsolute } from "./format";

/**
 * Connect a Telegram chat for job digests.
 *
 * Connecting mints a one-time deep link (`t.me/<bot>?start=<token>`); the chat
 * is bound when the user presses Start in Telegram, so this polls the status
 * until it flips to linked.
 */
export function TelegramSection() {
  const [pending, setPending] = React.useState<TelegramLinkResponse | null>(null);
  const status = useTelegram(pending !== null);
  const link = useLinkTelegram();
  const unlink = useUnlinkTelegram();

  if (status.isPending) {
    return (
      <LoadingState label="Loading Telegram status">
        <CardSkeleton />
      </LoadingState>
    );
  }
  if (status.isError) {
    return (
      <ErrorState
        error={status.error}
        title="Could not load the Telegram status"
        onRetry={() => void status.refetch()}
      />
    );
  }

  const { available, linked, linked_at: linkedAt } = status.data;

  if (!available) {
    return (
      <p className="text-muted-foreground text-sm">
        Telegram alerts are not set up on this server.
      </p>
    );
  }

  if (linked) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          Connected
          {linkedAt ? (
            <span className="text-muted-foreground"> since {formatAbsolute(linkedAt)}</span>
          ) : null}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={unlink.isPending}
          onClick={async () => {
            try {
              await unlink.mutateAsync();
              setPending(null);
              toast.success("Telegram disconnected");
            } catch {
              toast.error("Could not disconnect Telegram");
            }
          }}
        >
          {unlink.isPending ? <Spinner data-icon="inline-start" /> : null}
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pending ? (
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={pending.url}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Open Telegram
            <ExternalLinkIcon aria-hidden="true" className="size-4" />
          </a>
          <span role="status" className="text-muted-foreground inline-flex items-center gap-2 text-sm">
            <Spinner className="size-3.5" />
            Waiting for you to press Start in Telegram…
          </span>
        </div>
      ) : null}
      <Button
        variant={pending ? "ghost" : "default"}
        size="sm"
        disabled={link.isPending}
        onClick={async () => {
          try {
            setPending(await link.mutateAsync());
          } catch {
            toast.error("Could not create a Telegram link");
          }
        }}
      >
        {link.isPending ? <Spinner data-icon="inline-start" /> : null}
        {pending ? "New link" : "Connect Telegram"}
      </Button>
    </div>
  );
}
