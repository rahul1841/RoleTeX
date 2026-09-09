"use client";

import * as React from "react";
import { RequiresStorage } from "@/components/common";
import {
  AppearanceControl,
  DangerZone,
  DefaultProviderForm,
  PasswordForm,
  ProfileForm,
  ProviderKeys,
  SessionsPanel,
  SettingsNav,
  SettingsSection,
  type SettingsNavItem,
} from "@/components/settings";
import { useSession } from "@/hooks/use-session";
import { ServerStatus } from "./server-status";

/**
 * ONE SCROLLING DOCUMENT, NOT TABS — the layout decision for this screen.
 *
 * Tabs would have been the reflex, and they are wrong here for three reasons:
 *
 *  1. Two sections are arrived at from elsewhere. The global "verify your email"
 *     banner links to /settings and promises a verification link; the API
 *     client's copy for `llm_key_required` says "Add an API key for this
 *     provider in Settings". Behind a tab, both land the user on a page that
 *     does not contain what they were sent for.
 *  2. The sections answer each other. "Which provider is my default" is only
 *     meaningful next to "which providers have a key", and the warning that
 *     joins them (a default with no key stored) spans both. Tabs would put a
 *     scroll between a cause and its effect.
 *  3. There are eight of them and they are short. Tab strips are for content
 *     too large to coexist; this is a page you read down once when you set the
 *     product up, and search with Ctrl+F afterwards.
 *
 * What tabs are genuinely good at — not having to scroll past what you do not
 * care about — is handled by the sticky section index, which is real anchor
 * navigation: linkable, restorable, and legible to a screen reader as a list of
 * where the page goes.
 *
 * MODE. Settings is one of the two routes reachable in demo mode, where the
 * server has no database and therefore no accounts, no keys and no sessions.
 * Appearance and Deployment are properties of the browser and the server rather
 * than of a user, so they stay; everything else sits behind <RequiresStorage>,
 * which explains the absence instead of rendering empty forms that would 401.
 */

const ACCOUNT_SECTIONS: readonly SettingsNavItem[] = [
  { id: "providers", label: "Providers & keys" },
  { id: "defaults", label: "Tailoring defaults" },
  { id: "account", label: "Account" },
  { id: "password", label: "Password" },
  { id: "sessions", label: "Active sessions" },
] as const;

const SERVER_SECTIONS: readonly SettingsNavItem[] = [
  { id: "appearance", label: "Appearance" },
  { id: "deployment", label: "Deployment" },
] as const;

const DANGER_SECTION: readonly SettingsNavItem[] = [
  { id: "danger", label: "Danger zone" },
] as const;

export function SettingsScreen() {
  const { mode } = useSession();
  const storageAvailable = mode === "multi_user";

  // The index must describe the sections that are actually rendered, or demo
  // mode ships anchors pointing at nothing.
  const navItems = React.useMemo(
    () =>
      storageAvailable
        ? [...ACCOUNT_SECTIONS, ...SERVER_SECTIONS, ...DANGER_SECTION]
        : SERVER_SECTIONS,
    [storageAvailable],
  );

  return (
    <div className="mt-8 gap-10 lg:grid lg:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
      <SettingsNav items={navItems} className="hidden lg:block" />

      <div className="min-w-0 space-y-10">
        <RequiresStorage feature="Account settings">
          <SettingsSection
            id="providers"
            title="AI providers and keys"
            description="RoleTeX calls the provider you choose with the key you store here. Keys are encrypted before they are saved and cannot be read back."
          >
            <ProviderKeys />
          </SettingsSection>

          <SettingsSection
            id="defaults"
            title="Tailoring defaults"
            description="What a tailoring run uses when it does not name a provider or model itself."
          >
            <DefaultProviderForm />
          </SettingsSection>

          <SettingsSection
            id="account"
            title="Account"
            description="The address you sign in with and the name shown around the app."
          >
            <ProfileForm />
          </SettingsSection>

          <SettingsSection
            id="password"
            title="Password"
            description="Changing your password signs out every other device."
          >
            <PasswordForm />
          </SettingsSection>

          <SettingsSection
            id="sessions"
            title="Active sessions"
            description="Every browser and device currently signed in to this account."
          >
            <SessionsPanel />
          </SettingsSection>
        </RequiresStorage>

        <SettingsSection
          id="appearance"
          title="Appearance"
          description="Stored in this browser only; it is not part of your account."
        >
          <AppearanceControl />
        </SettingsSection>

        <SettingsSection
          id="deployment"
          title="Deployment"
          description="What this RoleTeX server is configured with, and what that means for what you can do."
        >
          <ServerStatus />
        </SettingsSection>

        {storageAvailable ? (
          <SettingsSection
            id="danger"
            title="Danger zone"
            description="Irreversible actions on this account."
          >
            <DangerZone />
          </SettingsSection>
        ) : null}
      </div>
    </div>
  );
}
