"use client";

import { DatabaseIcon } from "lucide-react";
import { EmptyState } from "./empty-state";
import { PageContainer } from "./page-container";
import { useSession } from "@/hooks/use-session";
import { LoadingState } from "./loading-state";

/**
 * Gate for screens that cannot work without the database.
 *
 * Demo mode (`GET /api/health` -> `mode: "demo"`) has no Mongo, so there are no
 * accounts, saved resumes, JDs or run history. The nav already disables those
 * destinations, but the routes themselves are static pages a user can still
 * reach by typing the URL or following an old bookmark. Without this they would
 * render a perfectly normal-looking empty list and imply the user simply has no
 * data yet — which is a lie.
 *
 * Wrap the body of every storage-backed page:
 *
 *   <RequiresStorage feature="Saved resumes">
 *     <ResumeList />
 *   </RequiresStorage>
 */
export interface RequiresStorageProps {
  /**
   * What the user was trying to reach, e.g. "Saved resumes". Used in the
   * explanation so the message names the thing they actually wanted.
   */
  feature: string;
  children: React.ReactNode;
}

export function RequiresStorage({ feature, children }: RequiresStorageProps) {
  const { mode, isLoading } = useSession();

  // Render nothing decisive until the mode is known, or the page would flash
  // the unavailable state on every load before health resolves.
  if (isLoading || mode === null) {
    return <LoadingState label={`Loading ${feature.toLowerCase()}…`} />;
  }

  if (mode === "demo") {
    return (
      <PageContainer>
        <EmptyState
          icon={DatabaseIcon}
          title={`${feature} need a database`}
          description={
            "This server is running in demo mode with no database configured, " +
            "so accounts, saved resumes, job descriptions and run history are " +
            "unavailable. You can still tailor the built-in sample resume and " +
            "download the PDF."
          }
        />
      </PageContainer>
    );
  }

  return <>{children}</>;
}
