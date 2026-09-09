import { cn } from "cn";
import { InfoIcon } from "lucide-react";

/**
 * Advisory notes a run came back with.
 *
 * These use the `warning` token trio, not `destructive`: the run succeeded.
 * "Compilation was skipped by request", "the automatic one-page repair was
 * unsuccessful" and "the provider returned no material changes" are all things
 * the user should know and none of them is a failure. Reserving `destructive`
 * for real failures is what keeps it meaningful when one happens.
 */
export interface RunWarningsProps {
  warnings: string[];
  className?: string;
}

export function RunWarnings({ warnings, className }: RunWarningsProps) {
  if (warnings.length === 0) return null;

  return (
    <div
      className={cn(
        "border-warning-border/70 bg-warning text-warning-foreground rounded-xl border px-3 py-2.5 text-sm",
        className,
      )}
    >
      <div className="flex gap-2.5">
        <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">
            {warnings.length === 1
              ? "One note from this run"
              : `${warnings.length} notes from this run`}
          </p>
          {warnings.length === 1 ? (
            <p className="mt-0.5 text-pretty opacity-90">{warnings[0]}</p>
          ) : (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 opacity-90">
              {warnings.map((warning, index) => (
                <li key={index} className="text-pretty">
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
