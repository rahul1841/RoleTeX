"use client";

import * as React from "react";
// Imported from their own files rather than the @/components/layout barrel:
// that barrel also re-exports <AppShell>, and a client component pulling it
// in would drag the whole application frame into every auth chunk.
import { RouteFocusProvider } from "@/components/layout/route-focus";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Wordmark } from "@/components/layout/wordmark";
import { useHealth } from "@/hooks/use-session";
import { RegistrationStatusProvider } from "./registration-status";

/**
 * The frame every signed-out screen renders into.
 *
 * It is the counterpart to <AppShell>, and it exists because the two states
 * need opposite things: the app shell is a workspace with navigation and a
 * user menu, while this is a single task with nothing to navigate to. One
 * column, one card, one decision.
 *
 * Three responsibilities beyond the layout:
 *
 *  1. It owns `<main id="main-content">`. The skip link in app/layout.tsx
 *     targets that id and <AppShell> is the only other thing that provides it,
 *     so without this the link would be dead on every auth route.
 *  2. <RouteFocusProvider> so moving between /sign-in and /register announces
 *     itself: the provider counts navigations and <PageHeader> focuses its
 *     <h1> when the count changes. Outside a provider the count is frozen at 0
 *     and focus never moves.
 *  3. <RegistrationStatusProvider> so what /register learns about
 *     `ALLOW_REGISTRATION` is still known when the user returns to /sign-in.
 *     A layout does not remount across routes inside its own group, which is
 *     exactly the lifetime that fact needs.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <RouteFocusProvider>
      <RegistrationStatusProvider>
        <div className="relative flex min-h-svh flex-1 flex-col">
          {/* Parity with the app header. Someone who set the app to dark and
              then got signed out should not be handed a white page with no way
              to fix it. */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
            <ThemeToggle />
          </div>

          <main
            id="main-content"
            tabIndex={-1}
            className="focus-visible:ring-ring/50 flex flex-1 flex-col items-center justify-center px-4 py-14 outline-none focus-visible:ring-2"
          >
            <div className="flex w-full max-w-[25rem] flex-col gap-6">
              <div className="flex justify-center">
                <Wordmark />
              </div>

              {/* `ring` rather than `border`, matching components/ui/card so an
                  auth card and an in-app card are visibly the same surface. */}
              <div className="bg-card ring-foreground/10 rounded-xl p-6 ring-1 sm:p-7">
                {children}
              </div>

              <ServerFootnote />
            </div>
          </main>
        </div>
      </RegistrationStatusProvider>
    </RouteFocusProvider>
  );
}

/**
 * What this deployment is, in one mono line.
 *
 * RoleTeX is self-hosted, so "which server am I actually looking at" is a real
 * question at the sign-in screen — a stray tab pointed at a colleague's
 * instance looks identical otherwise. Rendered only once health resolves;
 * `useHealth` is cached with `staleTime: Infinity`, so this costs nothing that
 * the page was not already fetching.
 */
function ServerFootnote() {
  const health = useHealth();
  if (!health.data) return null;

  return (
    <p className="text-muted-foreground text-center font-mono text-[0.6875rem]">
      {health.data.mode} · v{health.data.version} · {health.data.provider}
    </p>
  );
}
