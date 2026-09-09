"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { cn } from "cn";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const THEMES = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
] as const;

/**
 * True only after hydration.
 *
 * `useSyncExternalStore` returns the server snapshot during SSR and the first
 * hydration pass, then the client snapshot. Matches the header's theme toggle,
 * which needs the same guard for the same reason.
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

/**
 * The same choice the header's icon button makes, spelled out.
 *
 * It belongs here as well as there because a preference someone wants to
 * change deliberately should be findable where preferences live, not only
 * behind an unlabelled glyph. Both read and write the one `next-themes` store,
 * so they can never disagree.
 *
 * A real radio group rather than three buttons: these are mutually exclusive
 * options with one answer, which is what arrow-key navigation and a single tab
 * stop are for. The control is withheld until hydration because the prerendered
 * HTML that `output: "export"` ships cannot know the stored preference.
 */
export function AppearanceControl() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  if (!hydrated) {
    return <Skeleton aria-hidden="true" className="h-9 w-64 rounded-lg" />;
  }

  const current = theme ?? "system";

  return (
    <fieldset>
      <legend className="sr-only">Colour theme</legend>
      <div className="bg-muted inline-flex gap-1 rounded-lg p-1">
        {THEMES.map((option) => {
          const selected = option.value === current;
          return (
            <label
              key={option.value}
              className={cn(
                "has-focus-visible:ring-ring/50 flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors select-none has-focus-visible:ring-2",
                selected
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={selected}
                onChange={() => setTheme(option.value)}
                className="sr-only"
              />
              <option.icon aria-hidden="true" className="size-3.5" />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
