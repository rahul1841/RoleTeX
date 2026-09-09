"use client";

import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isApiError } from "@/lib/api/errors";

const queryConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      // The old client refetched on every view entry and cached nothing. A
      // short stale window keeps navigation feeling instant without showing
      // meaningfully outdated resumes or runs.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (!isApiError(error)) return false;
        // Never retry what will fail identically: auth, validation, missing
        // records, or a rejected origin. Retrying a 429 would also make the
        // rate limit worse rather than better.
        if (error.status >= 400 && error.status < 500) return false;
        // A timeout means the server may still be working; a second request
        // would duplicate expensive LLM and LaTeX work.
        if (error.code === "timeout") return false;
        return failureCount < 2;
      },
    },
    mutations: {
      // Mutations are never retried automatically: every one of them either
      // spends tokens, compiles LaTeX, or changes stored state.
      retry: false,
    },
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  // Created in state so the client is per-browser-session, not module-global —
  // a module-level client would be shared across React roots in dev.
  const [queryClient] = useState(() => new QueryClient(queryConfig));

  return (
    // ThemeProvider is outermost because two consumers below it read the
    // theme: <Toaster> (sonner matches its own surface to it) and the shell's
    // theme toggle.
    //
    // `attribute="class"` toggles `.dark` on <html>, which is what the
    // `@custom-variant dark` in globals.css matches. next-themes inlines a
    // blocking script that applies the stored/system theme before first paint,
    // so there is no light flash — that script is also why <html> carries
    // `suppressHydrationWarning` in app/layout.tsx.
    //
    // `disableTransitionOnChange` suppresses the color transitions on every
    // element while the class flips; without it, switching themes visibly
    // smears across the whole page.
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
      storageKey="roletex-theme"
    >
      <QueryClientProvider client={queryClient}>
        {/* Base UI tooltips need a provider in scope. It lives here rather
            than in the shell so tooltips also work on the auth pages, which
            sit outside the (app) route group. `delay` is the hover dwell
            before opening; 250ms stops tooltips flashing as the pointer
            crosses the nav. */}
        <TooltipProvider delay={250}>
          {children}
          <Toaster richColors closeButton position="top-right" />
        </TooltipProvider>
        {process.env.NODE_ENV === "development" ? (
          <ReactQueryDevtools initialIsOpen={false} />
        ) : null}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
