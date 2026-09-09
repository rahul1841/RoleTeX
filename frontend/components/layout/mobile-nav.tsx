"use client";

import * as React from "react";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AppNav } from "./app-nav";

/**
 * The navigation drawer below the `lg` breakpoint.
 *
 * The desktop sidebar is `display: none` at these widths, so it is out of the
 * accessibility tree and the two navs never both exist for the same user —
 * which is why both are allowed to be labelled "Main".
 *
 * The Sheet is a modal dialog: Base UI traps focus in it, returns focus to the
 * trigger on close, and closes on Escape. Choosing a destination closes it via
 * `onNavigate`, otherwise the drawer would sit open over the page it just
 * navigated to.
 */
export function MobileNav({ storageAvailable }: { storageAvailable: boolean }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon-sm" className="lg:hidden" />}
        aria-label="Open navigation"
      >
        <MenuIcon aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0">
        <SheetHeader>
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Move between the tailoring workspace, your saved documents and
            settings.
          </SheetDescription>
        </SheetHeader>
        <div className="px-3 pb-4">
          <AppNav
            storageAvailable={storageAvailable}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
