/**
 * Session, account, and server-mode endpoints.
 *
 * Thin typed wrappers over `api.*` — no caching or React here, so they stay
 * usable from anywhere and easy to test. Caching lives in the hooks.
 */

import { api } from "../client";
import type {
  ChangePasswordRequest,
  DeleteMeRequest,
  ForgotPasswordRequest,
  HealthResponse,
  LoginRequest,
  MailDispatchResponse,
  OkResponse,
  RegisterRequest,
  ResetPasswordRequest,
  RevokedResponse,
  SessionListResponse,
  UpdateMeRequest,
  UserResponse,
  VerifyEmailRequest,
} from "../types";

/**
 * Unauthenticated. Reports `mode` ("demo" | "multi_user"), which decides
 * whether accounts and storage exist at all, plus a per-subsystem check map.
 */
export const getHealth = () => api.get<HealthResponse>("/api/health");

/**
 * The signed-in user. Returns 401 `not_authenticated` when signed out, which
 * is a normal state rather than an error — see `useSession`.
 */
export const getMe = () => api.get<UserResponse>("/api/me");

export const login = (body: LoginRequest) =>
  api.post<UserResponse>("/api/auth/login", body);

export const register = (body: RegisterRequest) =>
  api.post<UserResponse>("/api/auth/register", body);

export const logout = () => api.post<OkResponse>("/api/auth/logout");

export const updateMe = (body: UpdateMeRequest) =>
  api.patch<UserResponse>("/api/me", body);

/** Deletes the account. Requires the current password in the request body. */
export const deleteMe = (body: DeleteMeRequest) =>
  api.delete<OkResponse>("/api/me", body);

export const changePassword = (body: ChangePasswordRequest) =>
  api.post<OkResponse>("/api/auth/password", body);

export const forgotPassword = (body: ForgotPasswordRequest) =>
  api.post<MailDispatchResponse>("/api/auth/password/forgot", body);

export const resetPassword = (body: ResetPasswordRequest) =>
  api.post<OkResponse>("/api/auth/password/reset", body);

export const requestVerification = () =>
  api.post<MailDispatchResponse>("/api/auth/verify/request");

export const confirmVerification = (body: VerifyEmailRequest) =>
  api.post<UserResponse>("/api/auth/verify/confirm", body);

export const listSessions = () =>
  api.get<SessionListResponse>("/api/sessions");

export const revokeSession = (sessionId: string) =>
  api.delete<RevokedResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`);

export const revokeOtherSessions = () =>
  api.delete<RevokedResponse>("/api/sessions");
