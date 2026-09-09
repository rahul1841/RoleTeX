/**
 * The three separate ceilings a pasted job description has to clear, and the
 * arithmetic for staying under them.
 *
 * They are enforced at different layers of the backend and they fail
 * differently, which is why the UI treats them as three things rather than one
 * "too long" state:
 *
 *  1. CONTENT CHARACTERS — `JdCreateRequest.content` is
 *     `Field(min_length=50, max_length=20_000)` in app/schemas.py. Over it,
 *     Pydantic answers 422 `invalid_request` with
 *     "content: String should have at most 20000 characters".
 *  2. TITLE CHARACTERS — the same file, `min_length=1, max_length=160`.
 *  3. REQUEST BYTES — `MAX_HTTP_BODY_BYTES` in app/main.py, enforced by
 *     `BodySizeLimitMiddleware` at the raw ASGI layer. This one runs BELOW
 *     routing and BELOW authentication: an oversized paste is answered 413
 *     `request_too_large` before FastAPI has looked at the session cookie, so
 *     it cannot be reported as a field error and it does not care that the
 *     user is signed in. Verified against the running server — a 70,033-byte
 *     body returns 413 with and without a session.
 *
 * (1) and (3) are genuinely independent. 20,000 ASCII characters is ~20 KB and
 * nowhere near the byte cap, but 20,000 CJK characters is ~60 KB, and JSON
 * escaping inflates newlines and quotes further — so a paste can be inside the
 * character limit and still be refused for its size. The form checks both.
 */

/** app/schemas.py `JdCreateRequest.title`. */
export const JD_TITLE_MAX = 160;

/** app/schemas.py `JdCreateRequest.content`. */
export const JD_CONTENT_MIN = 50;
export const JD_CONTENT_MAX = 20_000;

/** app/main.py `MAX_HTTP_BODY_BYTES`. */
export const JD_MAX_REQUEST_BYTES = 64_000;

/** Where the counter turns advisory rather than neutral. */
export const JD_CONTENT_WARN_AT = Math.floor(JD_CONTENT_MAX * 0.9);
export const JD_REQUEST_BYTES_WARN_AT = Math.floor(JD_MAX_REQUEST_BYTES * 0.9);

/**
 * UTF-8 byte length.
 *
 * `String.length` counts UTF-16 code units and is not the number the ASGI
 * middleware counts; anything outside the Basic Multilingual Plane, and every
 * accented or non-Latin character, weighs more on the wire than in the
 * textarea. One encoder is reused because this runs on every keystroke.
 */
const encoder = new TextEncoder();

export function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

/**
 * How many bytes the request for this payload will actually put on the wire.
 *
 * Measured on the serialized JSON rather than estimated from the text, because
 * `JSON.stringify` is what the API client sends and it is the escaping — `\n`
 * for every newline, `\"` for every quote — that closes the gap between a
 * comfortable-looking paste and the cap.
 */
export function requestBytes(body: unknown): number {
  return utf8Bytes(JSON.stringify(body));
}

export type LimitLevel = "ok" | "near" | "over";

export interface JdSizeReport {
  characters: number;
  bytes: number;
  charactersLevel: LimitLevel;
  bytesLevel: LimitLevel;
  /** True when this payload would be refused by the server as it stands. */
  blocked: boolean;
  /** One sentence naming the binding limit, or null while everything fits. */
  advisory: string | null;
}

function level(value: number, warnAt: number, max: number): LimitLevel {
  if (value > max) return "over";
  if (value >= warnAt) return "near";
  return "ok";
}

const decimal = new Intl.NumberFormat("en-US");

/** Digit grouping, so 18220 reads as 18,220 in a counter. */
export function formatNumber(value: number): string {
  return decimal.format(value);
}

/**
 * Measure a draft against all three limits at once.
 *
 * `body` is the exact object the mutation will send, so the byte figure is the
 * real one — an edit that changes only the title is measured as the small
 * request it will be, not as if the whole JD were being re-sent.
 */
export function measureJd(content: string, body: unknown): JdSizeReport {
  const characters = content.length;
  const bytes = requestBytes(body);
  const charactersLevel = level(characters, JD_CONTENT_WARN_AT, JD_CONTENT_MAX);
  const bytesLevel = level(bytes, JD_REQUEST_BYTES_WARN_AT, JD_MAX_REQUEST_BYTES);

  let advisory: string | null = null;
  if (charactersLevel === "over") {
    advisory = `This job description is ${formatNumber(
      characters - JD_CONTENT_MAX,
    )} characters over the ${formatNumber(JD_CONTENT_MAX)}-character limit. Trim it before saving.`;
  } else if (bytesLevel === "over") {
    // Reachable inside the character limit with non-Latin text.
    advisory = `This request would be ${formatNumber(
      bytes,
    )} bytes, over the server's ${formatNumber(
      JD_MAX_REQUEST_BYTES,
    )}-byte cap. Shorten the text — the limit counts encoded bytes, so accented and non-Latin characters cost more than one each.`;
  } else if (charactersLevel === "near") {
    advisory = `Approaching the ${formatNumber(
      JD_CONTENT_MAX,
    )}-character limit — ${formatNumber(JD_CONTENT_MAX - characters)} left.`;
  } else if (bytesLevel === "near") {
    advisory = `Approaching the server's ${formatNumber(
      JD_MAX_REQUEST_BYTES,
    )}-byte request cap — ${formatNumber(JD_MAX_REQUEST_BYTES - bytes)} bytes left.`;
  }

  return {
    characters,
    bytes,
    charactersLevel,
    bytesLevel,
    blocked: charactersLevel === "over" || bytesLevel === "over",
    advisory,
  };
}

const kilobytes = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

/**
 * Byte counts at the scale this form deals in.
 *
 * KB here is 1,000 bytes, not 1,024, because the server's own message says
 * "exceeds the 64 KB safety limit" for a 64,000-byte cap — showing the user
 * 62.5 KB next to a limit the server calls 64 KB would be a needless puzzle.
 */
export function formatBytes(value: number): string {
  if (value < 1_000) return `${formatNumber(value)} B`;
  return `${kilobytes.format(value / 1_000)} KB`;
}
