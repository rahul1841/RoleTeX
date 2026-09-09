"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOutIcon, MailWarningIcon, SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logout } from "@/lib/api/endpoints/session";
import { queryKeys } from "@/lib/api/query-keys";
import type { User } from "@/lib/api/types";
import { Spinner } from "@/components/common";

/**
 * Two letters for the avatar: initials when the account has a name, otherwise
 * the first two characters of the email local part. Never empty — a blank
 * circle in the header looks like a loading bug.
 */
function initialsFor(user: User): string {
  const name = user.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const letters =
      parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2);
    return letters.toUpperCase();
  }
  const local = user.email.split("@")[0] ?? user.email;
  return (local.slice(0, 2) || "?").toUpperCase();
}

export function UserMenu({
  user,
  needsEmailVerification,
}: {
  user: User;
  needsEmailVerification: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Drop every cached query except health: the mode of the server has not
      // changed, but everything else in the cache belonged to the account that
      // just signed out and must not be visible to whoever signs in next.
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== queryKeys.health[0],
      });
      router.replace("/sign-in");
    },
    onError: () => {
      // The cookie may or may not still be valid, so do not pretend either
      // way; useSession will settle it on the next /api/me.
      toast.error("Could not sign out", {
        description: "Check your connection and try again.",
      });
    },
  });

  const displayName = user.name?.trim() || user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" className="relative" />}
        aria-label={`Account menu for ${user.email}`}
      >
        <Avatar size="sm">
          <AvatarFallback className="text-[0.625rem] font-medium">
            {initialsFor(user)}
          </AvatarFallback>
        </Avatar>
        {/* A dot rather than text: the full explanation is in the global
            banner, this only has to draw the eye to the menu. */}
        {needsEmailVerification ? (
          <span
            aria-hidden="true"
            className="bg-warning-border ring-background absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2"
          />
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <div className="px-1.5 py-1.5">
          <p className="truncate text-sm font-medium">{displayName}</p>
          <p className="text-muted-foreground truncate text-xs">{user.email}</p>
        </div>
        <DropdownMenuSeparator />

        {needsEmailVerification ? (
          <DropdownMenuItem
            render={<Link href="/settings" />}
            className="text-warning-foreground"
          >
            <MailWarningIcon aria-hidden="true" />
            Verify your email
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem render={<Link href="/settings" />}>
          <SettingsIcon aria-hidden="true" />
          Settings
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          {signOut.isPending ? (
            <Spinner />
          ) : (
            <LogOutIcon aria-hidden="true" />
          )}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
