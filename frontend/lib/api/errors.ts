/**
 * The backend's error contract, mirrored on the client.
 *
 * FastAPI returns errors as `{ detail: ... }`, and this app uses three shapes
 * for `detail`:
 *
 *   1. `{ code, message, ...extra }`  — the canonical structured error, built
 *      by `_api_error()` in app/auth.py. `extra` carries per-error fields such
 *      as `errors` (field messages) or `retry_after`.
 *   2. `ValidationError[]`            — FastAPI's own 422 body, when a request
 *      fails Pydantic validation before reaching route code.
 *   3. `string`                       — Starlette's default for errors raised
 *      outside the app's own helpers (e.g. a bare 404 / 405 from routing).
 *
 * `parseApiError` normalizes all three into one `ApiError`, so callers never
 * branch on the shape.
 */

/** Every `code` the backend can emit, extracted from app/*.py. */
export const API_ERROR_CODES = [
  "account_disabled",
  "already_verified",
  "bad_origin",
  "database_not_configured",
  "database_unavailable",
  "email_taken",
  "email_verification_required",
  "incomplete_resume",
  "invalid_api_key",
  "invalid_credentials",
  "invalid_email",
  "invalid_extraction",
  "invalid_llm_proposal",
  "invalid_pdf",
  "invalid_request",
  "invalid_token",
  "jd_not_found",
  "jd_quota_exceeded",
  "jd_required",
  "key_decrypt_failed",
  "key_not_found",
  "llm_key_required",
  "llm_not_configured",
  "llm_provider_error",
  "mail_not_configured",
  "not_authenticated",
  "nothing_to_update",
  "password_unchanged",
  "pdf_extract_failed",
  "pdf_extract_timeout",
  "pdf_no_text",
  "pdf_support_unavailable",
  "pdf_too_large",
  "pdf_too_many_pages",
  "preview_target_required",
  "provider_required",
  "rate_limited",
  "registration_disabled",
  "render_failed",
  "request_too_large",
  "resume_configuration_error",
  "resume_not_found",
  "resume_quota_exceeded",
  "resume_required",
  "run_has_no_latex",
  "run_not_found",
  "session_not_found",
  "too_many_attempts",
  "too_many_requests",
  "unknown_provider",
  "version_quota_exceeded",
  "weak_password",
  // Compile failures, surfaced from CompileResult rather than _api_error.
  "compile_timeout",
  "compiler_not_found",
  "compiler_start_failed",
  "job_setup_failed",
  "latex_compile_failed",
  "pdf_missing",
  "source_too_large",
  // Client-side only: the request never reached the server.
  "network_error",
  "timeout",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * User-facing copy. The server's own `message` is usually good, but these
 * override it where the raw text is too terse or too technical to show.
 * Anything not listed falls back to the server message.
 */
const ERROR_COPY: Partial<Record<ApiErrorCode, string>> = {
  network_error:
    "Could not reach the server. Check your connection and try again.",
  timeout: "The server took too long to respond. Please try again.",
  not_authenticated: "Please sign in to continue.",
  account_disabled: "This account has been disabled.",
  database_not_configured:
    "This feature needs the database, which is not configured on this server.",
  database_unavailable:
    "The database is temporarily unavailable. Please try again shortly.",
  bad_origin: "The request was blocked for security reasons. Please reload.",
  invalid_credentials: "That email and password combination is not correct.",
  email_verification_required:
    "Verify your email address before using this feature.",
  llm_key_required:
    "Add an API key for this provider in Settings before tailoring.",
  llm_not_configured: "No AI provider is configured yet. Set one up in Settings.",
  key_decrypt_failed:
    "Your stored API key could not be read. Re-enter it in Settings.",
  request_too_large: "That request is too large. Try shortening the text.",
  pdf_too_large: "That PDF is too large.",
  latex_compile_failed: "The resume could not be compiled. See the details below.",
  compile_timeout: "Compiling took too long. Try simplifying the resume.",
};

/** FastAPI's per-field validation entry (shape 2). */
export interface ValidationErrorItem {
  loc?: (string | number)[];
  msg?: string;
  type?: string;
}

/**
 * One normalized API failure.
 *
 * `code` is the machine-readable discriminator to branch on. `message` is
 * always safe to show a user. `fieldErrors` is populated when the backend
 * reported per-field problems, so a form can attach them to inputs.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly fieldErrors: string[];
  /** Seconds to wait, from `detail.retry_after` or the `Retry-After` header. */
  readonly retryAfter: number | null;

  constructor(init: {
    status: number;
    code: ApiErrorCode | string;
    message: string;
    fieldErrors?: string[];
    retryAfter?: number | null;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors ?? [];
    this.retryAfter = init.retryAfter ?? null;
  }

  /** True when the session is gone and the user must sign in again. */
  get isSessionLost(): boolean {
    return (
      (this.status === 401 && this.code === "not_authenticated") ||
      (this.status === 403 && this.code === "account_disabled")
    );
  }

  /** True for the three distinct 429 shapes the backend can return. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

function copyFor(code: string, serverMessage: string): string {
  const override = ERROR_COPY[code as ApiErrorCode];
  if (override) return override;
  if (serverMessage.trim()) return serverMessage;
  return "Something went wrong. Please try again.";
}

function parseRetryAfterHeader(response: Response): number | null {
  const raw = response.headers.get("Retry-After");
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Turn any non-OK response into an `ApiError`.
 *
 * Never throws: a body that is not JSON, or JSON in an unexpected shape, still
 * produces a usable error rather than masking the original failure.
 */
export async function parseApiError(response: Response): Promise<ApiError> {
  const headerRetry = parseRetryAfterHeader(response);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiError({
      status: response.status,
      code: `http_${response.status}`,
      message: copyFor(`http_${response.status}`, response.statusText),
      retryAfter: headerRetry,
    });
  }

  const detail = (body as { detail?: unknown } | null)?.detail;

  // Shape 3: plain string.
  if (typeof detail === "string") {
    return new ApiError({
      status: response.status,
      code: `http_${response.status}`,
      message: copyFor(`http_${response.status}`, detail),
      retryAfter: headerRetry,
    });
  }

  // Shape 2: FastAPI validation array.
  if (Array.isArray(detail)) {
    const fieldErrors = (detail as ValidationErrorItem[])
      .map((item) => {
        const field = item.loc?.filter((p) => p !== "body").join(".");
        return field && item.msg ? `${field}: ${item.msg}` : item.msg;
      })
      .filter((m): m is string => Boolean(m));
    return new ApiError({
      status: response.status,
      code: "invalid_request",
      message: fieldErrors[0] ?? "Some fields need attention.",
      fieldErrors,
      retryAfter: headerRetry,
    });
  }

  // Shape 1: the canonical structured error.
  if (detail && typeof detail === "object") {
    const structured = detail as {
      code?: string;
      message?: string;
      errors?: unknown;
      retry_after?: unknown;
    };
    const code = structured.code ?? `http_${response.status}`;
    const fieldErrors = Array.isArray(structured.errors)
      ? structured.errors.filter((e): e is string => typeof e === "string")
      : [];
    const bodyRetry =
      typeof structured.retry_after === "number" ? structured.retry_after : null;
    return new ApiError({
      status: response.status,
      code,
      message: copyFor(code, structured.message ?? ""),
      fieldErrors,
      // The body value is more precise than the header when both are present.
      retryAfter: bodyRetry ?? headerRetry,
    });
  }

  return new ApiError({
    status: response.status,
    code: `http_${response.status}`,
    message: copyFor(`http_${response.status}`, response.statusText),
    retryAfter: headerRetry,
  });
}

/** Narrowing helper for `catch` blocks and TanStack Query callbacks. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
