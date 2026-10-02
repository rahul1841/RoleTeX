"use client";

import { SparklesIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { useRuns } from "@/hooks/use-runs";
import { useSession } from "@/hooks/use-session";

/**
 * The page header's "New run", shown only once there are runs — an empty
 * history offers its own "Tailor a resume" button. Shares the list's cache.
 */
export function HistoryActions() {
  const { mode } = useSession();
  const runs = useRuns({ enabled: mode === "multi_user" });
  if (!runs.data?.length) return null;

  return (
    <ButtonLink href="/tailor" className="h-10 rounded-xl px-4">
      <SparklesIcon data-icon="inline-start" />
      New run
    </ButtonLink>
  );
}
