"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  FileUpIcon,
  ScrollTextIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, Spinner } from "@/components/common";
import { loadPdfjs } from "@/components/pdf";
import { listProviders } from "@/lib/api/endpoints/keys";
import { queryKeys } from "@/lib/api/query-keys";
import { useSession } from "@/hooks/use-session";
import {
  useAddResumeVersionFromLatex,
  useAddResumeVersionFromPdf,
  useImportResumeFromLatex,
  useImportResumeFromPdf,
} from "@/hooks/use-resumes";
import { resumeErrorGuidance } from "./errors";
import { LIMITS } from "./resume-form";

/**
 * Import a resume from a document the user already has.
 *
 * Both paths run an LLM extraction server-side, which is why this dialog does
 * three things a plain file input would not:
 *
 *  - It makes the provider explicit. `resolve_llm_selection` needs a provider
 *    *and* a stored key for it; without either, the request fails with a code
 *    whose fix is in Settings, not here. Better to say so before spending the
 *    round trip.
 *  - It pre-checks the PDF against the same limits the server enforces — 5MB,
 *    3 pages, and a real `%PDF-` header. The page count is read with the pdf.js
 *    already loaded for the preview, so a 40-page thesis is refused instantly
 *    rather than after a 5MB upload.
 *  - It shows the warnings the response carries. The server deliberately
 *    appends "review the imported fields" to every import, because extraction
 *    is the one place in this app where a model writes the user's facts.
 */

/** backend/app/config.py max_pdf_upload_bytes default. */
const MAX_PDF_BYTES = 5_000_000;
/** backend/app/config.py max_import_pdf_pages default. */
const MAX_PDF_PAGES = 3;
/** backend/app/schemas.py ResumeCreateRequest.latex min_length. */
const MIN_LATEX_CHARS = 40;

export type ImportTarget =
  | { kind: "new" }
  | { kind: "version"; resumeId: string; resumeName: string };

interface ImportOutcome {
  warnings: string[];
  resumeId: string;
}

