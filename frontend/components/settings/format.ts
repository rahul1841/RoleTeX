/**
 * Date and user-agent rendering for the settings screen.
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

/**
 * "3 minutes ago" / "in 29 days".
 *
 * Used for the two timestamps a security screen is actually read for — when a
 * session was last seen and when it expires — because "in 29 days" answers the
 * question and an ISO date makes the reader do arithmetic.
 */
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

const BROWSERS: [RegExp, string][] = [
  [/\bEdg\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bFirefox\//, "Firefox"],
  [/\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
  [/\bcurl\//, "curl"],
  [/\bWget\//, "Wget"],
  [/\bPostman/, "Postman"],
];

const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bWindows NT\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

/**
 * A best-effort "Chrome on macOS" from a user-agent string.
 *
 * Deliberately a GUESS and treated as one by the caller, which always renders
 * the raw string alongside it. User agents are self-reported and freely
 * spoofed, so on a screen whose job is to help someone recognise an
 * unrecognised session, silently replacing the evidence with a tidy label
 * would remove the only thing they can actually compare.
 */
export function describeUserAgent(userAgent: string): string {
  const raw = userAgent.trim();
  if (!raw) return "Unknown client";

  const browser = BROWSERS.find(([pattern]) => pattern.test(raw))?.[1];
  const platform = PLATFORMS.find(([pattern]) => pattern.test(raw))?.[1];

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  return "Unknown client";
}
