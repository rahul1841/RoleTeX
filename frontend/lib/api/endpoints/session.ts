/**
 * Session and account endpoints.
 *
 * Thin typed wrappers over `api.*` — no caching or React here, so they stay
 * usable from anywhere and easy to test. Caching lives in the hooks.
 */

import { api } from "../client";
import type {
  ChangePasswordRequest,
  DeleteMeRequest,
  ForgotPasswordRequest,
  LoginRequest,
  MailDispatchResponse,
  OkResponse,
  RegisterRequest,
  ResetPasswordRequest,
  SignupCodeRequest,
  UpdateMeRequest,
  UserResponse,
  VerifyEmailRequest,
} from "../types";

/**
 * The signed-in user. Returns 401 `not_authenticated` when signed out, which
 * is a normal state rather than an error — see `useSession`.
 */
export const getMe = () => api.get<UserResponse>("/api/me");

export const login = (body: LoginRequest) =>
  api.post<UserResponse>("/api/auth/login", body);

/** Mails a 6-digit sign-up code. Same response for registered addresses. */
export const requestSignupCode = (body: SignupCodeRequest) =>
  api.post<MailDispatchResponse>("/api/auth/register/code", body);

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

/**
 * Redeeming a verification link answers `{"ok": true}` — the route's
 * `response_model` is `OkResponse` and it is deliberately unauthenticated, so
 * it has no user to return. The caller invalidates the session query instead.
 */
export const confirmVerification = (body: VerifyEmailRequest) =>
  api.post<OkResponse>("/api/auth/verify/confirm", body);
