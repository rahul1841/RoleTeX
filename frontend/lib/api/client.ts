/**
 * The one place this app talks to FastAPI.
 *
 * ORIGIN: every request uses a same-origin relative path (`/api/...`). In dev,
 * next.config.ts rewrites `/api/*` to the uvicorn dev server; in production the
 * same FastAPI process serves both the static export and the API. Keeping one
 * origin is what lets the backend's HttpOnly session cookie and its
 * Origin-equals-host CSRF check (backend/app/security.py `origin_allowed`) work with no
 * CORS middleware and no SameSite downgrade. Do not introduce absolute API URLs.
 *
 * CREDENTIALS: `same-origin` attaches the `rt_session` cookie. The cookie is
 * HttpOnly, so no code here can read it — sign-in state comes from `GET /api/me`.
 */

import { ApiError, parseApiError } from "./errors";

/**
 * Tailoring runs an LLM call plus a Tectonic compile server-side and
 * legitimately takes minutes; a shorter timeout would abort work the server is
 * still doing, after the provider tokens have already been spent.
 */
export const LONG_REQUEST_TIMEOUT_MS = 180_000;

/** Everything else should be fast; failing sooner surfaces problems earlier. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Serialized as JSON. Mutually exclusive with `formData`. */
  body?: unknown;
  /** Sent as multipart/form-data. The browser sets the boundary itself. */
  formData?: FormData;
  timeoutMs?: number;
  /** Caller-supplied signal, merged with the timeout signal. */
  signal?: AbortSignal;
}

/** Notified whenever a request fails because the session is gone. */
type SessionLostHandler = () => void;
let onSessionLost: SessionLostHandler | null = null;

/**
 * Register the app-wide reaction to an expired or revoked session.
 *
 * Set once, from the auth provider. Keeping it here means every caller gets
 * the redirect-to-sign-in behavior without repeating a 401 check.
 */
export function setSessionLostHandler(handler: SessionLostHandler | null): void {
  onSessionLost = handler;
}

function mergeSignals(
  timeoutSignal: AbortSignal,
  caller?: AbortSignal,
): AbortSignal {
  if (!caller) return timeoutSignal;
  // AbortSignal.any is available in every browser Next 16 targets.
  return AbortSignal.any([timeoutSignal, caller]);
}

/**
 * Perform one API call and return the parsed JSON body.
 *
 * Throws `ApiError` for any non-2xx response, for a network failure, and for a
 * timeout — so callers (and TanStack Query) only ever handle one error type.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    formData,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = options;

  if (body !== undefined && formData) {
    throw new Error("apiRequest: pass either `body` or `formData`, not both");
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  const headers: Record<string, string> = { Accept: "application/json" };

  let payload: BodyInit | undefined;
  if (formData) {
    // Deliberately no Content-Type: fetch must set the multipart boundary.
    payload = formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: payload,
      credentials: "same-origin",
      signal: mergeSignals(timeout, signal),
    });
  } catch (cause) {
    // A caller-initiated abort is not an error condition — let it propagate so
    // TanStack Query treats it as a cancellation rather than a failure.
    if (signal?.aborted) throw cause;
    if (timeout.aborted) {
      throw new ApiError({
        status: 0,
        code: "timeout",
        message: "The server took too long to respond. Please try again.",
      });
    }
    throw new ApiError({
      status: 0,
      code: "network_error",
      message: "Could not reach the server. Check your connection and try again.",
    });
  }

  if (!response.ok) {
    const error = await parseApiError(response);
    if (error.isSessionLost) onSessionLost?.();
    throw error;
  }

  // 204 and other empty successes.
  if (response.status === 204 || response.headers.get("Content-Length") === "0") {
    return undefined as T;
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** Convenience wrappers. Every call in the app should go through one of these. */
export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "GET" }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "POST", body }),

  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "PUT", body }),

  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "PATCH", body }),

  // A body is optional but real: `DELETE /api/me` requires the current
  // password in the body before it will delete the account.
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "DELETE", body }),

  /** Multipart upload (PDF import). */
  upload: <T>(path: string, formData: FormData, options?: Omit<RequestOptions, "method" | "body" | "formData">) =>
    apiRequest<T>(path, {
      ...options,
      method: "POST",
      formData,
      timeoutMs: options?.timeoutMs ?? LONG_REQUEST_TIMEOUT_MS,
    }),
};
