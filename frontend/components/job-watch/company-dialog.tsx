"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/common";
import type { Company } from "@/lib/api/types";
import { useCreateCompany, useUpdateCompany } from "@/hooks/use-companies";
import { failureLine } from "./format";

/** Add one company, or edit one (`company` given). */
export function CompanyDialog({
  open,
  onOpenChange,
  company,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: Company;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Keyed so reopening starts from the record, not the last draft. */}
        {open ? (
          <CompanyForm
            key={company?.id ?? "new"}
            company={company}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CompanyForm({ company, onDone }: { company?: Company; onDone: () => void }) {
  const create = useCreateCompany();
  const update = useUpdateCompany();
  const [link, setLink] = React.useState(company?.link ?? "");
  const [name, setName] = React.useState(company?.name ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (company) {
        const body: { name?: string; link?: string } = {};
        if (name.trim() && name.trim() !== company.name) body.name = name.trim();
        if (link.trim() && link.trim() !== company.link) body.link = link.trim();
        if (!body.name && !body.link) {
          onDone();
          return;
        }
        await update.mutateAsync({ id: company.id, body });
        toast.success("Company updated");
      } else {
        await create.mutateAsync({ link: link.trim(), name: name.trim() || undefined });
        toast.success("Company added");
      }
      onDone();
    } catch (cause) {
      setError(failureLine(cause));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{company ? "Edit company" : "Add a company"}</DialogTitle>
        <DialogDescription>
          The careers page, or the company&apos;s job board on Greenhouse, Lever,
          Ashby, Workable, SmartRecruiters or Workday.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="company-link">Careers link</Label>
        <Input
          id="company-link"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://jobs.lever.co/company"
          autoComplete="off"
          spellCheck={false}
          required
          className="h-10"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "company-error" : undefined}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="company-name">Name</Label>
        <Input
          id="company-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Taken from the link if left empty"
          autoComplete="off"
          className="h-10"
        />
      </div>

      {error ? (
        <p id="company-error" role="alert" className="text-destructive text-sm text-pretty">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !link.trim()}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {company ? "Save" : "Add company"}
        </Button>
      </DialogFooter>
    </form>
  );
}
