/**
 * The auth feature's public surface.
 *
 * This barrel is for consumers OUTSIDE app/(auth): the application layout
 * mounts <AuthRuntime>, and Settings needs <ResendVerification> for the action
 * the global "verify your email" banner points at.
 *
 * The (auth) pages import their own form directly instead of going through
 * here. A barrel re-export of a client component is a reference the bundler
 * has to keep, so routing five one-form pages through one index would put all
 * five forms in every one of their chunks.
 */
export { AuthRuntime } from "./auth-runtime";
export { AuthShell } from "./auth-shell";
export { ResendVerification } from "./resend-verification";
export {
  TOKEN_ROUTES,
  legacyHashRoute,
  tokenFromFragment,
  tokenLinkHref,
  type TokenRoute,
} from "./token-link";
