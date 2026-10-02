/**
 * Date rendering for the settings screen.
 *
 * Everything here runs on the client only — the values come from queries, and
 * `output: "export"` prerenders these pages with no data at all — so locale
 * formatting cannot produce a server/client mismatch.
 */

/** "9 Sep 2026, 22:13". Empty string for a missing timestamp. */
export function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** "3 minutes ago" / "in 29 days". Empty string for a missing timestamp. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const delta = date.getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const [unit, milliseconds] of RELATIVE_UNITS) {
    if (Math.abs(delta) >= milliseconds) {
      return formatter.format(Math.round(delta / milliseconds), unit);
    }
  }
  return formatter.format(Math.round(delta / 1000), "second");
}
