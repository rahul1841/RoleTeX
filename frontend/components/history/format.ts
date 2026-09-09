/**
 * Presentation helpers for run history.
 *
 * Everything here is pure and runs in the browser only — the history screen is
 * client-rendered because it reads `?run=` — so `Intl` may use the viewer's
 * locale without risking a hydration mismatch against prerendered HTML.
 */

const RELATIVE_UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] =
  [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

export interface RunTimestamp {
  /** "3 hours ago". Shown in the list, where space is scarce. */
  relative: string;
  /** "9 Sep 2026, 22:14". The `title`/`dateTime` a relative label needs. */
  absolute: string;
  /** ISO string for <time dateTime>, or undefined when unparseable. */
  iso?: string;
}

/**
 * Both readings of a run's timestamp.
 *
 * `created_at` is optional in the schema and the server may return null for a
 * legacy document, so this never assumes a valid date.
 */
export function formatRunTimestamp(value: string | null | undefined): RunTimestamp {
  if (!value) return { relative: "Unknown time", absolute: "Unknown time" };
  const parsed = new Date(value);
  const time = parsed.getTime();
  if (Number.isNaN(time)) {
    return { relative: "Unknown time", absolute: value };
  }

  const absolute = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);

  const seconds = Math.round((time - Date.now()) / 1000);
  const magnitude = Math.abs(seconds);
  const relativeFormat = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });

  let relative = relativeFormat.format(0, "second");
  if (magnitude >= 30) {
    const unit = RELATIVE_UNITS.find(([, size]) => magnitude >= size);
    relative = unit
      ? relativeFormat.format(Math.round(seconds / unit[1]), unit[0])
      : relativeFormat.format(seconds, "second");
  }

  return { relative, absolute, iso: parsed.toISOString() };
}

/** "openai · gpt-4.1-mini", collapsing whichever half the server left blank. */
export function formatEngine(provider: string, model: string): string {
  const parts = [provider.trim(), model.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Unknown model";
}

export function formatPageCount(pageCount: number | null | undefined): string | null {
  if (typeof pageCount !== "number" || pageCount <= 0) return null;
  return pageCount === 1 ? "1 page" : `${pageCount} pages`;
}

/** "12.4 KB" — used to say how much LaTeX a run is carrying before it renders. */
export function formatByteSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\n$/, "").split("\n").length;
}

/** What the run was tailored against, for a one-line summary. */
export function describeTarget(
  jdTitle: string | null | undefined,
  jdExcerpt: string,
): string {
  const title = jdTitle?.trim();
  if (title) return title;
  const firstLine = jdExcerpt.trim().split("\n")[0]?.trim();
  if (firstLine) {
    return firstLine.length > 90 ? `${firstLine.slice(0, 90)}…` : firstLine;
  }
  return "Pasted job description";
}
