"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardSkeleton, ErrorState, LoadingState, Spinner } from "@/components/common";
import type { JobCategory, JobPrefs } from "@/lib/api/types";
import { useJobPrefs, useSaveJobPrefs } from "@/hooks/use-companies";

type PrefsValues = {
  categories: string[];
  from: string;
  to: string;
  margin: string;
  locations: string[];
  remote: boolean;
};

const DEFAULTS: PrefsValues = {
  categories: [],
  from: "0",
  to: "3",
  margin: "6",
  locations: [],
  remote: false,
};

function toValues(prefs: JobPrefs | null | undefined): PrefsValues {
  if (!prefs) return DEFAULTS;
  return {
    categories: prefs.categories,
    from: String(prefs.exp_from_years),
    to: String(prefs.exp_to_years),
    margin: String(prefs.margin_months ?? 6),
    locations: prefs.locations ?? [],
    remote: prefs.include_remote ?? false,
  };
}

/** Numbers parse here; ranges are the server's to enforce. */
function toRequest(values: PrefsValues): JobPrefs {
  return {
    categories: values.categories,
    exp_from_years: Number(values.from),
    exp_to_years: Number(values.to),
    margin_months: Math.round(Number(values.margin)),
    locations: values.locations,
    include_remote: values.remote,
  };
}

/**
 * What the user wants to hear about: job types, an experience range, the
 * margin above it, and optionally where. Saving recomputes matches server-side.
 */
export function PreferencesForm() {
  const prefs = useJobPrefs();

  if (prefs.isPending) {
    return (
      <LoadingState label="Loading job preferences">
        <CardSkeleton />
      </LoadingState>
    );
  }
  if (prefs.isError) {
    return (
      <ErrorState
        error={prefs.error}
        title="Could not load your job preferences"
        onRetry={() => void prefs.refetch()}
      />
    );
  }
  return (
    <PreferencesFields
      categories={prefs.data.categories ?? []}
      initial={toValues(prefs.data.prefs)}
      saved={Boolean(prefs.data.prefs)}
    />
  );
}

function PreferencesFields({
  categories,
  initial,
  saved,
}: {
  categories: readonly JobCategory[];
  initial: PrefsValues;
  saved: boolean;
}) {
  const save = useSaveJobPrefs();
  const [failure, setFailure] = React.useState<unknown>(null);
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { isDirty, isSubmitting, errors },
  } = useForm<PrefsValues>({ defaultValues: initial });

  const labels = React.useMemo(
    () => new Map(categories.map((category) => [category.id, category.label])),
    [categories],
  );

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      const response = await save.mutateAsync(toRequest(values));
      reset(toValues(response.prefs));
      toast.success("Saved your job preferences");
    } catch (error) {
      setFailure(error);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor="prefs-categories">Job type</Label>
          <Controller
            control={control}
            name="categories"
            rules={{ validate: (value) => value.length > 0 || "Choose at least one job type." }}
            render={({ field }) => (
              <Select
                multiple
                value={field.value}
                onValueChange={(value) => field.onChange(Array.isArray(value) ? value.map(String) : [])}
              >
                <SelectTrigger
                  id="prefs-categories"
                  className="bg-card w-full data-[size=default]:h-10"
                  onBlur={field.onBlur}
                  aria-invalid={errors.categories ? true : undefined}
                  aria-describedby={errors.categories ? "prefs-categories-error" : undefined}
                >
                  <SelectValue>
                    {(value: string[] | null) =>
                      value && value.length
                        ? value.map((id) => labels.get(id) ?? id).join(", ")
                        : "Choose job types"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.categories ? (
            <p id="prefs-categories-error" role="alert" className="text-destructive text-xs">
              {errors.categories.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="prefs-from">Experience (years)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="prefs-from"
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0"
                className="bg-card h-10 w-20"
                aria-label="From years"
                {...register("from", { required: true })}
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                id="prefs-to"
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0"
                className="bg-card h-10 w-20"
                aria-label="To years"
                {...register("to", {
                  required: true,
                  validate: (value, all) =>
                    Number(value) >= Number(all.from) || "“To” can't be less than “from”.",
                })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prefs-margin">Extra margin (months)</Label>
            <Input
              id="prefs-margin"
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              className="bg-card h-10 w-24"
              {...register("margin", { required: true })}
            />
          </div>
          {errors.to ? (
            <p role="alert" className="text-destructive w-full text-xs">
              {errors.to.message}
            </p>
          ) : null}
        </div>
      </div>

      <Controller
        control={control}
        name="locations"
        render={({ field }) => (
          <LocationInput value={field.value} onChange={field.onChange} />
        )}
      />

      <Controller
        control={control}
        name="remote"
        render={({ field }) => (
          <label className="flex w-fit items-center gap-2 text-sm">
            <Checkbox
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(Boolean(checked))}
            />
            Remote
          </label>
        )}
      />

      {failure ? <ErrorState error={failure} title="Could not save your job preferences" /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={(saved && !isDirty) || isSubmitting} className="h-10 rounded-xl px-4">
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          Save preferences
        </Button>
        {!saved ? (
          <span className="text-muted-foreground text-sm">Nothing is matched until these are saved.</span>
        ) : null}
      </div>
    </form>
  );
}

/** Cities as chips: Enter or comma adds, Backspace on an empty box removes the last. */
function LocationInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = React.useState("");

  const add = () => {
    const place = draft.trim().replace(/,+$/, "").trim();
    if (place && !value.some((item) => item.toLowerCase() === place.toLowerCase())) {
      onChange([...value, place]);
    }
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="prefs-location">Location</Label>
      <div className="bg-card focus-within:border-ring focus-within:ring-ring/50 flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5 focus-within:ring-3">
        {value.map((place) => (
          <span
            key={place}
            className="bg-muted inline-flex h-7 items-center gap-1 rounded-md pr-1 pl-2 text-sm"
          >
            {place}
            <button
              type="button"
              aria-label={`Remove ${place}`}
              onClick={() => onChange(value.filter((item) => item !== place))}
              className="text-muted-foreground hover:text-foreground rounded-sm p-0.5 outline-none focus-visible:ring-2"
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id="prefs-location"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            } else if (event.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={add}
          placeholder={value.length ? "" : "Any city — type one and press Enter"}
          autoComplete="off"
          className="placeholder:text-muted-foreground h-7 min-w-40 flex-1 bg-transparent px-1 text-sm outline-none"
        />
      </div>
    </div>
  );
}
