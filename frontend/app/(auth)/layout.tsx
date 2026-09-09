import { AuthShell } from "@/components/auth";

/**
 * Everything a signed-out user can reach: /sign-in, /register,
 * /forgot-password, /reset-password and /verify-email.
 *
 * The group exists because <AppShell> redirects exactly this state away — a
 * sign-in page rendered inside it would bounce the user to itself. `(auth)`
 * adds no URL segment, so these are top-level routes.
 *
 * Kept a server component so each page can export its own `metadata`; the
 * interactive frame is <AuthShell>, which is the client boundary and which
 * owns the `<main id="main-content">` that the skip link in app/layout.tsx
 * targets.
 */
export default function AuthGroupLayout({ children }: LayoutProps<"/">) {
  return <AuthShell>{children}</AuthShell>;
}
