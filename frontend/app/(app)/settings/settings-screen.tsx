"use client";

import {
  AppearanceControl,
  DangerZone,
  DefaultProviderForm,
  PasswordForm,
  ProfileForm,
  ProviderKeys,
  SettingsNav,
  SettingsSection,
  type SettingsNavItem,
} from "@/components/settings";

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
 *  3. There are six of them and they are short. Tab strips are for content
 *     too large to coexist; this is a page you read down once when you set the
 *     product up, and search with Ctrl+F afterwards.
 *
 * What tabs are genuinely good at — not having to scroll past what you do not
 * care about — is handled by the sticky section index, which is real anchor
 * navigation: linkable, restorable, and legible to a screen reader as a list of
 * where the page goes.
 */

const SECTIONS: readonly SettingsNavItem[] = [
  { id: "providers", label: "Providers & keys" },
  { id: "defaults", label: "Tailoring defaults" },
  { id: "account", label: "Account" },
  { id: "password", label: "Password" },
  { id: "appearance", label: "Appearance" },
  { id: "danger", label: "Danger zone" },
] as const;

/** Same numbering as the index. */
function number(id: string) {
  const index = SECTIONS.findIndex((item) => item.id === id);
  return index >= 0 ? String(index + 1).padStart(2, "0") : undefined;
}

export function SettingsScreen() {
  return (
    <div className="mt-10 gap-10 lg:grid lg:grid-cols-[minmax(0,14rem)_minmax(0,56rem)]">
      <SettingsNav items={SECTIONS} className="hidden lg:block" />

      <div className="min-w-0 space-y-5">
        <SettingsSection
          id="providers"
          number={number("providers")}
          title="AI providers and keys"
          description="RoleTeX calls the provider you choose with the key you store here. Keys are encrypted before they are saved and cannot be read back."
        >
          <ProviderKeys />
        </SettingsSection>

        <SettingsSection
          id="defaults"
          number={number("defaults")}
          title="Tailoring defaults"
          description="The provider a tailoring run uses when it doesn't name one. Each provider's model is set in the list above."
        >
          <DefaultProviderForm />
        </SettingsSection>

        <SettingsSection
          id="account"
          number={number("account")}
          title="Account"
          description="The address you sign in with and the name shown around the app."
        >
          <ProfileForm />
        </SettingsSection>

        <SettingsSection
          id="password"
          number={number("password")}
          title="Password"
          description="Changing your password signs out every other device."
        >
          <PasswordForm />
        </SettingsSection>

        <SettingsSection
          id="appearance"
          number={number("appearance")}
          title="Appearance"
          description="Stored in this browser only; it is not part of your account."
        >
          <AppearanceControl />
        </SettingsSection>

        <SettingsSection
          id="danger"
          number={number("danger")}
          tone="danger"
          title="Danger zone"
          description="Irreversible actions on this account."
        >
          <DangerZone />
        </SettingsSection>
      </div>
    </div>
  );
}
