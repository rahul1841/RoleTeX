import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, LoadingState, PageContainer, PageHeader } from "@/components/common";
import { TailorWorkspace } from "@/components/tailor";

export const metadata: Metadata = {
  title: "Tailor",
};

/**
 * The product's reason to exist: point a resume at a job description, review
 * every change the model proposes, and take the compiled PDF.
 *
 * A server component so the route can export `metadata` (the root template
 * turns this into "Tailor · RoleTeX"). All of the behaviour lives in
 * <TailorWorkspace>, which is a client component because it reads the query
 * string — `?resume=…&jd=…` is how the resume and job-description screens hand
 * a selection over, since `output: "export"` rules out dynamic route segments.
 * `useSearchParams()` under a static export must sit inside <Suspense>.
 *
 * The wide container is deliberate: the change list, the unified diff and the
 * PDF preview share the viewport, and rules.md R-14 does not allow trading one
 * away for the other.
 */
export default function TailorPage() {
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Tailor a resume"
        description="Point a resume at a job description, let the model propose changes, review every one of them, then take the compiled PDF."
        className="mb-6"
      />
      <Suspense
        fallback={
          <LoadingState label="Loading the tailoring workspace…">
            <CardSkeleton />
          </LoadingState>
        }
      >
        <TailorWorkspace />
      </Suspense>
    </PageContainer>
  );
}
