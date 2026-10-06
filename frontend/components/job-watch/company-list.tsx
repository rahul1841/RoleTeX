"use client";

import * as React from "react";
import { cn } from "cn";
import {
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ListSkeleton,
  LoadingState,
  Spinner,
} from "@/components/common";
import type { Company, CompanyImportResponse } from "@/lib/api/types";
import {
  useCompanies,
  useDeleteCompany,
  useImportCompanies,
  useRefreshCompanies,
} from "@/hooks/use-companies";
import { CompanyDialog } from "./company-dialog";
import { companyStatus, failureLine, formatAbsolute, formatRelative } from "./format";

/** How long the list keeps polling after a refresh, while the crawl runs. */
const POLL_AFTER_REFRESH_MS = 3 * 60_000;
const ACCEPT = ".csv,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function CompanyList() {
  const [pollUntil, setPollUntil] = React.useState(0);
  const companies = useCompanies(pollUntil);
  const importList = useImportCompanies();
  const refresh = useRefreshCompanies();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<Company | null>(null);
  const [removing, setRemoving] = React.useState<Company | null>(null);
  const [result, setResult] = React.useState<CompanyImportResponse | null>(null);
  const remove = useDeleteCompany();

  const upload = async (file: File) => {
    setResult(null);
    try {
      const response = await importList.mutateAsync(file);
      setResult(response);
      setPollUntil(Date.now() + POLL_AFTER_REFRESH_MS);
    } catch (error) {
      toast.error("Could not import that file", { description: failureLine(error) });
    }
  };

  const onRefresh = async () => {
    try {
      const response = await refresh.mutateAsync();
      setPollUntil(Date.now() + POLL_AFTER_REFRESH_MS);
      toast.success(`Crawling ${response.queued} ${response.queued === 1 ? "company" : "companies"}`);
    } catch (error) {
      toast.error("Could not refresh", { description: failureLine(error) });
    }
  };

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <Button
        variant="outline"
        className="h-10 rounded-xl px-4"
        disabled={importList.isPending}
        onClick={() => fileInput.current?.click()}
      >
        {importList.isPending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
        Upload list
      </Button>
      <Button className="h-10 rounded-xl px-4" onClick={() => setAdding(true)}>
        <PlusIcon data-icon="inline-start" />
        Add company
      </Button>
    </div>
  );

  let body: React.ReactNode;
  if (companies.isPending) {
    body = (
      <LoadingState label="Loading companies…">
        <ListSkeleton rows={4} />
      </LoadingState>
    );
  } else if (companies.isError) {
    body = (
      <ErrorState
        error={companies.error}
        title="Could not load your companies"
        onRetry={() => void companies.refetch()}
      />
    );
  } else if (companies.data.length === 0) {
    body = (
      <EmptyState
        title="No companies yet"
        description="Upload a CSV, Excel or PDF list with a company name and careers link on each row, or add one at a time."
        action={actions}
      />
    );
  } else {
    body = (
      <ul className="bg-card divide-border divide-y overflow-hidden rounded-[1.25rem] ring-1 ring-foreground/10">
        {companies.data.map((company) => (
          <li key={company.id}>
            <CompanyRow
              company={company}
              onEdit={() => setEditing(company)}
              onRemove={() => setRemoving(company)}
            />
          </li>
        ))}
      </ul>
    );
  }

  const count = companies.data?.length ?? 0;

  return (
    <section aria-labelledby="companies-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 id="companies-heading" className="font-heading text-xl font-semibold tracking-tight">
            Companies
          </h2>
          {count ? (
            <span className="text-muted-foreground font-mono text-xs tabular-nums">{count}</span>
          ) : null}
        </div>
        {count ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              className="h-10 rounded-xl px-3"
              disabled={refresh.isPending}
              onClick={() => void onRefresh()}
            >
              {refresh.isPending ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
              Refresh now
            </Button>
            {actions}
          </div>
        ) : null}
      </div>

      {result ? <ImportResult result={result} onDismiss={() => setResult(null)} /> : null}

      {body}

      <CompanyDialog open={adding} onOpenChange={setAdding} />
      <CompanyDialog
        open={editing !== null}
        onOpenChange={(open) => (!open ? setEditing(null) : undefined)}
        company={editing ?? undefined}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (!open ? setRemoving(null) : undefined)}
        title={`Remove ${removing?.name ?? "this company"}?`}
        description="Its matched jobs disappear from your list."
        confirmLabel="Remove company"
        pending={remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync(removing.id);
            toast.success("Company removed", { description: removing.name });
            setRemoving(null);
          } catch (error) {
            toast.error("Could not remove this company", { description: failureLine(error) });
            throw error;
          }
        }}
      />
    </section>
  );
}

const TONES = {
  busy: "bg-muted text-muted-foreground",
  ok: "bg-diff-added text-diff-added-foreground",
  warn: "bg-warning text-warning-foreground",
  error: "bg-destructive/10 text-destructive",
} as const;

function CompanyRow({
  company,
  onEdit,
  onRemove,
}: {
  company: Company;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const status = companyStatus(company);
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.9375rem] font-medium">{company.name}</p>
        <a
          href={company.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground mt-0.5 inline-flex max-w-full items-center gap-1 text-xs"
        >
          <span className="truncate">{company.link}</span>
          <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0" />
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:justify-end">
        <span className="text-muted-foreground text-xs">{company.source}</span>
        <span
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
            TONES[status.tone],
          )}
        >
          {status.tone === "busy" ? <Spinner className="size-3" /> : null}
          {status.label}
        </span>
        {company.status === "ready" && company.last_crawled_at ? (
          <span
            className="text-muted-foreground font-mono text-xs tabular-nums"
            title={`Read ${formatAbsolute(company.last_crawled_at)}`}
          >
            {company.open_jobs} open · {formatRelative(company.last_crawled_at)}
          </span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg"
                aria-label={`Actions for ${company.name}`}
              >
                <MoreHorizontalIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon data-icon="inline-start" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2Icon data-icon="inline-start" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ImportResult({
  result,
  onDismiss,
}: {
  result: CompanyImportResponse;
  onDismiss: () => void;
}) {
  const skipped = result.skipped ?? [];
  return (
    <div role="status" className="bg-muted/40 space-y-2 rounded-xl border px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p>
          Added <strong>{result.added}</strong>
          {result.duplicates ? ` · ${result.duplicates} already in your list` : ""}
          {skipped.length ? ` · ${skipped.length} skipped` : ""}
        </p>
        <Button variant="ghost" size="sm" className="-my-1" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {skipped.length ? (
        <ul className="text-muted-foreground max-h-40 space-y-0.5 overflow-y-auto text-xs">
          {skipped.map((item, index) => (
            <li key={`${item.row}-${index}`}>
              {item.row ? `Row ${item.row}: ` : ""}
              {item.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
