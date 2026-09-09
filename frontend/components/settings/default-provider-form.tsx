"use client";

import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardSkeleton, ErrorState, LoadingState, Spinner } from "@/components/common";
import type { ProviderInfo, UpdateMeRequest, User } from "@/lib/api/types";
import { useSession } from "@/hooks/use-session";
import { useUpdateMe } from "@/hooks/use-account";
import { useProviders } from "@/hooks/use-keys";
import { SettingsField, describedBy } from "./field";

/**
 * The sentinel for "I do not want a default".
 *
 * A select needs a value for every option, and an empty string is
 * indistinguishable from "nothing chosen yet" once it has been through a form
 * library. The sentinel never leaves this module: `buildDefaultsPatch` turns it
 * into the `null` the API actually needs.
 */
const NO_DEFAULT = "__none__";

const defaultsSchema = z.object({
  provider: z.string(),
  model: z
    .string()
    .trim()
    .max(200, "That model name is too long (200 characters maximum)."),
});

type DefaultsValues = z.infer<typeof defaultsSchema>;

/**
 * ⚠️ THE ONE THING TO GET RIGHT ON THIS SCREEN.
 *
 * `PATCH /api/me` reads `model_fields_set` (app/auth.py), so for
 * `default_provider` and `default_model` it distinguishes three cases, not two:
 *
 *   key absent            leave the stored value exactly as it is
 *   key present, null     CLEAR the stored value
 *   key present, string   set it (empty/whitespace also clears)
 *
 * `JSON.stringify` drops `undefined` properties, so on this side the
 * distinction is precisely `undefined` (omit) versus `null` (clear). This form
 * owns both fields outright, so it always sends both keys explicitly — the
 * reflexive `if (value) body.x = value` would make "clear my default" a
 * silent no-op, which is the exact bug this function exists to prevent.
 *
 * Clearing the provider also clears the model, and that is not tidiness. The
 * server only consults `default_model` when the request's provider matches
 * `default_provider` (app/auth.py `resolve_provider`), so a model kept without
 * a provider is data that can never be read — it would sit in the account
 * looking effective while doing nothing.
 */
export function buildDefaultsPatch(values: DefaultsValues): UpdateMeRequest {
  const provider = values.provider === NO_DEFAULT ? null : values.provider;
  const model = values.model.trim();
  return {
    default_provider: provider,
    default_model: provider === null ? null : model || null,
  };
}

/** The patch that clears both, for the explicit "clear" action. */
export const CLEAR_DEFAULTS_PATCH: UpdateMeRequest = {
  default_provider: null,
  default_model: null,
};

export function DefaultProviderForm() {
  const { user } = useSession();
  const providers = useProviders();

  if (providers.isPending || !user) {
    return (
      <LoadingState label="Loading provider defaults">
        <CardSkeleton />
      </LoadingState>
    );
  }

  if (providers.isError) {
    return (
      <ErrorState
        error={providers.error}
        onRetry={() => void providers.refetch()}
        title="Could not load the provider catalog"
      />
    );
  }

  return (
    <DefaultProviderFields
      // Remount if the identity changes underneath us, so the form can never
      // show one account's defaults while saving to another.
      key={user.id}
      user={user}
      providers={providers.data.providers ?? []}
    />
  );
}

