"use client";

import * as React from "react";
import { toast } from "sonner";
import { LaptopIcon, RefreshCwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ListSkeleton,
  LoadingState,
} from "@/components/common";
import { isApiError } from "@/lib/api/errors";
import type { SessionInfo } from "@/lib/api/types";
import { useSession } from "@/hooks/use-session";
import {
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
} from "@/hooks/use-account";
import { SettingsPanel } from "./section";
import { describeUserAgent, formatAbsolute, formatRelative } from "./format";

/**
 * Every session token currently valid for this account.
 *
 * This is the screen someone opens when they think somebody else is in their
 * account, so it is built for recognition and for acting fast:
 *
 *  - The current session is labelled and has no revoke control. Revoking it is
 *    a sign-out with extra steps, and offering it beside seven identical
 *    buttons is how a person locks themselves out mid-audit. The sign-out in
 *    the account menu is the honest route.
 *  - The raw user-agent is always shown next to the friendly guess. Agents are
 *    self-reported and spoofable; replacing the evidence with "Chrome on
 *    macOS" removes the only string the reader can actually compare.
 *  - Nothing is optimistic. A row that disappears before the server agreed is
 *    a lie on a screen whose whole purpose is telling the truth about access.
 */
export function SessionsPanel() {
  const { isAuthenticated } = useSession();
  const sessions = useSessions(isAuthenticated);
  const revokeOne = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();

  const [pendingRevoke, setPendingRevoke] = React.useState<SessionInfo | null>(
    null,
  );
  const [confirmingAll, setConfirmingAll] = React.useState(false);

  const list = sessions.data?.sessions ?? [];
  const others = list.filter((entry) => !entry.current);

  async function revokeSession(entry: SessionInfo) {
    try {
      await revokeOne.mutateAsync(entry.id);
      toast.success("Session revoked", {
        description: `${describeUserAgent(entry.user_agent)} has been signed out.`,
      });
    } catch (error) {
      toast.error("Could not revoke that session", {
        description: isApiError(error)
          ? error.message
          : "Check your connection and try again.",
      });
      throw error;
    }
  }

  async function revokeAllOthers() {
    try {
      const response = await revokeOthers.mutateAsync();
      const count = response?.revoked ?? others.length;
      toast.success(
        count === 1 ? "1 session revoked" : `${count} sessions revoked`,
        { description: "This device is still signed in." },
      );
    } catch (error) {
      toast.error("Could not revoke those sessions", {
        description: isApiError(error)
          ? error.message
          : "Check your connection and try again.",
      });
      throw error;
    }
  }

  if (sessions.isPending) {
    return (
      <LoadingState label="Loading active sessions">
        <ListSkeleton rows={2} />
      </LoadingState>
    );
  }

  if (sessions.isError) {
    return (
      <ErrorState
        error={sessions.error}
        onRetry={() => void sessions.refetch()}
        title="Could not load your active sessions"
      />
    );
  }

  return (
    <>
      {list.length === 0 ? (
        <EmptyState
          icon={LaptopIcon}
          title="No active sessions"
          description="Nothing is signed in to this account right now."
        />
      ) : (
        <SettingsPanel divide>
          {list.map((entry) => (
            <SessionRow
              key={entry.id}
              session={entry}
              onRequestRevoke={() => setPendingRevoke(entry)}
            />
          ))}
        </SettingsPanel>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-muted-foreground text-xs text-pretty">
          {others.length === 0
            ? "This is the only device signed in to your account."
            : `${others.length} other ${others.length === 1 ? "device is" : "devices are"} signed in. Revoking ends their access immediately.`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void sessions.refetch()}
            disabled={sessions.isFetching}
          >
            <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={others.length === 0 || revokeOthers.isPending}
            onClick={() => setConfirmingAll(true)}
          >
            Revoke all other sessions
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        title="Revoke this session?"
        description={
          <>
            {describeUserAgent(pendingRevoke?.user_agent ?? "")}
            {pendingRevoke?.client_ip ? ` at ${pendingRevoke.client_ip}` : ""} will
            be signed out immediately and will need your password to get back
            in. This device is unaffected.
          </>
        }
        confirmLabel="Revoke session"
        pending={revokeOne.isPending}
        onConfirm={async () => {
          if (pendingRevoke) await revokeSession(pendingRevoke);
          setPendingRevoke(null);
        }}
      />

      <ConfirmDialog
        open={confirmingAll}
        onOpenChange={setConfirmingAll}
        title={`Revoke ${others.length} other ${others.length === 1 ? "session" : "sessions"}?`}
        description="Every other signed-in device is signed out immediately. This device stays signed in. If you think someone else has your password, change it as well — that is the only thing that stops them signing back in."
        confirmLabel="Revoke them"
        pending={revokeOthers.isPending}
        onConfirm={async () => {
          await revokeAllOthers();
          setConfirmingAll(false);
        }}
      />
    </>
  );
}

function SessionRow({
  session,
  onRequestRevoke,
}: {
  session: SessionInfo;
  onRequestRevoke: () => void;
}) {
  const label = describeUserAgent(session.user_agent);

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{label}</span>
          {session.current ? (
            <Badge variant="secondary" className="text-[0.7rem]">
              This device
            </Badge>
          ) : null}
          {session.client_ip ? (
            <span className="text-muted-foreground font-mono text-xs">
              {session.client_ip}
            </span>
          ) : null}
        </div>

        <p
          className="text-code-foreground bg-code border-code-border truncate rounded border px-1.5 py-0.5 font-mono text-[0.7rem]"
          title={session.user_agent || "No user agent reported"}
        >
          {session.user_agent || "No user agent reported"}
        </p>

        <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
          <div className="flex gap-1">
            <dt>Last seen</dt>
            <dd title={formatAbsolute(session.last_seen_at)}>
              <span className="text-foreground/80">
                {formatRelative(session.last_seen_at) || "unknown"}
              </span>
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Signed in</dt>
            <dd title={formatAbsolute(session.created_at)}>
              <span className="text-foreground/80">
                {formatRelative(session.created_at) || "unknown"}
              </span>
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Expires</dt>
            <dd title={formatAbsolute(session.expires_at)}>
              <span className="text-foreground/80">
                {formatRelative(session.expires_at) || "unknown"}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      <div className="shrink-0">
        {session.current ? (
          <span className="text-muted-foreground text-xs">
            Sign out to end it
          </span>
        ) : (
          <Button size="sm" variant="destructive" onClick={onRequestRevoke}>
            Revoke
          </Button>
        )}
      </div>
    </div>
  );
}
