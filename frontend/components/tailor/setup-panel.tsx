"use client";

import * as React from "react";
import Link from "next/link";
import { Controller, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "cn";
import { ArrowRightIcon, CheckIcon, LockIcon } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Canvas,
  ConfirmDialog,
  ErrorState,
  Spinner,
  TextSkeleton,
} from "@/components/common";
import { ResumeSheet, relativeTime, sourceLabel } from "@/components/resumes";
import { useResume } from "@/hooks/use-resumes";
import {
  JD_MAX_CHARACTERS,
  useJdOptions,
  useProviderOptions,
  useResumeOptions,
} from "@/hooks/use-tailor";
import type {
  JdSummary,
  ProviderInfo,
  ResumeSummary,
  TailorRequest,
  User,
} from "@/lib/api/types";
import { FormField, describedBy, fieldErrorId, fieldHintId } from "./form-field";
import {
  FOCUS_ORDER,
  buildTailorRequest,
  tailorSchema,
  type RunLabels,
  type TailorFormValues,
} from "./form-values";
import { PickerSelect, type PickerOption } from "./picker-select";

/**
 * Everything a tailoring run is assembled from: a saved resume and either a
 * saved or a pasted job description.
 */

// Stable identities, so the preselection effects do not re-run every render.
const NO_RESUMES: readonly ResumeSummary[] = [];
const NO_JDS: readonly JdSummary[] = [];
const NO_PROVIDERS: readonly ProviderInfo[] = [];

const RESUME_ID = "tailor-resume";
const JD_ID = "tailor-jd";
const JD_TEXT_ID = "tailor-jd-text";
const PROVIDER_ID = "tailor-provider";
const MODEL_ID = "tailor-model";

export type { RunLabels } from "./form-values";

export interface SetupPanelProps {
  user: User | null;
  /** Preselections from the query string: /tailor?resume=…&jd=… */
  initialResumeId?: string;
  initialJdId?: string;
  isRunning: boolean;
  /** A result is on screen, so running again replaces it and spends a call. */
  hasResult: boolean;
  onRun: (request: TailorRequest, labels: RunLabels) => void;
}

