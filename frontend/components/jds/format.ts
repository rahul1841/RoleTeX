/**
 * Date formatting for the JD library.
 *
 * Kept local to this feature rather than added to `lib/` because several
 * agents are building screens in parallel and a shared date module is exactly
 * the kind of file two of them would create at once. If Resumes and History
 * end up wanting the same three functions, hoisting them is a five-minute job
 * and the right one to do afterwards, not now.
 *
 * The API returns ISO-8601 in UTC (`2026-09-09T22:14:05.664000Z`), sometimes
 * null. Everything here is null-tolerant and returns a placeholder rather than
 * "Invalid Date", because a stored record with no timestamp is a real state on
 * this backend, not a bug worth showing the user.
 */

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

/** Full local date and time. Used for `title`/tooltip text under a relative one. */
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

/**
 * "3 minutes ago", "last week", "just now".
 *
 * Relative is the right default for a library the user edits: "2 hours ago"
 * answers "is this the one I just pasted?" without any arithmetic. The exact
 * timestamp stays available as a `title` on every element that shows one, so
 * nothing is actually hidden.
 */
export function formatRelative(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return PLACEHOLDER;

  const elapsed = date.getTime() - Date.now();
  const magnitude = Math.abs(elapsed);

  for (const [unit, ms] of UNITS) {
    if (magnitude >= ms) {
      return relative.format(Math.round(elapsed / ms), unit);
    }
  }
  return "just now";
}

/** app/routes_jds.py `EXCERPT_LENGTH`. */
const EXCERPT_LENGTH = 160;

/**
 * The same excerpt the server derives for a list row or a version entry:
 * whitespace collapsed to single spaces, then the first 160 characters.
 *
 * Reimplemented here for one reason — the version trail shows archived
 * revisions as excerpts because that is all the API returns for them, and the
 * *current* revision has to appear in the same trail. Deriving it the same way
 * means the newest entry is comparable with the ones under it instead of being
 * the only one showing full text.
 */
export function serverExcerpt(content: string): string {
  return content.split(/\s+/).filter(Boolean).join(" ").slice(0, EXCERPT_LENGTH);
}
