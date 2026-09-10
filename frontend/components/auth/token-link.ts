/**
 * One-time account links, and why the token lives in the URL fragment.
 *
 * `_token_link()` in backend/app/routes_account.py emails links of this shape:
 *
 *     https://host/reset-password/#token=<one-time token>
 *
 * The token sits in the FRAGMENT, and that is the security property this
 * module exists to preserve: a fragment is never put on the wire. It is not in
 * the request line, so it cannot reach an access log, a reverse proxy log, or
 * an analytics pipeline; and it is stripped from the `Referer` header of any
 * request the page makes afterwards, so a third-party script or an image on
 * the reset page cannot exfiltrate it. Moving the token to a real query string
 * would leak a live password-reset credential into every one of those places.
 *
 * Two shapes are accepted, and both keep the token in the fragment:
 *
 *   CURRENT  /reset-password/#token=ABC      a real route, token in the hash
 *   LEGACY   /#/reset-password?token=ABC     what the server emitted before
 *                                            2026-09-10, when the UI was a
 *                                            hash-routed single page
 *
 * The legacy shape lands on "/" as far as the server and the router are
 * concerned, so <AuthRuntime> rewrites it to the current shape client-side (see
 * auth-runtime.tsx). That rewrite is transitional: reset tokens live at most
 * 24 hours and verification tokens at most 7 days (the `PASSWORD_RESET_TTL_MINUTES`
 * / `EMAIL_VERIFY_TTL_HOURS` bounds in backend/app/config.py), so once a week has
 * passed since the server stopped emitting them, `legacyHashRoute` and
 * `useLegacyTokenLinkRedirect` can both be deleted.
 *
 * The pages themselves only ever read the fragment, never `useSearchParams()`,
 * so a token can never be promoted into the query string by accident.
 *
 * Everything here is pure string work on purpose: no `window`, so it is
 * callable during render, from a server component, and from a test.
 */

/** The two routes the backend can email a one-time link for. */
export const TOKEN_ROUTES = ["/reset-password", "/verify-email"] as const;

export type TokenRoute = (typeof TOKEN_ROUTES)[number];

/** `location.hash` includes the "#"; a hand-written fragment may not. */
function withoutLeadingHash(hash: string): string {
  return hash.startsWith("#") ? hash.slice(1) : hash;
}

/**
 * The token carried by a URL fragment, in either shape.
 *
 * Both `#token=ABC` and `#/reset-password?token=ABC` reduce to the same
 * `token=ABC` query fragment once anything before a "?" is dropped, so one
 * `URLSearchParams` parse handles both — including a legacy link that has
 * picked up a trailing slash or extra parameters on its way through a mail
 * client.
 *
 * Returns null rather than an empty string so callers can branch on presence
 * with a plain truthiness check.
 */
export function tokenFromFragment(hash: string): string | null {
  const fragment = withoutLeadingHash(hash);
  if (!fragment) return null;

  const queryStart = fragment.indexOf("?");
  const query = queryStart >= 0 ? fragment.slice(queryStart + 1) : fragment;

  // URLSearchParams percent-decodes for us. The server's tokens are
  // `secrets.token_urlsafe`, i.e. [A-Za-z0-9_-], so nothing is actually
  // encoded in practice — but a mail client that rewrites the link should not
  // be able to break redemption.
  const token = new URLSearchParams(query).get("token")?.trim();
  return token ? token : null;
}

/**
 * The account route a LEGACY hash link is asking for, or null.
 *
 * Only a fragment that starts with "/" is a legacy route — that is what
 * distinguishes `#/verify-email?token=ABC` from the current `#token=ABC`, and
 * it is what stops this from matching its own output and looping.
 *
 * Anything that is not one of the two known routes returns null and is left
 * alone: an unrecognised hash may belong to an in-page anchor, and hijacking
 * it would be worse than ignoring it.
 */
export function legacyHashRoute(
  hash: string,
): { route: TokenRoute; token: string | null } | null {
  const fragment = withoutLeadingHash(hash);
  if (!fragment.startsWith("/")) return null;

  const queryStart = fragment.indexOf("?");
  const rawPath = queryStart >= 0 ? fragment.slice(0, queryStart) : fragment;
  // Tolerate "/reset-password/" as well as "/reset-password".
  const path =
    rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;

  const route = TOKEN_ROUTES.find((candidate) => candidate === path);
  if (!route) return null;

  return { route, token: tokenFromFragment(hash) };
}

/**
 * The current URL for an account route, with the token still in the fragment.
 *
 * The trailing slash is not cosmetic: `trailingSlash: true` in next.config.ts
 * makes the static export emit `reset-password/index.html`, and this href is
 * used with `location.replace()` rather than the router, so it has to be the
 * path the server can actually serve.
 */
export function tokenLinkHref(route: TokenRoute, token: string | null): string {
  const fragment = token ? `#token=${encodeURIComponent(token)}` : "";
  return `${route}/${fragment}`;
}
