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
 * <AuthRuntime> is mounted here and only here: it owns the single
 * `setSessionLostHandler()` slot in lib/api/client.ts.
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
