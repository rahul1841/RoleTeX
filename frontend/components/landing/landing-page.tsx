import type { ReactNode } from "react";
import {
  BracesIcon,
  EyeOffIcon,
  HashIcon,
  ListChecksIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
// Imported from their own files rather than the @/components/layout barrel,
// which also re-exports <AppShell>; this page must not pull the application
// frame into its chunk.
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Wordmark } from "@/components/layout/wordmark";
import { KeysPreview } from "./keys-preview";
import {
  ClosingActions,
  FooterLinks,
  HeaderActions,
  HeroActions,
} from "./landing-actions";
import { ProductPreview } from "./product-preview";
import { JobVisual, LibraryVisual, ReviewVisual } from "./step-visuals";

/**
 * The public front door: what RoleTeX does, why its output can be trusted,
 * and the way in.
 *
 * A server component, prerendered to static HTML like every other route; only
 * the calls to action are client code, because only they depend on who is
 * looking (see landing-actions.tsx). Every claim here is one the server
 * enforces — the safeguards section in particular restates rules from
 * backend/app/resume.py, so change them together.
 */

const CONTAINER = "mx-auto w-full max-w-[78rem] px-4 sm:px-6";

const SECTION_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#safeguards", label: "Safeguards" },
  { href: "#providers", label: "Providers" },
] as const;

const STEPS: { number: string; title: string; body: string; visual: ReactNode }[] = [
  {
    number: "01",
    title: "Add your resume",
    body: "Write it in the builder — no AI key needed — or paste in LaTeX or upload a PDF. Every save keeps the version before it.",
    visual: <LibraryVisual />,
  },
  {
    number: "02",
    title: "Point it at a job",
    body: "Paste a job description or pick one you saved, then choose the provider and model that will read it.",
    visual: <JobVisual />,
  },
  {
    number: "03",
    title: "Review, then download",
    body: "Every proposed edit is shown before and after, beside the compiled PDF. Your saved resume is never overwritten.",
    visual: <ReviewVisual />,
  },
];

const SAFEGUARDS: { icon: LucideIcon; title: string; body: string; rule: string }[] = [
  {
    icon: ListChecksIcon,
    title: "It edits what is already there",
    body: "The model can reword your headline, rewrite up to six of your existing bullets and reorder your skills. An edit aimed at a bullet that doesn’t exist is rejected.",
    rule: "bullet_rewrites ≤ 6",
  },
  {
    icon: HashIcon,
    title: "No new numbers. No new skills.",
    body: "A rewrite that introduces a number your resume doesn’t already contain is rejected, and the skills list must be exactly your skills — reordered, never added to or renamed.",
    rule: "skills_order = your skills, reordered",
  },
  {
    icon: EyeOffIcon,
    title: "Your contact details stay out of it",
    body: "Your name, email, phone and links are never sent to the model when you tailor. The server puts them back when it typesets the page.",
    rule: "identity → never sent",
  },
  {
    icon: BracesIcon,
    title: "The model never writes LaTeX",
    body: "It returns plain text. The server escapes it, places it into a locked template and compiles the PDF with Tectonic in a sandbox.",
    rule: "tectonic --untrusted",
  },
];

export function LandingPage() {
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <LandingHeader />
      {/* The skip link in app/layout.tsx targets this id. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="focus-visible:ring-ring/50 flex-1 outline-none focus-visible:ring-2"
      >
        <Hero />
        <HowItWorks />
        <Safeguards />
        <Providers />
        <Closing />
      </main>
      <LandingFooter />
    </div>
  );
}

function LandingHeader() {
  return (
    <header className="border-b">
      <div className={cn(CONTAINER, "flex h-18 items-center gap-4 md:gap-12")}>
        <Wordmark />
        <nav aria-label="On this page" className="hidden items-center gap-7 md:flex">
          {SECTION_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm text-sm transition-colors outline-none focus-visible:ring-3"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <HeaderActions />
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="pt-16 sm:pt-20">
      <div className={cn(CONTAINER, "flex flex-col items-center text-center")}>
        <p className="bg-card text-muted-foreground inline-flex h-7 items-center gap-2 rounded-full px-3 font-mono text-xs ring-1 ring-foreground/10">
          <span aria-hidden="true" className="bg-primary size-1.5 rounded-[2px]" />
          AI + LaTeX
        </p>
        <h1
          id="hero-heading"
          className="font-heading mt-6 text-[2.625rem] leading-[1.08] font-semibold tracking-[-0.04em] text-balance sm:text-6xl lg:text-7xl lg:leading-[1.04]"
        >
          Tailor your resume to any job.{" "}
          <span className="block">
            See{" "}
            {/* The change list's own "added" colours: the product's signature,
                not decoration. Held on one line with its full stop, so a phone
                never splits the highlight or strands the period. */}
            <span className="whitespace-nowrap">
              <mark className="bg-diff-added text-diff-added-foreground rounded-xl px-2 sm:px-3">
                every change
              </mark>
              .
            </span>
          </span>
        </h1>
        <p className="text-muted-foreground mt-7 max-w-[47.5rem] text-lg leading-8 text-pretty sm:text-[1.1875rem] sm:leading-[1.875rem]">
          Paste a job description and an AI model proposes edits to your
          headline, bullets and skill order. RoleTeX checks each edit against
          your resume, typesets the PDF in LaTeX, and shows you every change
          before you download.
        </p>
        <HeroActions className="mt-9" />
        <p className="text-muted-foreground mt-4 text-[0.8125rem] leading-5">
          Write your resume in the app with no AI key, or import one from LaTeX
          or a PDF.
        </p>
      </div>
      <div className={cn(CONTAINER, "mt-16")}>
        <ProductPreview />
      </div>
    </section>
  );
}

