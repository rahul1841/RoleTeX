import type { ReactNode } from "react";
import { Old_Standard_TT } from "next/font/google";
import { CheckIcon } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import {
  CHANGE_KIND_LABEL,
  describeFieldId,
  wordDiff,
} from "@/components/tailor";
import type { ResumeChange } from "@/lib/api/types";
import { PreviewLine } from "./preview-line";

/**
 * The hero's picture of a finished run: the change list beside the page it
 * produced.
 *
 * Built from the app's own rules rather than drawn freehand — field ids are
 * named by `describeFieldId` and the highlights come from `wordDiff`, exactly
 * as in the real change list — so the picture cannot promise a review screen
 * the product does not have. It is still a picture: one `role="img"` with a
 * description, and nothing inside it takes focus.
 *
 * The person and employers are invented. Nothing here is taken from the seed
 * resume in backend/resume/data.json.
 */

// LaTeX's default face, Computer Modern, is not on Google Fonts; Old Standard
// TT comes from the same family of 19th-century "Modern" types and reads as
// typeset. Only the upright styles are loaded — the one italic line on the
// page is slanted by the browser.
const typeset = Old_Standard_TT({ subsets: ["latin"], weight: ["400", "700"] });

/** Every one of these passes the server's rules: no new numbers, same skills. */
export const SAMPLE_CHANGES: readonly ResumeChange[] = [
  {
    field_id: "summary",
    before: "Backend engineer — payments, Python, distributed systems",
    after:
      "Payments backend engineer — Python, Kafka, event-driven settlement systems",
  },
  {
    field_id: "exp_1_b2",
    before:
      "Led the migration of 14 services from REST polling to event-driven webhooks.",
    after:
      "Led the move of 14 payment services from REST polling to event-driven webhooks on Kafka.",
  },
  {
    field_id: "skills_order",
    before: "Python, Go, SQL, TypeScript, Kafka, PostgreSQL, Redis, Docker, AWS",
    after: "Python, SQL, Go, TypeScript, Kafka, PostgreSQL, AWS, Redis, Docker",
  },
  {
    field_id: "exp_1_b1",
    before:
      "Rebuilt the settlement pipeline in Python and Kafka, cutting nightly reconciliation from 4 hours to 35 minutes.",
    after:
      "Rebuilt the payment settlement pipeline in Python and Kafka, cutting nightly reconciliation from 4 hours to 35 minutes.",
  },
];

export function ProductPreview({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="A tailored resume, compiled to one page, beside the changes the model proposed for it"
      className={cn(
        "bg-muted relative overflow-hidden rounded-[1.25rem] border px-4 py-6 [background-image:radial-gradient(var(--border)_1px,transparent_1.2px)] [background-size:20px_20px] sm:p-10 xl:h-[37.5rem] xl:px-16 xl:pt-14 xl:pb-0",
        className,
      )}
    >
      <div className="grid gap-10 xl:grid-cols-[35rem_27.5rem] xl:justify-between">
        <ChangesColumn />
        <div className="relative hidden xl:block">
          <TypesetPage />
          <div className="bg-card absolute top-11 -left-10 flex h-8 items-center gap-2 rounded-full pr-3 pl-1.5 text-xs font-medium whitespace-nowrap shadow-[0_6px_18px_rgb(21_24_31/0.1)] ring-1 ring-foreground/10">
            <span className="bg-diff-added text-diff-added-foreground flex size-5 items-center justify-center rounded-full">
              <CheckIcon className="size-3" strokeWidth={3} />
            </span>
            Compiled PDF · 1 page
          </div>
        </div>
      </div>
    </div>
  );
}

function ChangesColumn() {
  return (
    <div className="mx-auto flex w-full max-w-[35rem] flex-col gap-2.5 xl:mx-0">
      <div className="mb-0.5 flex items-center gap-2.5">
        <span className="text-sm font-medium">Proposed changes</span>
        <Badge variant="outline" className="bg-card tabular-nums">
          {SAMPLE_CHANGES.length}
        </Badge>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          1 of {SAMPLE_CHANGES.length} reviewed
        </span>
      </div>
      {SAMPLE_CHANGES.map((change, index) => (
        <PreviewChangeCard
          key={change.field_id}
          change={change}
          reviewed={index === 0}
          // The last card only ever shows its top edge, running off the
          // bottom of the fixed-height desktop frame to say "there is more".
          className={index === SAMPLE_CHANGES.length - 1 ? "hidden xl:block" : undefined}
        />
      ))}
    </div>
  );
}

