"use client";

import { ArrowRightIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PageContainer, PageHero } from "@/components/common";
import { CompanyList } from "./company-list";
import { PreferencesForm } from "./preferences-form";

/** The /companies screen: what to look for, and where. */
export function CompaniesScreen() {
  return (
    <PageContainer width="wide" className="sm:pt-12 sm:pb-16">
      <PageHero
        eyebrow="Job watch"
        title="Companies"
        description="Careers pages the crawler reads, and the jobs you want from them."
        actions={
          <ButtonLink href="/jobs" variant="outline" className="h-10 rounded-xl px-4">
            Matched jobs
            <ArrowRightIcon data-icon="inline-end" />
          </ButtonLink>
        }
      />

      <div className="mt-10 space-y-10">
        <section
          aria-labelledby="prefs-heading"
          className="bg-card space-y-5 rounded-[1.25rem] p-6 ring-1 ring-foreground/10 sm:p-7"
        >
          <h2 id="prefs-heading" className="font-heading text-xl font-semibold tracking-tight">
            Job preferences
          </h2>
          <PreferencesForm />
        </section>

        <CompanyList />
      </div>
    </PageContainer>
  );
}