function SectionIntro({
  id,
  eyebrow,
  title,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  className?: string;
}) {
  return (
    <div className={cn("flex max-w-[47.5rem] flex-col gap-3", className)}>
      <p className="text-primary text-sm font-medium">{eyebrow}</p>
      <h2
        id={id}
        className="font-heading text-3xl leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-[2.75rem] sm:leading-[3rem]"
      >
        {title}
      </h2>
    </div>
  );
}

function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-heading" className="scroll-mt-8 pt-24 sm:pt-32">
      <div className={CONTAINER}>
        <SectionIntro
          id="how-heading"
          eyebrow="How it works"
          title="From job description to finished PDF in three steps"
        />
        <ol className="mt-12 grid gap-6 lg:grid-cols-3">
          {STEPS.map((step) => (
            <li
              key={step.number}
              className="bg-card flex flex-col overflow-hidden rounded-2xl ring-1 ring-foreground/10"
            >
              <div
                aria-hidden="true"
                className="bg-code flex h-47 items-center justify-center border-b px-6"
              >
                {step.visual}
              </div>
              <div className="flex flex-col gap-2 p-6">
                {/* The <ol> already numbers the steps for assistive tech. */}
                <span aria-hidden="true" className="text-muted-foreground font-mono text-xs">
                  {step.number}
                </span>
                <h3 className="font-heading text-lg font-semibold tracking-tight">
                  {step.title}
                </h3>
                <p className="text-muted-foreground text-[0.9375rem] leading-6 text-pretty">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Safeguards() {
  return (
    <section
      id="safeguards"
      aria-labelledby="safeguards-heading"
      className="scroll-mt-8 pt-24 sm:pt-32"
    >
      <div className={CONTAINER}>
        <div className="grid gap-6 lg:grid-cols-2 lg:items-end lg:gap-16">
          <SectionIntro
            id="safeguards-heading"
            eyebrow="Safeguards"
            title="The model proposes. The server checks. You decide."
          />
          <p className="text-muted-foreground text-[1.0625rem] leading-7 text-pretty">
            Tailoring with an LLM goes wrong in familiar ways — invented
            numbers, broken formatting, personal details sent to a third
            party. RoleTeX narrows what the model can do, checks what it
            returns, and leaves the final call to you.
          </p>
        </div>
        <ul className="mt-12 grid gap-4 md:grid-cols-2">
          {SAFEGUARDS.map(({ icon: Icon, title, body, rule }) => (
            <li
              key={title}
              className="bg-card flex gap-5 rounded-2xl p-7 ring-1 ring-foreground/10"
            >
              <span
                aria-hidden="true"
                className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg"
              >
                <Icon className="size-5" />
              </span>
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="text-[1.0625rem] leading-6 font-semibold">{title}</h3>
                <p className="text-muted-foreground text-[0.9375rem] leading-6 text-pretty">
                  {body}
                </p>
                <code className="bg-code text-code-foreground border-code-border mt-1.5 self-start rounded-md border px-2 py-0.5 font-mono text-xs">
                  {rule}
                </code>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Providers() {
  return (
    <section
      id="providers"
      aria-labelledby="providers-heading"
      className="scroll-mt-8 pt-24 sm:pt-32"
    >
      <div className={cn(CONTAINER, "grid items-center gap-12 lg:grid-cols-2 lg:gap-16")}>
        <div className="flex flex-col gap-4">
          <SectionIntro
            id="providers-heading"
            eyebrow="Providers"
            title="Bring the model you already use"
          />
          <p className="text-muted-foreground text-[1.0625rem] leading-7 text-pretty">
            Save a key for Groq, Cerebras, Google Gemini, OpenRouter, Mistral,
            OpenAI or Anthropic, then choose the provider for each run. Keys are
            encrypted at rest and only ever shown back as their last four
            characters.
          </p>
          <p className="text-muted-foreground text-[0.9375rem] leading-6">
            No key yet? The resume builder works without one.
          </p>
        </div>
        <KeysPreview />
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section aria-labelledby="closing-heading" className="pt-24 pb-24 sm:pt-32">
      <div className={CONTAINER}>
        {/* `dark` scopes the dark theme's tokens to this band, so it is the
            app's own dark palette in either theme; in dark mode the ring is
            what sets it off from the page. */}
        <div className="dark bg-card text-foreground flex flex-col items-center gap-5 rounded-3xl px-6 py-16 text-center ring-1 ring-border sm:px-16 sm:py-20">
          <h2
            id="closing-heading"
            className="font-heading text-3xl leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-[2.75rem] sm:leading-[3rem]"
          >
            Start with the resume you already have.
          </h2>
          <p className="text-muted-foreground max-w-[37.5rem] text-[1.0625rem] leading-7 text-pretty">
            Import it from LaTeX or a PDF, or write it in the builder — then
            point it at the next job you apply for.
          </p>
          <ClosingActions className="mt-3" />
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t">
      <div className={cn(CONTAINER, "flex flex-wrap items-center gap-x-6 gap-y-4 py-9")}>
        <Wordmark />
        <p className="text-muted-foreground font-mono text-xs">Typeset with Tectonic</p>
        <FooterLinks className="ml-auto" />
      </div>
    </footer>
  );
}
