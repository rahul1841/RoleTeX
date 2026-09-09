import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { isApiError } from "@/lib/api/errors";

/**
 * Routing a server failure to the right place on a form.
 *
 * The backend already decides which of these is a field problem and which is a
 * whole-request problem, and it says so with `detail.code`. So the forms do not
 * guess: each one declares a small map from code to field name, and anything
 * not in its map is a form-level failure that <ErrorState> renders in full —
 * message, per-field notes, status and code.
 *
 * The one rule worth stating out loud: `invalid_credentials` is never mapped to
 * a field. The server returns the same error for an unknown address and a wrong
 * password on purpose, and attaching it to the email input would undo that by
 * telling an attacker which half was wrong.
 */

/** `detail.code` for anything the API client threw, else null. */
export function apiErrorCode(error: unknown): string | null {
  return isApiError(error) ? error.code : null;
}

/**
 * Attach a server error to a form field when the code names one.
 *
 * Returns false when the caller must surface it as a form-level failure
 * instead — which includes every non-API error (a network drop, a timeout),
 * because none of those are any single field's fault.
 *
 * `shouldFocus` moves focus to the offending input, matching what
 * react-hook-form already does for client-side validation, so a submit that
 * fails for either reason leaves the caret in the same place.
 */
export function applyApiFieldError<TFieldValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TFieldValues>,
  fieldForCode: Partial<Record<string, Path<TFieldValues>>>,
): boolean {
  if (!isApiError(error)) return false;

  const field = fieldForCode[error.code];
  if (!field) return false;

  setError(
    field,
    { type: "server", message: error.message },
    { shouldFocus: true },
  );
  return true;
}