export function SetupPanel({
  user,
  initialResumeId,
  initialJdId,
  isRunning,
  hasResult,
  onRun,
}: SetupPanelProps) {
  const resumesQuery = useResumeOptions();
  const jdsQuery = useJdOptions();
  const providersQuery = useProviderOptions();

  const resumes = resumesQuery.data?.resumes ?? NO_RESUMES;
  const jds = jdsQuery.data?.jds ?? NO_JDS;
  const providers = providersQuery.data?.providers ?? NO_PROVIDERS;

  const keyedProviders = React.useMemo(
    () => new Set(user?.providers_with_keys ?? []),
    [user],
  );

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<TailorFormValues>({
    resolver: zodResolver(tailorSchema),
    defaultValues: {
      resumeId: "",
      jdSource: "saved",
      jdId: "",
      jobDescription: "",
      provider: "",
      model: "",
      compile: true,
      requireOnePage: true,
      saveRun: true,
    },
  });

  // `useWatch` rather than `watch()`: it subscribes through the control and
  // returns a plain value, which keeps this component memoizable. `watch()`
  // hands back a function the React Compiler has to bail out on.
  const values = useWatch({ control }) as TailorFormValues;

  const fieldRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const pendingRef = React.useRef<{
    request: TailorRequest;
    labels: RunLabels;
  } | null>(null);

  // --- one-time preselection, once each list has actually arrived ----------

  const pickedResume = React.useRef(false);
  React.useEffect(() => {
    if (pickedResume.current || resumes.length === 0) return;
    pickedResume.current = true;
    const preferred =
      resumes.find((resume) => resume.id === initialResumeId) ?? resumes[0];
    setValue("resumeId", preferred.id);
  }, [resumes, initialResumeId, setValue]);

  const pickedJd = React.useRef(false);
  React.useEffect(() => {
    if (pickedJd.current || jdsQuery.isPending) return;
    pickedJd.current = true;
    if (jds.length === 0) {
      // Nothing saved to point at, so the only workable source is pasted text.
      setValue("jdSource", "paste");
      return;
    }
    const preferred = jds.find((jd) => jd.id === initialJdId) ?? jds[0];
    setValue("jdId", preferred.id);
  }, [jds, jdsQuery.isPending, initialJdId, setValue]);

  const pickedProvider = React.useRef(false);
  React.useEffect(() => {
    if (pickedProvider.current || providers.length === 0) return;
    pickedProvider.current = true;
    // The user's own default first, then any provider they hold a key for.
    // Guessing beyond that would silently point a run at a key they lack.
    const preferred =
      (user?.default_provider &&
        providers.find((provider) => provider.id === user.default_provider)
          ?.id) ||
      providers.find((provider) => keyedProviders.has(provider.id))?.id ||
      "";
    if (!preferred) return;
    setValue("provider", preferred);
  }, [providers, user, keyedProviders, setValue]);

  // ------------------------------------------------------------------------

  const selectedResume = resumes.find((resume) => resume.id === values.resumeId);
  const selectedJd = jds.find((jd) => jd.id === values.jdId);
  const selectedProvider = providers.find(
    (provider) => provider.id === values.provider,
  );

  // What a blank Model field means: the user's choice for this provider in
  // Settings, else the provider's built-in default.
  const providerModel =
    (selectedProvider && user?.provider_models?.[selectedProvider.id]) ||
    selectedProvider?.default_model ||
    "";
  const effectiveModel = values.model.trim() || providerModel;

  // The human label ("OpenAI"), not the id: it goes into sentences like
  // "spends one OpenAI completion".
  const providerName = selectedProvider?.label || values.provider;

  const labels: RunLabels = {
    resume: selectedResume?.name ?? "No resume selected",
    jd:
      values.jdSource === "saved"
        ? (selectedJd?.title ?? "No job description selected")
        : "Pasted job description",
    provider: providerName,
    model: effectiveModel,
  };

  // Before a provider is chosen there is no name to put in front of
  // "completion".
  const completion = (count: "one" | "another") =>
    `${count} ${providerName || "AI"} completion`;

  const resumeOptions: PickerOption[] = resumes.map((resume) => ({
    value: resume.id,
    label: resume.name,
    meta: `v${resume.version}`,
  }));

  const jdOptions: PickerOption[] = jds.map((jd) => ({
    value: jd.id,
    label: jd.title,
    meta: `v${jd.version}`,
  }));

  const providerOptions: PickerOption[] = providers.map((provider) => ({
    value: provider.id,
    label: provider.label,
    meta: keyedProviders.has(provider.id) ? undefined : "no key",
  }));

  function onValid(formValues: TailorFormValues) {
    const request = buildTailorRequest(formValues);
    if (hasResult) {
      // A result is on screen, so this run replaces a review the user may not
      // have finished — and spends another provider call. Ask first.
      pendingRef.current = { request, labels };
      setConfirmOpen(true);
      return;
    }
    onRun(request, labels);
  }

  function onInvalid(formErrors: FieldErrors<TailorFormValues>) {
    const first = FOCUS_ORDER.find((name) => formErrors[name]);
    if (!first) return;
    // Focus after the error text paints, so it is announced with the field.
    requestAnimationFrame(() => fieldRefs.current[first]?.focus());
  }

  // Registered once each: `register()` is called here rather than inline so a
  // field is not registered twice just to compose a ref onto it.
  const jobDescriptionField = register("jobDescription");
  const modelField = register("model");

  const jdLength = values.jobDescription.trim().length;
  const usingSavedJd = values.jdSource === "saved";
  const savedJdsUnavailable = !jdsQuery.isPending && jds.length === 0;
  const noResumes = !resumesQuery.isPending && resumes.length === 0;
  const providerNeedsKey =
    Boolean(values.provider) && !keyedProviders.has(values.provider);

  return (
    <form
      noValidate
      // `handleSubmit` is invoked here rather than during render so the
      // validation callbacks are unambiguously event handlers.
      onSubmit={(event) => {
        void handleSubmit(onValid, onInvalid)(event);
      }}
      className="grid items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_30rem]"
    >
      <div className="bg-card flex min-w-0 flex-col overflow-hidden rounded-[1.25rem] ring-1 ring-foreground/10">
        {/* --- 01 Resume ------------------------------------------------- */}
        <Step number="01">
          {resumesQuery.isPending ? (
            <FormField id={RESUME_ID} label={<StepTitle>Resume</StepTitle>}>
              <TextSkeleton lines={2} />
            </FormField>
          ) : resumesQuery.isError ? (
            <FormField id={RESUME_ID} label={<StepTitle>Resume</StepTitle>}>
              <ErrorState
                variant="bare"
                error={resumesQuery.error}
                title="Could not load your resumes"
                onRetry={() => resumesQuery.refetch()}
              />
            </FormField>
          ) : noResumes ? (
            <FormField id={RESUME_ID} label={<StepTitle>Resume</StepTitle>}>
              <div className="rounded-xl border border-dashed px-4 py-3.5 text-sm">
                <p className="text-muted-foreground text-pretty">
                  You have no saved resumes yet. Import one — from a PDF, from
                  LaTeX, or by typing it — and it becomes selectable here.
                </p>
                <ButtonLink className="mt-3" variant="outline" size="sm" href="/resumes">
                  Add a resume
                </ButtonLink>
              </div>
            </FormField>
          ) : (
            <FormField
              id={RESUME_ID}
              label={<StepTitle>Resume</StepTitle>}
              action={
                <Link
                  href="/resumes"
                  className="text-primary rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  Manage resumes
                </Link>
              }
              error={errors.resumeId?.message}
              hint={
                selectedResume
                  ? [
                      `Version ${selectedResume.version}`,
                      sourceLabel(selectedResume.source_type),
                      selectedResume.updated_at
                        ? `updated ${relativeTime(selectedResume.updated_at)}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "Your saved resumes."
              }
            >
              <PickerSelect
                id={RESUME_ID}
                name="resumeId"
                control={control}
                options={resumeOptions}
                placeholder="Choose a resume"
                invalid={Boolean(errors.resumeId)}
                describedBy={describedBy(RESUME_ID, {
                  error: errors.resumeId,
                  hint: true,
                })}
                triggerRef={(element) => {
                  fieldRefs.current.resumeId = element;
                }}
                className={TALL_FIELD}
              />
            </FormField>
          )}
        </Step>

        {/* --- 02 Job description ---------------------------------------- */}
        <Step number="02">
          <FormField
            id={usingSavedJd ? JD_ID : JD_TEXT_ID}
            label={<StepTitle>Job description</StepTitle>}
            action={
              <Controller
                control={control}
                name="jdSource"
                render={({ field }) => (
                  <Tabs
                    value={field.value}
                    onValueChange={(next) =>
                      field.onChange(next as TailorFormValues["jdSource"])
                    }
                  >
                    <TabsList>
                      <TabsTrigger value="saved" disabled={savedJdsUnavailable}>
                        Saved
                      </TabsTrigger>
                      <TabsTrigger value="paste">Paste</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
              />
            }
            error={
              usingSavedJd ? errors.jdId?.message : errors.jobDescription?.message
            }
            hint={
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
                  Read as reference data, never as instructions.
                  {!usingSavedJd
                    ? " Not saved — keep it under Job descriptions to reuse it."
                    : ""}
                </span>
                {usingSavedJd ? null : (
                  <span
                    className={cn(
                      "font-mono tabular-nums",
                      jdLength > JD_MAX_CHARACTERS
                        ? "text-destructive"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {jdLength.toLocaleString()} / {JD_MAX_CHARACTERS.toLocaleString()}
                  </span>
                )}
              </span>
            }
          >
            {usingSavedJd ? (
              jdsQuery.isPending ? (
                <TextSkeleton lines={2} />
              ) : jdsQuery.isError ? (
                <ErrorState
                  variant="bare"
                  error={jdsQuery.error}
                  title="Could not load your job descriptions"
                  onRetry={() => jdsQuery.refetch()}
                />
              ) : (
                <div className="space-y-2.5">
                  <PickerSelect
                    id={JD_ID}
                    name="jdId"
                    control={control}
                    options={jdOptions}
                    placeholder="Choose a job description"
                    invalid={Boolean(errors.jdId)}
                    describedBy={errors.jdId ? fieldErrorId(JD_ID) : fieldHintId(JD_ID)}
                    triggerRef={(element) => {
                      fieldRefs.current.jdId = element;
                    }}
                    className={TALL_FIELD}
                  />
                  {selectedJd?.excerpt ? (
                    <div className="bg-code text-code-foreground border-code-border relative max-h-28 overflow-hidden rounded-xl border px-4 py-3 text-sm leading-6 whitespace-pre-line">
                      {selectedJd.excerpt}
                      <div
                        aria-hidden="true"
                        className="from-code/0 to-code absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b"
                      />
                    </div>
                  ) : null}
                </div>
              )
            ) : (
              <Textarea
                id={JD_TEXT_ID}
                rows={7}
                spellCheck={false}
                placeholder="Paste the full job description — responsibilities, requirements, the lot."
                className="max-h-72 min-h-40 rounded-xl px-3.5 py-3 leading-6"
                aria-invalid={Boolean(errors.jobDescription)}
                aria-describedby={
                  errors.jobDescription ? fieldErrorId(JD_TEXT_ID) : fieldHintId(JD_TEXT_ID)
                }
                {...jobDescriptionField}
                ref={(element) => {
                  jobDescriptionField.ref(element);
                  fieldRefs.current.jobDescription = element;
                }}
              />
            )}
          </FormField>
        </Step>

        {/* --- 03 Model and output --------------------------------------- */}
        <Step number="03" className="space-y-4">
          <p className="font-heading text-[1.0625rem] leading-7 font-semibold tracking-tight">
            Model and output
          </p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
            <FormField
              id={PROVIDER_ID}
              label="Provider"
              error={errors.provider?.message}
              hint={
                providerNeedsKey ? (
                  <span className="text-warning-foreground">
                    No API key saved for this provider.{" "}
                    <Link href="/settings" className="underline underline-offset-3">
                      Add one in Settings
                    </Link>{" "}
                    or the run will fail.
                  </span>
                ) : (
                  "Your key, your account."
                )
              }
            >
              <PickerSelect
                id={PROVIDER_ID}
                name="provider"
                control={control}
                options={providerOptions}
                placeholder="Choose a provider"
                invalid={Boolean(errors.provider)}
                describedBy={describedBy(PROVIDER_ID, {
                  error: errors.provider,
                  hint: true,
                })}
                triggerRef={(element) => {
                  fieldRefs.current.provider = element;
                }}
                className={TALL_FIELD}
              />
            </FormField>

            <FormField
              id={MODEL_ID}
              label="Model"
              hint={
                providerModel
                  ? `Blank uses ${providerModel}.`
                  : "Blank uses the provider's default."
              }
            >
              <Input
                id={MODEL_ID}
                spellCheck={false}
                autoComplete="off"
                placeholder={providerModel || "Default"}
                aria-describedby={fieldHintId(MODEL_ID)}
                className="h-11 rounded-xl px-3.5 font-mono md:text-[0.8125rem]"
                {...modelField}
                ref={(element) => {
                  modelField.ref(element);
                  fieldRefs.current.model = element;
                }}
              />
            </FormField>
          </div>

          <fieldset>
            <legend className="sr-only">Run options</legend>
            <div className="flex flex-wrap gap-2">
              <OptionPill
                id="tailor-compile"
                label="Compile the PDF"
                hint="Off returns the changes, the diff and the LaTeX in seconds, with no Tectonic run."
                checked={values.compile}
                onChange={(next) => setValue("compile", next)}
              />
              <OptionPill
                id="tailor-one-page"
                label="Keep to one page"
                hint="Lets the server spend its single repair attempt shortening a resume that spills onto page two."
                checked={values.requireOnePage}
                onChange={(next) => setValue("requireOnePage", next)}
                disabled={!values.compile}
              />
              <OptionPill
                id="tailor-save-run"
                label="Save to History"
                hint="Keeps the proposal, diff and LaTeX so this run can be re-compiled without paying for the model again."
                checked={values.saveRun}
                onChange={(next) => setValue("saveRun", next)}
              />
            </div>
          </fieldset>
        </Step>

        {/* --- Run bar ---------------------------------------------------- */}
        <div className="bg-code mt-auto flex flex-col gap-4 border-t px-5 py-5 sm:flex-row sm:items-center sm:px-7">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-code-foreground font-mono text-xs">
              {completion("one")}
              {values.compile ? " · one Tectonic compile" : ""}
            </p>
            <p className="text-muted-foreground text-[0.8125rem] leading-5 text-pretty">
              Your name, email, phone and links are never sent to the model.
            </p>
          </div>
          <Button
            type="submit"
            disabled={isRunning || noResumes}
            className="h-12 rounded-xl px-6 text-[0.9375rem]"
          >
            {isRunning ? <Spinner data-icon="inline-start" /> : null}
            {isRunning ? "Tailoring…" : hasResult ? "Run again" : "Tailor resume"}
            {isRunning ? null : <ArrowRightIcon data-icon="inline-end" />}
          </Button>
        </div>
      </div>

      <ResumePreviewPanel
        resumeId={selectedResume?.id ?? null}
        version={selectedResume?.version ?? null}
        noResumes={noResumes}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive={false}
        title="Run tailoring again?"
        confirmLabel="Run again"
        description={`This replaces the result you are reviewing and spends ${completion("another")}${values.compile ? " and another Tectonic compile" : ""}.`}
        onConfirm={() => {
          const pending = pendingRef.current;
          pendingRef.current = null;
          // Deliberately not awaited: the run's own error handling owns the
          // failure path, so this resolves at once and the dialog closes
          // rather than sitting busy for the length of the run.
          if (pending) onRun(pending.request, pending.labels);
        }}
      />
    </form>
  );
}

const TALL_FIELD = "data-[size=default]:h-11 rounded-xl pl-3.5 pr-3";

/** One numbered section of the form. */
function Step({
  number,
  className,
  children,
}: {
  number: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] border-b px-5 py-6 last-of-type:border-b-0 sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:px-7">
      <span aria-hidden="true" className="text-muted-foreground pt-1 font-mono text-xs">
        {number}
      </span>
      <div className={cn("min-w-0", className)}>{children}</div>
    </div>
  );
}

function StepTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-heading text-[1.0625rem] leading-7 font-semibold tracking-tight">
      {children}
    </span>
  );
}

/** A run option as a toggle pill over a visually hidden, real checkbox. */
function OptionPill({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      title={hint}
      className={cn(
        "relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-full pr-3.5 pl-2 text-[0.8125rem] transition-colors select-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        checked
          ? "bg-primary/10 text-primary font-medium dark:bg-primary/15"
          : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 items-center justify-center rounded-full",
          checked ? "bg-primary text-primary-foreground" : "ring-input ring-[1.5px] ring-inset",
        )}
      >
        {checked ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
      </span>
      {label}
      <span id={`${id}-hint`} className="sr-only">
        {hint}
      </span>
    </label>
  );
}

/** Preview of the resume about to be tailored. */
function ResumePreviewPanel({
  resumeId,
  version,
  noResumes,
}: {
  resumeId: string | null;
  version: number | null;
  noResumes: boolean;
}) {
  const detail = useResume(resumeId);

  let body: React.ReactNode;
  if (noResumes) {
    body = <PanelNote>Add a resume and it will be shown here before you tailor it.</PanelNote>;
  } else if (detail.data) {
    body = (
      <div role="img" aria-label={`${detail.data.resume.name}, as currently saved`} className="mx-auto w-full max-w-[25rem]">
        <ResumeSheet data={detail.data.resume.data} />
      </div>
    );
  } else if (detail.isError) {
    body = <PanelNote>This resume could not be loaded for preview. Tailoring still works.</PanelNote>;
  } else {
    body = (
      <div aria-hidden="true" className="mx-auto aspect-[210/297] w-full max-w-[25rem] bg-white/70 shadow-[0_0_0_1px_rgb(21_24_31/0.06)]" />
    );
  }

  return (
    <Canvas className="hidden flex-col gap-5 px-8 pt-6 pb-6 xl:flex">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Current version</span>
        <span className="text-muted-foreground ml-auto font-mono text-[0.6875rem]">
          {version !== null ? `v${version} · ` : ""}unchanged until you download
        </span>
      </div>
      <div className="flex flex-1 items-center">{body}</div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {SAFEGUARD_RULES.map((rule) => (
          <code
            key={rule}
            className="bg-card text-code-foreground border-code-border rounded-md border px-2 py-0.5 font-mono text-[0.6875rem]"
          >
            {rule}
          </code>
        ))}
      </div>
    </Canvas>
  );
}

/** Rules the server enforces on every run. */
const SAFEGUARD_RULES = [
  "identity → never sent",
  "no new numbers",
] as const;

function PanelNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground mx-auto max-w-72 text-center text-sm leading-6 text-pretty">
      {children}
    </p>
  );
}
