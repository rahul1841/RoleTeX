import Link from "next/link";
import { cn } from "cn";

/**
 * The product lockup: name plus the "AI + LaTeX" tagline.
 *
 * The tagline is not decoration — it is the one line that tells a first-time
 * visitor what the tool actually does, and it carried the same job in the old
 * static/index.html header. It is stacked under the name rather than beside it
 * so it survives narrow viewports without truncation.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "focus-visible:ring-ring/50 flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-3",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="bg-primary text-primary-foreground font-heading grid size-7 shrink-0 place-items-center rounded-md text-[0.8125rem] font-semibold"
      >
        R
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-heading text-[0.9375rem] font-semibold tracking-tight">
          RoleTeX
        </span>
        <span className="text-muted-foreground mt-0.5 text-[0.6875rem] tracking-wide">
          AI + LaTeX
        </span>
      </span>
    </Link>
  );
}
