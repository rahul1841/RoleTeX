import type { ReactNode } from "react";
import { Old_Standard_TT } from "next/font/google";
import { cn } from "cn";
import type { ResumeData } from "@/lib/api/types";

/**
 * A saved resume drawn as a typeset page, from its stored facts.
 *
 * This is a picture of the resume, not the PDF: compiling one costs a Tectonic
 * run, and `usePreviewResume` is deliberately never fired on mount. It lays the
 * facts out the way the server-assembled template sets them — small-caps name,
 * then ruled small-caps sections — in the face the landing page uses for the
 * same job. The library's thumbnails and the tailor screen's "Current version"
 * both use it to show *which* resume this is without spending anything; the
 * real document comes from a compile.
 */

// LaTeX's Computer Modern is not on Google Fonts; Old Standard TT is from the
// same family of "Modern" types. Same choice as the landing page's preview.
const typeset = Old_Standard_TT({ subsets: ["latin"], weight: ["400", "700"] });

export function ResumeSheet({
  data,
  className,
}: {
  data: ResumeData;
  className?: string;
}) {
  const { identity } = data;
  const contact = [identity.email, identity.phone, identity.location].filter(Boolean);
  const links = identity.links ?? [];

  return (
    <div
      className={cn(
        typeset.className,
        "relative aspect-[210/297] w-full overflow-hidden bg-white px-[9%] py-[7%] text-[8px] leading-[1.38] text-[#111] shadow-[0_0_0_1px_rgb(21_24_31/0.08),0_16px_48px_rgb(21_24_31/0.12)]",
        className,
      )}
    >
      <div className="text-center">
        <p className="text-[19px] leading-[1.1] tracking-[0.02em] [font-variant-caps:small-caps]">
          {identity.name}
        </p>
        {data.summary ? <p className="mt-1">{data.summary}</p> : null}
        {contact.length ? <p className="mt-0.5">{contact.join(" | ")}</p> : null}
        {links.length ? (
          <p className="font-bold">{links.map((link) => link.label).join(" | ")}</p>
        ) : null}
      </div>

      {data.education?.length ? (
        <Section title="Education">
          {data.education.map((entry) => (
            <div key={entry.id}>
              <Row lead={entry.institution} trail={entry.location} />
              <Row lead={entry.degree} trail={span(entry.start, entry.end)} plain />
            </div>
          ))}
        </Section>
      ) : null}

      {data.experience?.length ? (
        <Section title="Experience">
          {data.experience.map((entry) => (
            <div key={entry.id}>
              <Row
                lead={[entry.company, entry.role].filter(Boolean).join(" | ")}
                trail={[entry.location, span(entry.start, entry.end)]
                  .filter(Boolean)
                  .join(" | ")}
              />
              <Bullets items={(entry.bullets ?? []).map((bullet) => bullet.text)} />
            </div>
          ))}
        </Section>
      ) : null}

      {data.skills?.length ? (
        <Section title="Skills">
          {data.skills.map((group) => (
            <p key={group.category}>
              <b>{group.category}:</b> {group.items.join(", ")}
            </p>
          ))}
        </Section>
      ) : null}

      {data.projects?.length ? (
        <Section title="Projects">
          {data.projects.map((project) => (
            <div key={project.id}>
              <div className="flex gap-2">
                <b>{project.name}</b>
                {project.technologies?.length ? (
                  <i className="ml-auto">{project.technologies.join(", ")}</i>
                ) : null}
              </div>
              <Bullets items={(project.bullets ?? []).map((bullet) => bullet.text)} />
            </div>
          ))}
        </Section>
      ) : null}

      {data.achievements?.length ? (
        <Section title="Achievements">
          <Bullets items={data.achievements.map((bullet) => bullet.text)} />
        </Section>
      ) : null}

      {(data.custom_sections ?? []).map((section) => (
        <Section key={section.id} title={section.title}>
          <Bullets items={(section.bullets ?? []).map((bullet) => bullet.text)} />
        </Section>
      ))}

      {/* A long resume runs off the sheet; fade it rather than cut a line. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-white/0 to-white"
      />
    </div>
  );
}

function span(start: string, end: string): string {
  return [start, end].filter(Boolean).join(" – ");
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  // Plain elements: the sheet is a picture, described by its container.
  return (
    <div className="mt-2.5">
      <p className="-ml-2.5 text-[10px] tracking-[0.03em] [font-variant-caps:small-caps]">
        {title}
      </p>
      <div className="-ml-2.5 mt-px mb-1 h-[0.6px] bg-[#111]" />
      {children}
    </div>
  );
}

function Row({ lead, trail, plain = false }: { lead: string; trail: string; plain?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className={plain ? undefined : "font-bold"}>{lead}</span>
      <span className="ml-auto shrink-0">{trail}</span>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-0.5 mb-1.5 list-disc pl-3">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
