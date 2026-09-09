import type { NextConfig } from "next";

/**
 * Two shapes from one config.
 *
 * PRODUCTION (`next build`): `output: "export"` emits a static `out/` tree that
 * the existing FastAPI container serves. No Node process ships — the Hugging
 * Face Space exposes a single port and runs one command (uvicorn), so a Node
 * runtime alongside it is not an option.
 *
 * DEVELOPMENT (`next dev`): `output` is left unset so `rewrites` works. Next
 * rejects rewrites under `output: "export"` *and errors in dev too*, so the
 * export mode cannot be set unconditionally.
 *
 * The dev rewrite is what keeps the browser on ONE origin. The backend's CSRF
 * check (app/security.py origin_allowed) compares the request's `Origin`
 * against `X-Forwarded-Host`/`Host`, and the session cookie is HttpOnly and
 * host-only. Proxying /api through :3000 means Origin and host agree and the
 * cookie is first-party, so no CORS middleware and no SameSite=None downgrade
 * is needed anywhere.
 */
const isProd = process.env.NODE_ENV === "production";

// Where the FastAPI dev server listens. Only used by the dev rewrite.
const API_ORIGIN = process.env.API_PROXY_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  ...(isProd ? { output: "export" as const } : {}),

  // Emitting `/tailor/index.html` rather than `/tailor.html` lets FastAPI's
  // StaticFiles serve the tree with a directory-index lookup.
  trailingSlash: true,

  // Next blocks cross-origin access to dev-only resources (/_next/hmr) by
  // default, so opening the app at 127.0.0.1 instead of localhost silently
  // loses hot reload. Both spellings reach the same dev server here.
  // Dev-only: this key has no effect on `next build`.
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // Without this, `trailingSlash` also applies to the /api rewrite and Next
  // answers every API call with a 308 to `/api/<path>/` before the request
  // ever reaches FastAPI (verified: `curl -i localhost:3000/api/health` ->
  // "308 Permanent Redirect, location: /api/health/"). FastAPI's routes are
  // declared without trailing slashes, so the redirect target 404s.
  skipTrailingSlashRedirect: true,

  ...(isProd
    ? {}
    : {
        async rewrites() {
          return [
            { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
          ];
        },
      }),
};

export default nextConfig;
