import type { Metadata } from "next";
import { JobsScreen } from "@/components/job-watch";

/**
 * Matched jobs. Like /jds, a job is selected with `/jobs?id=…` rather than a
 * dynamic segment, which a static export cannot prerender.
 */
export const metadata: Metadata = {
  title: "Jobs",
};

export default function JobsPage() {
  return <JobsScreen />;
}
