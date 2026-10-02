import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingState, PageContainer } from "@/components/common";
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
 */
export default function ResumesPage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <LoadingState label="Loading your resumes…" />
        </PageContainer>
      }
    >
      <ResumesWorkspace />
    </Suspense>
  );
}
