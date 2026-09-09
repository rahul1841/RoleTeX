import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingState, PageContainer, RequiresStorage } from "@/components/common";
import { ResumesWorkspace } from "@/components/resumes";

export const metadata: Metadata = {
  title: "Resumes",
};

/**
 * The resumes route.
 *
 * A server component, so it can export `metadata` and pick up the root
 * layout's "%s · RoleTeX" title template; everything interactive lives in
 * <ResumesWorkspace>, which is the client boundary.
 *
 * No `<h1>` here — <PageHeader> owns it, and each of the three screens under
 * the workspace renders its own so the heading names what is actually on
 * screen (the library, a resume, or the new-resume form).
 *
 * <Suspense> is required, not decorative: the workspace reads the selected
 * resume from `useSearchParams`, and Next refuses to prerender a component
 * that does so without a boundary above it — which under `output: "export"`
 * is a build error, not a warning.
 *
 * <RequiresStorage> is outside the Suspense boundary because in demo mode
 * there is no database at all: the honest answer is "this server cannot do
 * this", not an empty list that implies the user simply has no resumes yet.
 */
export default function ResumesPage() {
  return (
    <RequiresStorage feature="Saved resumes">
      <Suspense
        fallback={
          <PageContainer>
            <LoadingState label="Loading your resumes…" />
          </PageContainer>
        }
      >
        <ResumesWorkspace />
      </Suspense>
    </RequiresStorage>
  );
}
