import { z } from "zod";

/**
 * Client-side validation, kept deliberately thin.
 *
 * The server owns both rules that matter. `backend/app/security.py` decides what a
 * valid address is and what a strong enough password is, and it reports both
 * as structured errors (`invalid_email`, `weak_password`) with a message
 * written for a human. Restating the password policy here would create a
 * second copy that silently drifts the day `PASSWORD_MIN_LENGTH` changes and,
 * worse, would reject passwords the server would have accepted.
 *
 * So passwords are only ever checked for "you left this blank". The address is
 * checked against the SAME expression the server uses, which is not a second
 * policy — it is the first one, applied a round trip earlier. That matters on
 * sign-in specifically: a typo'd address would otherwise cost a real attempt
 * against the per-(email, IP) login throttle in backend/app/auth.py before the user is
 * told anything.
 */

/** Mirrors `_EMAIL_RE` in backend/app/security.py. Keep the two identical. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Mirrors `EMAIL_MAX_LENGTH`; the field is `max_length=254` in Pydantic too. */
const EMAIL_MAX_LENGTH = 254;

export const emailField = z
  .string()
  .trim()
  .min(1, "Enter your email address")
  .max(EMAIL_MAX_LENGTH, "That email address is too long")
  .regex(EMAIL_PATTERN, "Enter a valid email address");

/** "Required" and nothing else — the server judges strength. */
export function passwordField(message: string) {
  return z.string().min(1, message);
}

/** Optional display name. The server trims it and caps it at 160. */
export const nameField = z
  .string()
  .trim()
  .max(160, "That name is too long")
  .optional();
