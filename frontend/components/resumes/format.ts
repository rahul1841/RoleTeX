import type { ResumeSummary } from "@/lib/api/types";

/**
 * How a resume got here.
 *
 * `source_type` is set by the server: `manual` for the builder, `latex` and
 * `pdf` for imports, and `pdf_scanned` when the upload had no text layer and
 * the facts were read from rendered page images. That last one is worth
 * surfacing — it is the case most likely to have misread something.
 */
const SOURCE_LABELS: Record<string, { label: string; hint: string }> = {
  manual: { label: "Written here", hint: "Authored in the builder." },
  latex: { label: "From LaTeX", hint: "Imported from pasted LaTeX source." },
  pdf: { label: "From PDF", hint: "Imported from an uploaded PDF." },
  pdf_scanned: {
    label: "From a scan",
    hint: "Read from page images — this PDF had no text layer, so check the facts closely.",
  },
};

export function sourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType]?.label ?? sourceType;
}

export function sourceHint(sourceType: string): string {
  return SOURCE_LABELS[sourceType]?.hint ?? "";
}

/** A scanned import deserves a warning colour rather than a neutral one. */
export function isLowConfidenceSource(sourceType: string): boolean {
  return sourceType === "pdf_scanned";
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

/**
 * "3 minutes ago", from an ISO timestamp.
 *
 * Returns an empty string for a missing or unparseable value rather than
 * "Invalid Date": every timestamp on these models is `Optional[str]`, and a
 * resume written before the field existed has none.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "";

  let duration = (parsed - Date.now()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return RELATIVE.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return "";
}

/** Full timestamp for a `title` attribute, so the relative one is checkable. */
export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toLocaleString();
}

/** "v3", or "v1" when the field is missing. */
export function versionLabel(version: number | null | undefined): string {
  return `v${version ?? 1}`;
}

/** Newest first, by `updated_at` and then `created_at`. */
export function sortResumes(resumes: ResumeSummary[]): ResumeSummary[] {
  return [...resumes].sort((a, b) => {
    const left = Date.parse(a.updated_at ?? a.created_at ?? "") || 0;
    const right = Date.parse(b.updated_at ?? b.created_at ?? "") || 0;
    return right - left;
  });
}

/** A one-line summary of what is in a resume, for a list row. */
export function contentSummary(counts: {
  experience: number;
  projects: number;
  education: number;
  skills: number;
}): string {
  const parts: string[] = [];
  if (counts.experience) parts.push(`${counts.experience} role${counts.experience === 1 ? "" : "s"}`);
  if (counts.projects) parts.push(`${counts.projects} project${counts.projects === 1 ? "" : "s"}`);
  if (counts.education) parts.push(`${counts.education} school${counts.education === 1 ? "" : "s"}`);
  if (counts.skills) parts.push(`${counts.skills} skill group${counts.skills === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
