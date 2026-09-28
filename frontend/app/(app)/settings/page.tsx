import type { Metadata } from "next";
import { PageContainer, PageHero } from "@/components/common";
import { SettingsScreen } from "./settings-screen";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * A server component so the route can export `metadata` and pick up the root
 * layout's "%s · RoleTeX" title template. Everything interactive lives in the
 * colocated <SettingsScreen>, which is where the client boundary starts.
 */
export default function SettingsPage() {
  return (
    <PageContainer width="wide" className="sm:pt-12 sm:pb-16">
      <PageHero
        eyebrow="Account & server"
        title="Settings"
        description="Your AI provider keys, your tailoring defaults, your account, and what this server can do."
      />
      <SettingsScreen />
    </PageContainer>
  );
}
