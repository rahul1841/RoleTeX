"use client";

import { useSearchParams } from "next/navigation";
import { NewResumeView } from "./new-resume-view";
import { ResumeDetailView } from "./resume-detail";
import { ResumeLibrary } from "./resume-library";

/**
 * Which of the three resume screens is showing, decided by the query string.
 *
 *   /resumes            the library
 *   /resumes?new=1      the builder, empty
 *   /resumes?id=…       one saved resume
 *
 * Query parameters rather than route segments because production is a static
 * export: `output: "export"` prerenders one HTML file per route and
 * `generateStaticParams` cannot enumerate ids that belong to a user's account,
 * so `/resumes/[id]` has nothing to build. The state is genuinely in the URL
 * either way — it is linkable, bookmarkable, and survives a reload.
 *
 * `useSearchParams` forces the tree under it to render on the client, which is
 * why the page wraps this in <Suspense>.
 */
export function ResumesWorkspace() {
  const params = useSearchParams();
  const id = params.get("id");

  if (id) return <ResumeDetailView id={id} />;
  if (params.get("new")) return <NewResumeView />;
  return <ResumeLibrary />;
}