function PreviewChangeCard({
  change,
  reviewed,
  className,
}: {
  change: ResumeChange;
  reviewed: boolean;
  className?: string;
}) {
  const location = describeFieldId(change.field_id);
  const spans = wordDiff(change.before, change.after);

  return (
    <div
      className={cn(
        "bg-card overflow-hidden rounded-xl ring-1",
        reviewed
          ? "ring-border/60 opacity-70"
          : "shadow-[0_8px_24px_rgb(21_24_31/0.06)] ring-foreground/10",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
            reviewed
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input",
          )}
        >
          {reviewed ? <CheckIcon className="size-3.5" /> : null}
        </span>
        <span className="min-w-0 truncate text-sm font-medium">
          {location.section}
          {location.detail ? (
            <span className="text-muted-foreground font-normal">
              {" · "}
              {location.detail}
            </span>
          ) : null}
        </span>
        <Badge variant="outline" className="ml-auto shrink-0">
          {CHANGE_KIND_LABEL[location.kind]}
        </Badge>
        <code className="text-muted-foreground hidden shrink-0 text-[0.7rem] sm:inline">
          {change.field_id}
        </code>
      </div>
      <div className="space-y-1 px-3 pb-3">
        <PreviewLine tone="removed" text={change.before} spans={spans?.before} />
        <PreviewLine tone="added" text={change.after} spans={spans?.after} />
      </div>
    </div>
  );
}

/**
 * The compiled page, after tailoring, laid out the way the server-assembled
 * template sets it: a small-caps name, then ruled small-caps section headers
 * in the template's order — education, experience, skills, projects.
 *
 * Paper is white in both themes, as the PDF viewer shows it.
 */
function TypesetPage() {
  return (
    <div
      className={cn(
        typeset.className,
        "aspect-[210/297] w-[27.5rem] bg-white px-10 py-[1.875rem] text-[8.5px] leading-[1.38] text-[#111] shadow-[0_0_0_1px_rgb(21_24_31/0.08),0_16px_48px_rgb(21_24_31/0.12)]",
      )}
    >
      <div className="text-center">
        <p className="text-[21px] leading-[1.1] tracking-[0.02em] [font-variant-caps:small-caps]">
          Jordan Ellis
        </p>
        <p className="mt-1">
          Payments backend engineer — Python, Kafka, event-driven settlement
          systems
        </p>
        <p className="mt-0.5">
          jordan.ellis@example.com | +1 555 0142 | Toronto, ON
        </p>
        <p className="font-bold">Portfolio | GitHub</p>
      </div>

      <PageSection title="Education">
        <PageRow lead="Lakeshore Institute of Technology" trail="Toronto, ON" />
        <PageRow lead="B.Eng. Software Engineering" trail="2015 – 2019" plain />
      </PageSection>

      <PageSection title="Experience">
        <PageRow
          lead="Brightline Payments | Senior Backend Engineer"
          trail="Toronto, ON | Jan 2022 – Present"
        />
        <PageBullets
          items={[
            "Rebuilt the payment settlement pipeline in Python and Kafka, cutting nightly reconciliation from 4 hours to 35 minutes.",
            "Led the move of 14 payment services from REST polling to event-driven webhooks on Kafka.",
            "Mentored four engineers through on-call and design reviews.",
          ]}
        />
        <PageRow
          lead="Harbor Analytics | Backend Engineer"
          trail="Waterloo, ON | Jun 2019 – Dec 2021"
        />
        <PageBullets
          items={[
            "Built the ingestion API that handles 2M events a day with PostgreSQL and FastAPI.",
            "Cut p95 query latency 60% by adding read replicas and query-plan reviews.",
          ]}
        />
      </PageSection>

      <PageSection title="Skills">
        <p>
          <b>Languages:</b> Python, SQL, Go, TypeScript
        </p>
        <p>
          <b>Infrastructure:</b> Kafka, PostgreSQL, AWS, Redis, Docker
        </p>
      </PageSection>

      <PageSection title="Projects">
        <div className="flex gap-2">
          <b>ledgerlint | Link</b>
          <i className="ml-auto">Go, SQLite</i>
        </div>
        <PageBullets
          items={[
            "A command-line checker that flags unbalanced entries in double-entry ledgers.",
          ]}
        />
      </PageSection>
    </div>
  );
}

function PageSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  // Plain elements, not a <section> and a heading: this is part of a picture,
  // and everything inside a `role="img"` is presentational anyway.
  return (
    <div className="mt-2.5">
      <p className="-ml-3 text-[10.5px] tracking-[0.03em] [font-variant-caps:small-caps]">
        {title}
      </p>
      <div className="-ml-3 mt-px mb-1 h-[0.6px] bg-[#111]" />
      {children}
    </div>
  );
}

function PageRow({
  lead,
  trail,
  plain = false,
}: {
  lead: string;
  trail: string;
  plain?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span className={plain ? undefined : "font-bold"}>{lead}</span>
      <span className="ml-auto">{trail}</span>
    </div>
  );
}

function PageBullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-0.5 mb-1.5 list-disc pl-3.5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
