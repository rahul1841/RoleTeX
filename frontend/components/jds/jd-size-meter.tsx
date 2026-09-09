"use client";

import { cn } from "cn";
import {
  JD_CONTENT_MAX,
  JD_MAX_REQUEST_BYTES,
  formatBytes,
  formatNumber,
  type JdSizeReport,
} from "./limits";

/**
 * The live readout that keeps a paste inside the server's three ceilings.
 *
 * WHY THIS EXISTS AT ALL: the byte cap is enforced by an ASGI middleware that
 * runs below routing and below authentication (app/main.py
 * `BodySizeLimitMiddleware`). A paste over it comes back 413 with no field
 * information, no relation to the form, and — verified against the running
 * server — the same answer whether or not the user is signed in. There is
 * nothing useful to say after the fact, so the whole job is to say it before.
 *
 * ACCESSIBILITY. The numbers themselves are `aria-hidden`: they change on
 * every keystroke, and a live region wired to them would read a running
 * commentary of digits over the top of the user's own typing. The live region
 * carries the advisory sentence instead, which changes only when a threshold
 * is crossed — so it is silent while everything fits and announces once when
 * it stops fitting. The container is always in the DOM, because a live region
 * inserted at the same moment as its text is unreliably announced.
 */
export function JdSizeMeter({ report }: { report: JdSizeReport }) {
  const tone =
    report.charactersLevel === "over" || report.bytesLevel === "over"
      ? "over"
      : report.charactersLevel === "near" || report.bytesLevel === "near"
        ? "near"
        : "ok";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "font-mono text-[0.6875rem] tabular-nums",
        tone === "over" && "text-destructive font-medium",
        tone === "near" && "text-warning-foreground font-medium",
        tone === "ok" && "text-muted-foreground",
      )}
    >
      {formatNumber(report.characters)}
      <span className="opacity-60">/{formatNumber(JD_CONTENT_MAX)} chars</span>
      <span className="opacity-40"> · </span>
      {formatBytes(report.bytes)}
      <span className="opacity-60">/{formatBytes(JD_MAX_REQUEST_BYTES)}</span>
    </span>
  );
}

/**
 * A hairline fill under the textarea.
 *
 * Purely decorative and `aria-hidden`: it duplicates the counter above it and
 * the advisory below it, and a third announcement of the same fact is noise.
 * It tracks whichever of the two limits is closer to being hit, so a
 * non-Latin paste that is comfortably inside the character count still shows
 * the bar filling as it approaches the byte cap.
 */
export function JdSizeBar({ report }: { report: JdSizeReport }) {
  const ratio = Math.max(
    report.characters / JD_CONTENT_MAX,
    report.bytes / JD_MAX_REQUEST_BYTES,
  );
  const over = report.charactersLevel === "over" || report.bytesLevel === "over";
  const near = !over && (report.charactersLevel === "near" || report.bytesLevel === "near");

  return (
    <div
      aria-hidden="true"
      className="bg-muted h-0.5 w-full overflow-hidden rounded-full"
    >
      <div
        className={cn(
          "h-full rounded-full",
          over ? "bg-destructive" : near ? "bg-warning-foreground" : "bg-primary/40",
        )}
        style={{ width: `${Math.min(100, Math.max(2, ratio * 100))}%` }}
      />
    </div>
  );
}

/**
 * The one sentence that says which limit is close and what to do.
 *
 * Rendered in the warning tokens while it is advice (approaching a limit) and
 * the destructive tokens once it is a failure the user is walking into (over
 * one) — the split the design system reserves `destructive` for.
 */
export function JdSizeAdvisory({ report }: { report: JdSizeReport }) {
  return (
    <div role="status" aria-live="polite" className="min-h-0">
      {report.advisory ? (
        <p
          className={cn(
            "rounded-md border px-2.5 py-1.5 text-xs text-pretty",
            report.blocked
              ? "border-destructive/25 bg-destructive/5 text-destructive"
              : "border-warning-border bg-warning text-warning-foreground",
          )}
        >
          {report.advisory}
        </p>
      ) : null}
    </div>
  );
}
