/**
 * Dates and labels for the job-watch screens.
 *
 * The API returns ISO-8601 in UTC, sometimes null; everything here is
 * null-tolerant and shows a placeholder rather than "Invalid Date".
 */

import { isApiError } from "@/lib/api/errors";
import type { Company, JobMatch } from "@/lib/api/types";

const PLACEHOLDER = "—";

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const absolute = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatAbsolute(value: string | null | undefined): string {
  const date = parseDate(value);
  return date ? absolute.format(date) : PLACEHOLDER;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

export function formatRelative(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return PLACEHOLDER;
  const elapsed = date.getTime() - Date.now();
  const magnitude = Math.abs(elapsed);
  for (const [unit, ms] of UNITS) {
    if (magnitude >= ms) return relative.format(Math.round(elapsed / ms), unit);
  }
  return "just now";
}

/** What the company row says about its crawl. */
export function companyStatus(company: Company): {
  label: string;
  tone: "busy" | "ok" | "warn" | "error";
} {
  switch (company.status) {
    case "checking":
      return { label: "Reading page…", tone: "busy" };
    case "unsupported":
      return { label: "No job data on this page", tone: "warn" };
    case "error":
      return { label: "Could not be read", tone: "error" };
    default:
      return company.last_crawled_at
        ? { label: "Ready", tone: "ok" }
        : { label: "Crawling…", tone: "busy" };
  }
}

export const LABEL_TEXT: Record<JobMatch["label"], string> = {
  fits: "fits",
  stretch: "stretch",
  unstated: "experience not stated",
};

/** "2–4 yrs · fits", "5+ yrs · stretch", "experience not stated". */
export function experienceLine(job: Pick<JobMatch, "experience" | "label" | "experience_basis">): string {
  if (!job.experience) return LABEL_TEXT.unstated;
  const basis = job.experience_basis === "title" ? " (from title)" : "";
  return `${job.experience}${basis} · ${LABEL_TEXT[job.label]}`;
}

/** One line for a toast: the server's message is already user-facing. */
export function failureLine(error: unknown): string {
  if (isApiError(error) && error.message.trim()) return error.message;
  return "Something went wrong. Please try again.";
}
