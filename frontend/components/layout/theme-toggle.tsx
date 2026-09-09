"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * True only after hydration.
 *
 * `useSyncExternalStore` is the supported way to ask "am I on the client yet":
 * it returns the server snapshot (false) during SSR and the first hydration
 * pass, then the client snapshot (true). A `useState` + `useEffect` flag does
 * the same thing but sets state inside an effect, which triggers an avoidable
 * cascading render.
 */
const subscribeToNothing = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function useHydrated() {
  return React.useSyncExternalStore(
    subscribeToNothing,
    getClientSnapshot,
    getServerSnapshot,
  );
}

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

/**
 * Light / dark / system switch for the header.
 *
 * Three explicit choices rather than a two-state flip, because "system" is the
 * default and a flip would silently strand the user on whichever mode they last
 * pressed even after their OS changed.
 *
 * The control is withheld until `useHydrated()` says the client has taken over.
 * On the server — and in the prerendered HTML that `output: "export"` ships —
 * there is no way to know the stored or system preference, so rendering the
 * resolved icon during hydration would mismatch the DOM next-themes has already
 * corrected. A same-sized placeholder holds the space so the header does not
 * shift when the real button arrives.
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();

  if (!hydrated) {
    return <div aria-hidden="true" className="size-7" />;
  }

  const Icon = resolvedTheme === "dark" ? MoonIcon : SunIcon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" />}
        aria-label={`Theme: ${theme ?? "system"}`}
      >
        <Icon aria-hidden="true" />
      </DropdownMenuTrigger>
      {/* The shared content style sizes menus to their trigger, which for an
          icon button is 28px. Width has to be set explicitly here. */}
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={theme ?? "system"}
          onValueChange={(value) => setTheme(String(value))}
        >
          {THEMES.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon aria-hidden="true" />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
