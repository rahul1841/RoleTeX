import { isApiError } from "@/lib/api/errors";

/**
 * Turning a JD failure into words that name the next step.
 *
 * `<ErrorState>` already renders the server's own `message`, its field errors,
 * and the status/code line. What it cannot know is the heading — "That did not
 * work" is true of every failure and useful for none — or what the user should
 * do next. This maps `detail.code` onto both.
 *
 * The two quota codes are the reason this file exists. A 409 is not a
 * transient failure: retrying it will fail identically forever, and rendering
 * it with a Try-again button (which is what a generic error surface does)
 * teaches the user to hammer a request that can never succeed. Naming it as a
 * full library, and saying that deleting something is the fix, is the whole
 * difference between a dead end and an instruction.
 */
export interface JdFailureCopy {
  /** Heading for <ErrorState title=…>. */
  title: string;
  /** What to do about it. Null when the server's own message already says. */
  hint: string | null;
  /**
   * False when retrying cannot possibly help — quotas, validation, a deleted
   * record. Callers use it to decide whether to offer a retry at all.
   */
  retryable: boolean;
}

const FALLBACK: JdFailureCopy = {
  title: "That did not work",
  hint: null,
  retryable: true,
};

export function describeJdFailure(
  error: unknown,
  fallbackTitle?: string,
): JdFailureCopy {
  if (!isApiError(error)) {
    return fallbackTitle ? { ...FALLBACK, title: fallbackTitle } : FALLBACK;
  }

  switch (error.code) {
    case "jd_quota_exceeded":
      return {
        title: "Your job description library is full",
        hint: "This server caps how many job descriptions one account can store. Delete one you no longer tailor against, then save this again.",
        retryable: false,
      };

    // Not currently emitted by the JD routes — backend/app/db.py prunes the oldest
    // archived revisions instead of refusing the write — but the code is in
    // the API's error contract, so it is handled rather than falling through
    // to a generic 409.
    case "version_quota_exceeded":
      return {
        title: "This job description has too many versions",
        hint: "Its version history is full. Delete the job description and save the new text as a fresh one to keep editing.",
        retryable: false,
      };

    case "request_too_large":
      return {
        title: "That paste is too large to send",
        hint: "The server rejects any request body over 64 KB before it even reads it. Shorten the job description — the essential requirements and responsibilities are what tailoring uses.",
        retryable: false,
      };

    case "jd_not_found":
      return {
        title: "That job description no longer exists",
        hint: "It was deleted, or the link points at something that was never in your library.",
        retryable: false,
      };

    case "nothing_to_update":
      return {
        title: "Nothing to save",
        hint: "Change the title or the text before saving.",
        retryable: false,
      };

    case "invalid_request":
      return {
        title: "Some fields need attention",
        hint: null,
        retryable: false,
      };

    case "database_unavailable":
    case "database_not_configured":
      return {
        title: "The job description library is unavailable",
        hint: null,
        retryable: true,
      };

    case "email_verification_required":
      return {
        title: "Verify your email first",
        hint: "This server requires a confirmed email address before you can save anything.",
        retryable: false,
      };

    case "not_authenticated":
      return {
        title: "Your session ended",
        hint: "Sign in again to reach your job descriptions.",
        retryable: false,
      };

    default:
      if (error.isRateLimited) {
        return {
          title: "Too many requests",
          hint: null,
          // <ErrorState> disables its own retry and counts down off
          // `Retry-After`, so offering the button is correct here.
          retryable: true,
        };
      }
      return fallbackTitle ? { ...FALLBACK, title: fallbackTitle } : FALLBACK;
  }
}

/**
 * One line for a toast, where there is no room for a heading and a hint.
 *
 * Prefers the server's own message — it is already user-facing and usually
 * more specific than anything generic ("You already have 50 saved job
 * descriptions") — and falls back to the mapped hint only when there is none.
 */
export function jdFailureLine(error: unknown): string {
  if (isApiError(error) && error.message.trim()) return error.message;
  const { hint, title } = describeJdFailure(error);
  return hint ?? title;
}