/** Mirrors the server's own pre-LLM checks, in the same order. */
async function checkPdfFile(file: File): Promise<string | null> {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_PDF_BYTES) {
    return `That file is ${(file.size / 1_000_000).toFixed(1)} MB. The limit is ${MAX_PDF_BYTES / 1_000_000} MB.`;
  }

  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...header) !== "%PDF-") {
    return "That is not a PDF. Export the document as a PDF and try again.";
  }

  try {
    const pdfjs = await loadPdfjs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const document = await pdfjs.getDocument({ data: bytes, verbosity: 0 })
      .promise;
    const pages = document.numPages;
    await document.destroy();
    if (pages > MAX_PDF_PAGES) {
      return `That PDF has ${pages} pages. Import a resume of at most ${MAX_PDF_PAGES}.`;
    }
  } catch {
    // An encrypted or unusual PDF that pdf.js cannot open may still be
    // importable — the server uses poppler, not pdf.js. Defer to it rather
    // than blocking a file this check simply could not read.
    return null;
  }
  return null;
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="border-warning-border bg-warning text-warning-foreground flex gap-2 rounded-lg border p-3 text-xs">
      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <ul className="space-y-1">
        {warnings.map((warning) => (
          <li key={warning} className="text-pretty">
            {warning}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Which provider will run the extraction, and whether one can. */
function ProviderPicker({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = React.useId();

  if (options.length === 0) {
    return (
      <div className="border-warning-border bg-warning text-warning-foreground rounded-lg border p-3 text-xs text-pretty">
        Importing needs an AI provider key, and none is saved on this account.{" "}
        <Link href="/settings" className="underline underline-offset-2">
          Add one in Settings
        </Link>
        , or write the resume by hand instead — the builder needs no key.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>AI provider</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full rounded-lg data-[size=default]:h-10">
          <SelectValue placeholder="Choose a provider" />
        </SelectTrigger>
        <SelectContent>
          {options.map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              {provider.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs text-pretty">
        Providers with a saved key. The whole document is sent to it.
      </p>
    </div>
  );
}

/** One of the two sources, drawn as a choice card inside the tab list. */
function SourceTab({
  value,
  icon: Icon,
  title,
  hint,
}: {
  value: string;
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="data-active:border-primary data-active:bg-primary/5 dark:data-active:border-primary dark:data-active:bg-primary/10 bg-card border-border h-auto flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left data-active:shadow-none"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon aria-hidden="true" className="size-4" />
        {title}
      </span>
      <span className="text-muted-foreground font-mono text-[0.6875rem] font-normal">
        {hint}
      </span>
    </TabsTrigger>
  );
}

/**
 * The dialog's contents.
 *
 * Split out so that closing the dialog genuinely resets it. Base UI's portal
 * unmounts its children when the dialog is closed, so a fresh mount is a fresh
 * form — no effect watching `open` to clear a stale file, a stale error, or
 * the LaTeX from a document the user changed their mind about.
 */
function ImportDialogBody({
  target,
  onClose,
}: {
  target: ImportTarget;
  onClose: () => void;
}) {
  const { user } = useSession();
  const providers = useQuery({
    queryKey: queryKeys.providers,
    queryFn: listProviders,
    staleTime: Infinity,
  });

  const [tab, setTab] = React.useState("pdf");
  const [dragging, setDragging] = React.useState(false);
  const [chosenProvider, setChosenProvider] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [latex, setLatex] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [checkingFile, setCheckingFile] = React.useState(false);
  const [outcome, setOutcome] = React.useState<ImportOutcome | null>(null);

  const importLatex = useImportResumeFromLatex();
  const importPdf = useImportResumeFromPdf();
  const versionLatex = useAddResumeVersionFromLatex();
  const versionPdf = useAddResumeVersionFromPdf();

  const isVersion = target.kind === "version";
  const pending =
    importLatex.isPending ||
    importPdf.isPending ||
    versionLatex.isPending ||
    versionPdf.isPending;
  const error =
    importLatex.error ??
    importPdf.error ??
    versionLatex.error ??
    versionPdf.error;
  const guidance = resumeErrorGuidance(error);

  // Only providers the account actually holds a key for can run an extraction,
  // so the list is the intersection of the catalog and the user's keys.
  const withKeys = React.useMemo(
    () => new Set(user?.providers_with_keys ?? []),
    [user?.providers_with_keys],
  );
  const options = React.useMemo(
    () =>
      (providers.data?.providers ?? [])
        .filter((provider) => withKeys.has(provider.id))
        .map((provider) => ({ id: provider.id, label: provider.label })),
    [providers.data, withKeys],
  );

  // Derived rather than seeded in an effect: the account default when it is
  // usable, otherwise the first provider that has a key.
  const fallbackProvider =
    user?.default_provider && withKeys.has(user.default_provider)
      ? user.default_provider
      : (options[0]?.id ?? "");
  const provider = chosenProvider ?? fallbackProvider;

  async function handleFileChange(selected: File | null) {
    setFile(selected);
    setFileError(null);
    if (!selected) return;
    setCheckingFile(true);
    try {
      setFileError(await checkPdfFile(selected));
    } finally {
      setCheckingFile(false);
    }
  }

  async function submit() {
    if (!provider) return;
    try {
      if (tab === "latex") {
        const response = isVersion
          ? await versionLatex.mutateAsync({
              id: target.resumeId,
              body: { latex, provider },
            })
          : await importLatex.mutateAsync({
              latex,
              name: name.trim() || null,
              provider,
            });
        setOutcome({
          warnings: response.warnings ?? [],
          resumeId: response.resume.id,
        });
        return;
      }

      if (!file) return;
      const response = isVersion
        ? await versionPdf.mutateAsync({
            id: target.resumeId,
            options: { file, provider },
          })
        : await importPdf.mutateAsync({
            file,
            name: name.trim() || undefined,
            provider,
          });
      setOutcome({
        warnings: response.warnings ?? [],
        resumeId: response.resume.id,
      });
    } catch {
      // Reported from the mutation's own error state below.
    }
  }

  const canSubmit =
    Boolean(provider) &&
    (tab === "latex"
      ? latex.trim().length >= MIN_LATEX_CHARS
      : Boolean(file) && !fileError && !checkingFile);

  if (outcome) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            {isVersion ? "Version added" : "Resume imported"}
          </DialogTitle>
          <DialogDescription>
            An AI model read this document. Check what it produced before you
            tailor from it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="bg-diff-added text-diff-added-foreground border-diff-added-border flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium">
            <CheckIcon aria-hidden="true" className="size-4" strokeWidth={2.5} />
            {isVersion
              ? "The new version is now the current one."
              : "Saved to your library."}
          </p>
          <WarningList warnings={outcome.warnings} />
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          {!isVersion ? (
            <Button
              size="sm"
              render={
                <Link
                  href={{
                    pathname: "/resumes",
                    query: { id: outcome.resumeId },
                  }}
                  onClick={onClose}
                />
              }
            >
              Review the import
            </Button>
          ) : null}
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isVersion ? "Add a version from a document" : "Import a resume"}
        </DialogTitle>
        <DialogDescription>
          {isVersion
            ? `A new version of “${target.resumeName}”, extracted from a document you already have.`
            : "Paste LaTeX or upload a PDF. An AI model reads it into structured fields you can then edit."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5 py-2">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (typeof value === "string") setTab(value);
          }}
          className="gap-4"
        >
          {/* The two sources as choice cards; still a real tab list, so the
              arrow keys and the selected state work as they should. */}
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 group-data-horizontal/tabs:h-auto">
            <SourceTab
              value="pdf"
              icon={FileUpIcon}
              title="Upload a PDF"
              hint={`Up to ${MAX_PDF_PAGES} pages`}
            />
            <SourceTab
              value="latex"
              icon={ScrollTextIcon}
              title="Paste LaTeX"
              hint="The .tex source"
            />
          </TabsList>

          <TabsContent value="pdf" className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="import-pdf"
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void handleFileChange(event.dataTransfer.files?.[0] ?? null);
                }}
                className={cn(
                  "has-focus-visible:ring-ring/50 flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors has-focus-visible:ring-3",
                  dragging
                    ? "border-primary bg-primary/5"
                    : fileError
                      ? "border-destructive/40 bg-destructive/5"
                      : "bg-muted/40 hover:border-foreground/25",
                )}
              >
                <input
                  id="import-pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  aria-invalid={fileError ? true : undefined}
                  aria-describedby="import-pdf-hint"
                  onChange={(event) =>
                    void handleFileChange(event.target.files?.[0] ?? null)
                  }
                />
                {file ? (
                  <span className="bg-card flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium shadow-[0_6px_20px_rgb(21_24_31/0.08)]">
                    {checkingFile ? (
                      <Spinner className="size-4" />
                    ) : fileError ? (
                      <TriangleAlertIcon aria-hidden="true" className="text-destructive size-4 shrink-0" />
                    ) : (
                      <CheckIcon aria-hidden="true" className="text-diff-added-foreground size-4 shrink-0" />
                    )}
                    <span className="truncate">{file.name}</span>
                    <span className="text-muted-foreground font-mono text-xs font-normal">
                      {(file.size / 1_000_000).toFixed(1)} MB
                    </span>
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className="bg-card text-primary flex size-11 items-center justify-center rounded-xl shadow-[0_6px_20px_rgb(21_24_31/0.08)] ring-1 ring-foreground/10"
                  >
                    <FileUpIcon className="size-5" />
                  </span>
                )}
                <span className="text-sm">
                  <span className="text-primary font-medium">
                    {file ? "Choose another file" : "Choose a PDF"}
                  </span>{" "}
                  <span className="text-muted-foreground">or drop it here</span>
                </span>
              </label>
              <p id="import-pdf-hint" className="text-muted-foreground text-xs text-pretty">
                At most {MAX_PDF_BYTES / 1_000_000} MB and {MAX_PDF_PAGES} pages.
                A scan with no text layer is read from page images instead, and
                is marked as such.
              </p>
              {checkingFile ? (
                <p className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Spinner className="size-3" />
                  Checking the file…
                </p>
              ) : null}
              {fileError ? (
                <p role="alert" className="text-destructive text-xs text-pretty">
                  {fileError}
                </p>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="latex" className="space-y-1.5">
            <Label htmlFor="import-latex">LaTeX source</Label>
            <Textarea
              id="import-latex"
              value={latex}
              rows={9}
              spellCheck={false}
              placeholder={"\\documentclass{article}\n\\begin{document}\n…"}
              className="bg-code text-code-foreground border-code-border rounded-xl font-mono text-xs"
              aria-describedby="import-latex-hint"
              onChange={(event) => setLatex(event.target.value)}
            />
            <p id="import-latex-hint" className="text-muted-foreground text-xs">
              {latex.trim().length < MIN_LATEX_CHARS
                ? `At least ${MIN_LATEX_CHARS} characters.`
                : `${latex.length.toLocaleString()} characters.`}
            </p>
          </TabsContent>
        </Tabs>

        <div className="grid gap-4 sm:grid-cols-2">
          {!isVersion ? (
            <div className="space-y-1.5">
              <Label htmlFor="import-name">Name (optional)</Label>
              <Input
                id="import-name"
                value={name}
                maxLength={LIMITS.resumeName}
                placeholder="Taken from the document"
                className="h-10 rounded-lg"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          ) : null}
          <div className={cn(isVersion && "sm:col-span-2")}>
            {providers.isLoading ? (
              <p className="text-muted-foreground flex items-center gap-2 pt-7 text-xs">
                <Spinner className="size-3" />
                Checking your providers…
              </p>
            ) : (
              <ProviderPicker
                value={provider}
                options={options}
                onChange={setChosenProvider}
                disabled={pending}
              />
            )}
          </div>
        </div>

        {error ? (
          <div className="space-y-2">
            <ErrorState error={error} title={guidance?.title} />
            {guidance?.hint ? (
              <p className="text-muted-foreground text-xs text-pretty">
                {guidance.hint}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!canSubmit || pending}
          onClick={() => void submit()}
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending ? "Reading the document…" : isVersion ? "Add version" : "Import resume"}
        </Button>
      </DialogFooter>
    </>
  );
}

export interface ImportResumeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ImportTarget;
}

export function ImportResumeDialog({
  open,
  onOpenChange,
  target,
}: ImportResumeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl sm:p-7">
        <ImportDialogBody target={target} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
