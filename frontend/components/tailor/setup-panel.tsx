"use client";

import * as React from "react";
import Link from "next/link";
import { Controller, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "cn";
import { DatabaseIcon, SparklesIcon } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ConfirmDialog,
  ErrorState,
  Spinner,
  TextSkeleton,
} from "@/components/common";
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
  buildTailorSchema,
  type RunLabels,
  type TailorFormValues,
} from "./form-values";
import { PickerSelect, type PickerOption } from "./picker-select";

/**
 * Everything a tailoring run is assembled from.
 *
 * Works in both deployment shapes, which is why it is deliberately NOT wrapped
 * in <RequiresStorage>. In `multi_user` a run names a saved resume and either a
 * saved or a pasted job description. In `demo` there is no database and no
 * account: the server tailors its own built-in sample resume against pasted
 * text, which is a real product mode rather than a degraded one, so the resume
 * picker and the saved-JD tab simply do not appear there.
 *
 * The panel collapses to a one-line summary once a result is on screen — the
 * review is what deserves the viewport at that point — and re-opens itself
 * whenever a submit fails validation or a run comes back with an error, since
 * neither is fixable from a hidden form.
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
  storage: boolean;
  user: User | null;
  /** Preselections from the query string: /?resume=…&jd=… */
  initialResumeId?: string;
  initialJdId?: string;
  isRunning: boolean;
  /** A result is on screen, so running again replaces it and spends a call. */
  hasResult: boolean;
  onRun: (request: TailorRequest, labels: RunLabels) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SetupPanel({
  storage,
  user,
  initialResumeId,
  initialJdId,
  isRunning,
  hasResult,
  onRun,
  open,
  onOpenChange,
}: SetupPanelProps) {
  const resumesQuery = useResumeOptions(storage);
  const jdsQuery = useJdOptions(storage);
  const providersQuery = useProviderOptions();

  const resumes = resumesQuery.data?.resumes ?? NO_RESUMES;
  const jds = jdsQuery.data?.jds ?? NO_JDS;
  const providers = providersQuery.data?.providers ?? NO_PROVIDERS;

  const keyedProviders = React.useMemo(
    () => new Set(user?.providers_with_keys ?? []),
    [user],
  );

  const schema = React.useMemo(() => buildTailorSchema(storage), [storage]);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<TailorFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      resumeId: "",
      jdSource: storage ? "saved" : "paste",
      jdId: "",
      jobDescription: "",
      provider: "",
      model: "",
      compile: true,
      requireOnePage: true,
      saveRun: storage,
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
    if (!storage || pickedResume.current || resumes.length === 0) return;
    pickedResume.current = true;
    const preferred =
      resumes.find((resume) => resume.id === initialResumeId) ?? resumes[0];
    setValue("resumeId", preferred.id);
  }, [storage, resumes, initialResumeId, setValue]);

  const pickedJd = React.useRef(false);
  React.useEffect(() => {
    if (!storage || pickedJd.current || jdsQuery.isPending) return;
    pickedJd.current = true;
    if (jds.length === 0) {
      // Nothing saved to point at, so the only workable source is pasted text.
      setValue("jdSource", "paste");
      return;
    }
    const preferred = jds.find((jd) => jd.id === initialJdId) ?? jds[0];
    setValue("jdId", preferred.id);
  }, [storage, jds, jdsQuery.isPending, initialJdId, setValue]);

  const pickedProvider = React.useRef(false);
  React.useEffect(() => {
    if (!storage || pickedProvider.current || providers.length === 0) return;
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
    if (preferred === user?.default_provider && user?.default_model) {
      setValue("model", user.default_model);
    }
  }, [storage, providers, user, keyedProviders, setValue]);

  // ------------------------------------------------------------------------

  const selectedResume = resumes.find((resume) => resume.id === values.resumeId);
  const selectedJd = jds.find((jd) => jd.id === values.jdId);
  const selectedProvider = providers.find(
    (provider) => provider.id === values.provider,
  );

  const effectiveModel =
    values.model.trim() || selectedProvider?.default_model || "";

  const labels: RunLabels = {
    resume: storage
      ? (selectedResume?.name ?? "No resume selected")
      : "Built-in sample resume",
    jd:
      storage && values.jdSource === "saved"
        ? (selectedJd?.title ?? "No job description selected")
        : "Pasted job description",
    // The human label ("OpenAI"), not the id: these strings go into sentences
    // like "spends one OpenAI completion".
    provider:
      selectedProvider?.label ||
      values.provider ||
      "the server's configured provider",
    model: effectiveModel || "its default model",
  };

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
    meta: storage && !keyedProviders.has(provider.id) ? "no key" : undefined,
  }));

  function onValid(formValues: TailorFormValues) {
    const request = buildTailorRequest(formValues, storage);
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
    // A collapsed panel cannot show the user what is wrong with it.
    onOpenChange(true);
    const first = FOCUS_ORDER.find((name) => formErrors[name]);
    if (!first) return;
    // The panel may have been un-hidden a moment ago; focus after it paints.
    requestAnimationFrame(() => fieldRefs.current[first]?.focus());
  }

  // Registered once each: `register()` is called here rather than inline so a
  // field is not registered twice just to compose a ref onto it.
  const jobDescriptionField = register("jobDescription");
  const modelField = register("model");

  const jdLength = values.jobDescription.trim().length;
  const usingSavedJd = storage && values.jdSource === "saved";
  const savedJdsUnavailable = storage && !jdsQuery.isPending && jds.length === 0;
  const noResumes = storage && !resumesQuery.isPending && resumes.length === 0;
  const providerNeedsKey =
    storage && Boolean(values.provider) && !keyedProviders.has(values.provider);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Inputs</CardTitle>
        <CardDescription>
          {open ? (
            storage ? (
              "Pick a resume and a job description, then choose the model that will read them."
            ) : (
              "This server has no database, so it tailors its own sample resume against the job description you paste."
            )
          ) : (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="text-foreground font-medium">{labels.resume}</span>
              <span aria-hidden="true">→</span>
              <span className="text-foreground font-medium">{labels.jd}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-xs">
                {values.provider || "server default"}
                {effectiveModel ? `/${effectiveModel}` : ""}
              </span>
            </span>
          )}
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls="tailor-inputs"
            onClick={() => onOpenChange(!open)}
          >
            {open ? "Hide" : "Change inputs"}
          </Button>
        </CardAction>
      </CardHeader>

      <form
        noValidate
        // `handleSubmit` is invoked here rather than during render so the
        // validation callbacks are unambiguously event handlers.
        onSubmit={(event) => {
          void handleSubmit(onValid, onInvalid)(event);
        }}
      >
        <div id="tailor-inputs" hidden={!open}>
          <CardContent className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
              {/* --- Resume ------------------------------------------------ */}
              {!storage ? (
                <FormField id={RESUME_ID} label="Resume">
                  <div className="text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm">
                    <DatabaseIcon
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <p className="text-pretty">
                      The server&apos;s built-in sample resume is used. Saved
                      resumes need a database, which this deployment does not
                      have.
                    </p>
                  </div>
                </FormField>
              ) : resumesQuery.isPending ? (
                <FormField id={RESUME_ID} label="Resume">
                  <TextSkeleton lines={2} />
                </FormField>
              ) : resumesQuery.isError ? (
                <FormField id={RESUME_ID} label="Resume">
                  <ErrorState
                    variant="bare"
                    error={resumesQuery.error}
                    title="Could not load your resumes"
                    onRetry={() => resumesQuery.refetch()}
                  />
                </FormField>
              ) : noResumes ? (
                <FormField id={RESUME_ID} label="Resume">
                  <div className="rounded-lg border border-dashed px-3 py-2.5 text-sm">
                    <p className="text-muted-foreground text-pretty">
                      You have no saved resumes yet. Import one — from a PDF,
                      from LaTeX, or by typing it — and it becomes selectable
                      here.
                    </p>
                    <ButtonLink
                      className="mt-2"
                      variant="outline"
                      size="sm"
                      href="/resumes"
                    >
                      Add a resume
                    </ButtonLink>
                  </div>
                </FormField>
              ) : (
                <FormField
                  id={RESUME_ID}
                  label="Resume"
                  error={errors.resumeId?.message}
                  hint={
                    selectedResume
                      ? `Version ${selectedResume.version} · ${selectedResume.source_type} import`
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
                  />
                </FormField>
              )}

              {/* --- Job description --------------------------------------- */}
              <FormField
                id={usingSavedJd ? JD_ID : JD_TEXT_ID}
                label="Job description"
                action={
                  storage ? (
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
                          <TabsList className="h-7">
                            <TabsTrigger
                              value="saved"
                              disabled={savedJdsUnavailable}
                            >
                              Saved
                            </TabsTrigger>
                            <TabsTrigger value="paste">Paste</TabsTrigger>
                          </TabsList>
                        </Tabs>
                      )}
                    />
                  ) : null
                }
                error={
                  usingSavedJd
                    ? errors.jdId?.message
                    : errors.jobDescription?.message
                }
                hint={
                  usingSavedJd ? (
                    <span className="line-clamp-2">
                      {selectedJd?.excerpt || "Your saved job descriptions."}
                    </span>
                  ) : (
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>
                        Not saved anywhere
                        {storage
                          ? " — keep it under Job descriptions to reuse it"
                          : ""}
                        .
                      </span>
                      <span
                        className={cn(
                          "tabular-nums",
                          jdLength > JD_MAX_CHARACTERS
                            ? "text-destructive"
                            : "text-muted-foreground/70",
                        )}
                      >
                        {jdLength.toLocaleString()} /{" "}
                        {JD_MAX_CHARACTERS.toLocaleString()}
                      </span>
                    </span>
                  )
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
                    <PickerSelect
                      id={JD_ID}
                      name="jdId"
                      control={control}
                      options={jdOptions}
                      placeholder="Choose a job description"
                      invalid={Boolean(errors.jdId)}
                      describedBy={
                        errors.jdId ? fieldErrorId(JD_ID) : fieldHintId(JD_ID)
                      }
                      triggerRef={(element) => {
                        fieldRefs.current.jdId = element;
                      }}
                    />
                  )
                ) : (
                  <Textarea
                    id={JD_TEXT_ID}
                    rows={6}
                    spellCheck={false}
                    placeholder="Paste the full job description — responsibilities, requirements, the lot. The model reads it as reference data, never as instructions."
                    className="max-h-64 min-h-32"
                    aria-invalid={Boolean(errors.jobDescription)}
                    aria-describedby={
                      errors.jobDescription
                        ? fieldErrorId(JD_TEXT_ID)
                        : fieldHintId(JD_TEXT_ID)
                    }
                    {...jobDescriptionField}
                    ref={(element) => {
                      jobDescriptionField.ref(element);
                      fieldRefs.current.jobDescription = element;
                    }}
                  />
                )}
              </FormField>
            </div>

            <Separator />

            {/* --- Model and run options ---------------------------------- */}
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  id={PROVIDER_ID}
                  label="Provider"
                  error={errors.provider?.message}
                  hint={
                    providerNeedsKey ? (
                      <span className="text-warning-foreground">
                        No API key saved for this provider.{" "}
                        <Link
                          href="/settings"
                          className="underline underline-offset-3"
                        >
                          Add one in Settings
                        </Link>{" "}
                        or the run will fail.
                      </span>
                    ) : storage ? (
                      "Your key, your account."
                    ) : (
                      "Optional override."
                    )
                  }
                >
                  <PickerSelect
                    id={PROVIDER_ID}
                    name="provider"
                    control={control}
                    options={providerOptions}
                    placeholder={storage ? "Choose a provider" : "Server default"}
                    invalid={Boolean(errors.provider)}
                    describedBy={describedBy(PROVIDER_ID, {
                      error: errors.provider,
                      hint: true,
                    })}
                    triggerRef={(element) => {
                      fieldRefs.current.provider = element;
                    }}
                  />
                </FormField>

                <FormField
                  id={MODEL_ID}
                  label="Model"
                  hint={
                    selectedProvider?.default_model
                      ? `Blank uses ${selectedProvider.default_model}.`
                      : "Blank uses the provider's default."
                  }
                >
                  <Input
                    id={MODEL_ID}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={selectedProvider?.default_model || "Default"}
                    aria-describedby={fieldHintId(MODEL_ID)}
                    {...modelField}
                    ref={(element) => {
                      modelField.ref(element);
                      fieldRefs.current.model = element;
                    }}
                  />
                </FormField>
              </div>

              <fieldset className="space-y-2.5">
                <legend className="mb-1.5 text-sm font-medium">
                  Run options
                </legend>
                <OptionSwitch
                  id="tailor-compile"
                  label="Compile the PDF"
                  hint="Off returns the changes, the diff and the LaTeX in seconds, with no Tectonic run."
                  checked={values.compile}
                  onChange={(next) => setValue("compile", next)}
                />
                <OptionSwitch
                  id="tailor-one-page"
                  label="Require one page"
                  hint="Lets the server spend its single repair attempt shortening a resume that spills onto page two."
                  checked={values.requireOnePage}
                  onChange={(next) => setValue("requireOnePage", next)}
                  disabled={!values.compile}
                />
                {storage ? (
                  <OptionSwitch
                    id="tailor-save-run"
                    label="Save to History"
                    hint="Keeps the proposal, diff and LaTeX so this run can be re-compiled without paying for the model again."
                    checked={values.saveRun}
                    onChange={(next) => setValue("saveRun", next)}
                  />
                ) : null}
              </fieldset>
            </div>
          </CardContent>
        </div>

        <CardFooter className="flex-wrap gap-x-4 gap-y-3">
          <p className="text-muted-foreground min-w-0 flex-1 text-xs text-pretty">
            Running spends{" "}
            <span className="text-foreground font-medium">
              one {labels.provider} completion
            </span>
            {values.compile ? " and one Tectonic compile" : ""}. Your name,
            email, phone and links are never sent to the model.
          </p>
          <Button type="submit" size="lg" disabled={isRunning || noResumes}>
            {isRunning ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SparklesIcon data-icon="inline-start" />
            )}
            {isRunning ? "Tailoring…" : hasResult ? "Run again" : "Run tailoring"}
          </Button>
        </CardFooter>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive={false}
        title="Run tailoring again?"
        confirmLabel="Run again"
        description={`This replaces the result you are reviewing and spends another ${labels.provider} completion${values.compile ? " and another Tectonic compile" : ""}.`}
        onConfirm={() => {
          const pending = pendingRef.current;
          pendingRef.current = null;
          // Deliberately not awaited: the run's own error handling owns the
          // failure path, so this resolves at once and the dialog closes
          // rather than sitting busy for the length of the run.
          if (pending) onRun(pending.request, pending.labels);
        }}
      />
    </Card>
  );
}

function OptionSwitch({
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
    <div className={cn("flex items-start gap-2.5", disabled && "opacity-50")}>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        <p id={`${id}-hint`} className="text-muted-foreground text-xs text-pretty">
          {hint}
        </p>
      </div>
    </div>
  );
}