function DefaultProviderFields({
  user,
  providers,
}: {
  user: User;
  providers: readonly ProviderInfo[];
}) {
  const updateMe = useUpdateMe();
  const [failure, setFailure] = React.useState<unknown>(null);

  const serverProvider = user.default_provider ?? "";
  const serverModel = user.default_model ?? "";

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<DefaultsValues>({
    resolver: zodResolver(defaultsSchema),
    defaultValues: {
      provider: serverProvider || NO_DEFAULT,
      model: serverModel,
    },
  });

  // Re-sync only when the SERVER's values change — after a save, or if another
  // tab changed them. Depending on the user object itself would reset the form
  // under the user's cursor on every unrelated cache write.
  React.useEffect(() => {
    reset({ provider: serverProvider || NO_DEFAULT, model: serverModel });
  }, [serverProvider, serverModel, reset]);

  // `useWatch` rather than `watch()`: the latter returns a fresh function on
  // every render, which opts the whole component out of the React Compiler.
  const selectedProvider = useWatch({ control, name: "provider" });
  const hasDefault = serverProvider !== "" || serverModel !== "";
  const chosen = providers.find((entry) => entry.id === selectedProvider);
  const missingKey =
    chosen !== undefined &&
    !(user.providers_with_keys ?? []).includes(chosen.id);

  const items = React.useMemo(
    () => [
      { value: NO_DEFAULT, label: "No default" },
      ...providers.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    ],
    [providers],
  );

  async function save(patch: UpdateMeRequest, message: string) {
    setFailure(null);
    try {
      await updateMe.mutateAsync(patch);
      toast.success(message);
    } catch (error) {
      setFailure(error);
    }
  }

  const onSubmit = handleSubmit((values) =>
    save(buildDefaultsPatch(values), "Saved your tailoring defaults"),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsField
          id="default-provider"
          label="Default provider"
          hint={
            selectedProvider === NO_DEFAULT
              ? "Without a default, every tailoring run has to name a provider itself."
              : "Used whenever a tailoring run does not name one."
          }
        >
          <Controller
            control={control}
            name="provider"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(value) => field.onChange(String(value))}
              >
                <SelectTrigger
                  id="default-provider"
                  className="w-full"
                  onBlur={field.onBlur}
                  aria-describedby={describedBy("default-provider", {
                    hint: true,
                  })}
                >
                  {/* A render function rather than the `items` prop: the label
                      shown in the trigger then comes from the same array the
                      list is built from, with no second lookup table to keep in
                      step. */}
                  <SelectValue>
                    {(value) =>
                      // A stored provider outside the catalog is shown raw
                      // rather than mislabelled: `PATCH /api/me` accepts every
                      // name in app/llm.py `supported_providers()`, which
                      // includes the operator-only `custom` that
                      // `GET /api/providers` deliberately withholds.
                      items.find((item) => item.value === value)?.label ??
                      String(value ?? "")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </SettingsField>

        <SettingsField
          id="default-model"
          label="Default model"
          error={errors.model?.message}
          hint={
            selectedProvider === NO_DEFAULT
              ? "A model only takes effect alongside a default provider."
              : chosen?.default_model
                ? `Leave blank to use ${chosen.default_model}.`
                : "This provider has no built-in model, so one has to be named here or by the server."
          }
        >
          <Input
            {...register("model")}
            id="default-model"
            className="font-mono"
            spellCheck={false}
            autoComplete="off"
            disabled={selectedProvider === NO_DEFAULT}
            placeholder={chosen?.default_model || "provider/model-name"}
            aria-invalid={errors.model ? true : undefined}
            aria-describedby={describedBy("default-model", {
              error: errors.model,
              hint: true,
            })}
          />
        </SettingsField>
      </div>

      {missingKey ? (
        <p className="bg-warning text-warning-foreground border-warning-border/70 rounded-md border px-2.5 py-1.5 text-xs text-pretty">
          <TriangleAlertIcon
            aria-hidden="true"
            className="mr-1.5 inline size-3.5 -translate-y-px"
          />
          You have no {chosen?.label} key stored, so tailoring with this default
          will fail until you add one above.
        </p>
      ) : null}

      {failure ? (
        <ErrorState error={failure} title="Could not save your defaults" />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          Save defaults
        </Button>
        {hasDefault ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={updateMe.isPending}
            onClick={() =>
              void save(CLEAR_DEFAULTS_PATCH, "Cleared your tailoring defaults")
            }
          >
            Clear defaults
          </Button>
        ) : null}
      </div>
    </form>
  );
}
