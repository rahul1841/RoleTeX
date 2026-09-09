import { Badge } from "@/components/ui/badge";
import type { RunSummary } from "@/lib/api/types";

/**
 * The two facts about a run that are exceptions rather than metadata.
 *
 * Kept out of the meta line because they change how much the run can be
 * trusted, and kept to two so the list does not turn into a badge farm:
 *
 *  - REPAIRED: the model's first proposal failed the resume safety contract
 *    and the server ran a second, corrective completion. The result is valid,
 *    but it is not what the model produced unprompted, and a reviewer should
 *    know that before trusting the change list.
 *  - NO PDF: the run has no page count, so nothing was compiled — either the
 *    tailor was requested with `compile: false` or the compile did not finish.
 *    This is a neutral fact, not a failure, so it stays outline rather than
 *    borrowing the warning or destructive colours.
 *
 * These render inside a link, so they are plain text with an sr-only
 * explanation rather than tooltips — no nested interactive elements.
 */
export function RunFlags({ run }: { run: RunSummary }) {
  const compiled = typeof run.page_count === "number" && run.page_count > 0;

  if (!run.repaired && compiled) return null;

  return (
    <>
      {run.repaired ? (
        <Badge
          variant="outline"
          className="border-warning-border bg-warning text-warning-foreground"
        >
          Repaired
          <span className="sr-only">
            : the first proposal failed validation and was corrected by a second
            model pass
          </span>
        </Badge>
      ) : null}
      {!compiled ? (
        <Badge variant="outline" className="text-muted-foreground">
          No PDF
          <span className="sr-only">
            : this run was not compiled, so it has no page count
          </span>
        </Badge>
      ) : null}
    </>
  );
}
