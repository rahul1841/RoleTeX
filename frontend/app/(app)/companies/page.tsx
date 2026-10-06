import type { Metadata } from "next";
import { CompaniesScreen } from "@/components/job-watch";

/** Job-watch setup. Interactive parts live in <CompaniesScreen> so this stays a server page. */
export const metadata: Metadata = {
  title: "Companies",
};

export default function CompaniesPage() {
  return <CompaniesScreen />;
}
