"use client";

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { cn } from "cn";
import { ButtonLink } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";

/**
 * The landing page's ways in.
 *
 * The page is prerendered once for every visitor, so its HTML carries the
 * signed-out answer — create an account, or sign in — which is the right one
 * for everybody <AppShell> sends here. Two visitors need a different answer,
 * and both are only known once the session resolves: someone who is already
 * signed in, and anyone on a demo server, which has no accounts to create or
 * sign in to. For them every way in is the app itself.
 */
function useGoesStraightIn(): boolean {
  const { mode, isAuthenticated } = useSession();
  return mode === "demo" || isAuthenticated;
}

/** The hero and the closing band ask for more than an in-app button. */
const LARGE = "h-11 px-5 text-[0.9375rem]";

const TEXT_LINK =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm text-sm transition-colors outline-none focus-visible:ring-3";

export function HeaderActions() {
  const straightIn = useGoesStraightIn();

  if (straightIn) {
    return (
      <ButtonLink href="/tailor" size="lg">
        Open RoleTeX
      </ButtonLink>
    );
  }

  return (
    <>
      <ButtonLink href="/sign-in" variant="ghost" size="lg">
        Sign in
      </ButtonLink>
      {/* The hero repeats this a screen below, so a phone's header keeps only
          the way back in for people who already have an account. */}
      <ButtonLink href="/register" size="lg" className="hidden sm:inline-flex">
        Create an account
      </ButtonLink>
    </>
  );
}

export function HeroActions({ className }: { className?: string }) {
  const straightIn = useGoesStraightIn();

  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-3", className)}>
      <ButtonLink href={straightIn ? "/tailor" : "/register"} size="lg" className={LARGE}>
        {straightIn ? "Open RoleTeX" : "Create an account"}
        <ArrowRightIcon aria-hidden="true" />
      </ButtonLink>
      <ButtonLink href="#how" variant="outline" size="lg" className={cn(LARGE, "bg-card")}>
        See how it works
      </ButtonLink>
    </div>
  );
}

export function ClosingActions({ className }: { className?: string }) {
  const straightIn = useGoesStraightIn();

  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-3", className)}>
      <ButtonLink href={straightIn ? "/tailor" : "/register"} size="lg" className={LARGE}>
        {straightIn ? "Open RoleTeX" : "Create an account"}
        <ArrowRightIcon aria-hidden="true" />
      </ButtonLink>
      {straightIn ? null : (
        <ButtonLink href="/sign-in" variant="outline" size="lg" className={LARGE}>
          Sign in
        </ButtonLink>
      )}
    </div>
  );
}

export function FooterLinks({ className }: { className?: string }) {
  const straightIn = useGoesStraightIn();

  return (
    <nav aria-label="Account" className={cn("flex items-center gap-6", className)}>
      {straightIn ? (
        <Link href="/tailor" className={TEXT_LINK}>
          Open RoleTeX
        </Link>
      ) : (
        <>
          <Link href="/sign-in" className={TEXT_LINK}>
            Sign in
          </Link>
          <Link href="/register" className={TEXT_LINK}>
            Create an account
          </Link>
        </>
      )}
    </nav>
  );
}
