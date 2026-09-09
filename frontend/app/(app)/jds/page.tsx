import type { Metadata } from "next";
import { JdScreen } from "@/components/jds";

/**
 * The root layout declares a title template of "%s · RoleTeX", so this becomes
 * "Job descriptions · RoleTeX". Exporting metadata requires a server
 * component, which is why every interactive part of this screen lives in
 * <JdScreen> instead.
 *
 * There is deliberately no `/jds/[id]` route: production is a static export
 * and a dynamic segment would need `generateStaticParams` to enumerate user
 * records at build time. A job description is selected with `/jds?id=…` and
 * read from the URL inside the screen.
 */
export const metadata: Metadata = {
  title: "Job descriptions",
};

export default function JdsPage() {
  return <JdScreen />;
}
