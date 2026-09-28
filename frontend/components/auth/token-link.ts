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
 * The pages themselves only ever read the fragment, never `useSearchParams()`,
 * so a token can never be promoted into the query string by accident.
 *
 * Pure string work on purpose: no `window`, so it is callable during render,
 * from a server component, and from a test.
 */

/**
 * The token carried by a URL fragment (`#token=ABC`).
 *
 * `URLSearchParams` tolerates a link that has picked up extra parameters on
 * its way through a mail client.
 *
 * Returns null rather than an empty string so callers can branch on presence
 * with a plain truthiness check.
 */
export function tokenFromFragment(hash: string): string | null {
  // `location.hash` includes the "#"; a hand-written fragment may not.
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment) return null;

  // URLSearchParams percent-decodes for us. The server's tokens are
  // `secrets.token_urlsafe`, i.e. [A-Za-z0-9_-], so nothing is actually
  // encoded in practice — but a mail client that rewrites the link should not
  // be able to break redemption.
  const token = new URLSearchParams(fragment).get("token")?.trim();
  return token ? token : null;
}
