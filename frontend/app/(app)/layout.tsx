import { AuthRuntime } from "@/components/auth";
import { AppShell } from "@/components/layout";

/**
 * Everything inside this route group renders in the application shell: header,
 * navigation, global banners, and the boot/mode gating in <AppShell>.
 *
 * The group exists so the auth routes (/sign-in, /register, /forgot-password,
 * /reset-password, /verify-email) can live outside it — those must render for a
 * signed-out user, which is exactly the state this shell redirects away from.
 * They are in app/(auth)/, which has its own layout and its own <main>.
 *
 * `(app)` adds no URL segment, so this layout's route is still "/".
 *
 * <AuthRuntime> renders nothing. It is mounted here, and only here, because
 * this is the narrowest scope that covers both of the things it does:
 *
 *  - It is the sole owner of `setSessionLostHandler()` from lib/api/client.ts,
 *    a single module-level slot that a second mount would silently steal. A
 *    session can only be lost by a request that carried one, and every screen
 *    that makes such a request is inside this group.
 *  - It rewrites the legacy `/#/reset-password?token=…` links the backend has
 *    already emailed onto their real routes. Those links resolve to "/", which
 *    is this group's own index, and they must be caught before <AppShell>
 *    redirects the signed-out visitor to /sign-in and drops the token.
 *
 * It is a sibling of <AppShell> rather than a child so it is not inside the
 * <main> landmark, and so the shell's own tree is untouched.
 *
 * Kept a server component: it holds no state, and the client boundaries are
 * <AppShell> and <AuthRuntime>.
 */
export default function AppGroupLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <AuthRuntime />
      <AppShell>{children}</AppShell>
    </>
  );
}
