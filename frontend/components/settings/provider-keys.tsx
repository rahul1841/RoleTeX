"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  CheckIcon,
  KeyRoundIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  ErrorState,
  ListSkeleton,
  LoadingState,
  Spinner,
} from "@/components/common";
import { isApiError } from "@/lib/api/errors";
import { useSession } from "@/hooks/use-session";
import {
  buildProviderRows,
  useDeleteKey,
  useKeys,
  useProviders,
  usePutKey,
  type ProviderRow,
} from "@/hooks/use-keys";
import { SettingsPanel } from "./section";
import { SecretInput, SettingsField, describedBy } from "./field";
import { formatRelative } from "./format";

/**
 * Provider catalog with per-provider key management.
 *
 * The central fact this section has to communicate honestly: a stored key is
 * write-only. `KeyInfo` carries a provider, a masked hint and a timestamp and
 * nothing else, because the plaintext is Fernet-encrypted in Mongo and the
 * server has no route that returns it. So there is no "edit" affordance
 * anywhere here, only STORE (which replaces) and REMOVE. An input pre-filled
 * with dots would imply a value the UI could read back, and the first time
 * someone saved that form they would overwrite a working key with a
 * placeholder.
 */
export function ProviderKeys() {
  const { user, isAuthenticated } = useSession();
  const providers = useProviders();
  const keys = useKeys(isAuthenticated);
  const deleteKey = useDeleteKey();

  const [pendingRemoval, setPendingRemoval] =
    React.useState<ProviderRow | null>(null);

  const rows = React.useMemo(
    () => buildProviderRows(providers.data?.providers, keys.data),
    [providers.data, keys.data],
  );

  async function removeKey(row: ProviderRow) {
    try {
      await deleteKey.mutateAsync(row.provider.id);
      toast.success(`Removed the ${row.provider.label} key`);
    } catch (error) {
      // ConfirmDialog stays open and says nothing on rejection by contract, so
      // the failure has to be reported from here.
      toast.error(`Could not remove the ${row.provider.label} key`, {
        description: isApiError(error)
          ? error.message
          : "Check your connection and try again.",
      });
      throw error;
    }
  }

  if (providers.isPending || (isAuthenticated && keys.isPending)) {
    return (
      <LoadingState label="Loading AI providers">
        <ListSkeleton rows={4} />
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

  if (keys.isError) {
    return (
      <ErrorState
        error={keys.error}
        onRetry={() => void keys.refetch()}
        title="Could not load your stored keys"
      />
    );
  }

  return (
    <>
      <SettingsPanel divide>
        {rows.map((row) => (
          <ProviderRowItem
            key={row.provider.id}
            row={row}
            isDefault={user?.default_provider === row.provider.id}
            onRequestRemoval={() => setPendingRemoval(row)}
          />
        ))}
      </SettingsPanel>

      <p className="text-muted-foreground mt-3 flex items-start gap-2 text-xs text-pretty">
        <KeyRoundIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Keys are encrypted before they are stored and are never sent back to
          the browser, so only the last four characters can be shown. Deleting
          your account deletes them with it.
        </span>
      </p>

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
        title={`Remove the ${pendingRemoval?.provider.label ?? ""} key?`}
        description={
          <>
            Tailoring with{" "}
            <span className="font-medium">
              {pendingRemoval?.provider.label}
            </span>{" "}
            will stop working until you store another key. The stored key cannot
            be read back, so you will need the original from the provider to
            undo this.
          </>
        }
        confirmLabel="Remove key"
        pending={deleteKey.isPending}
        onConfirm={async () => {
          if (pendingRemoval) await removeKey(pendingRemoval);
          setPendingRemoval(null);
        }}
      />
    </>
  );
}

function ProviderRowItem({
  row,
  isDefault,
  onRequestRemoval,
}: {
  row: ProviderRow;
  isDefault: boolean;
  onRequestRemoval: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const { provider, hasKey, hint, updatedAt, selfContained } = row;

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{provider.label}</span>
            <span className="text-muted-foreground font-mono text-xs">
              {provider.id}
            </span>
            {isDefault ? (
              <Badge variant="secondary" className="text-[0.7rem]">
                Your default
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {selfContained ? (
              <>
                Default model{" "}
                <span className="text-code-foreground bg-code border-code-border rounded border px-1 py-px font-mono">
                  {provider.default_model}
                </span>
              </>
            ) : (
              "No endpoint or model compiled in"
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <KeyStatus hasKey={hasKey} hint={hint} updatedAt={updatedAt} />
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={hasKey ? "outline" : "default"}
              aria-expanded={editing}
              // Only while the target exists: a dangling aria-controls is a
              // reference to nothing.
              aria-controls={editing ? `${provider.id}-key-form` : undefined}
              onClick={() => setEditing((open) => !open)}
            >
              {hasKey ? null : (
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {hasKey ? "Replace" : "Add key"}
            </Button>
            {hasKey ? (
              <Button size="sm" variant="ghost" onClick={onRequestRemoval}>
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {!selfContained ? (
        <p className="bg-warning text-warning-foreground border-warning-border/70 mt-2.5 rounded-md border px-2.5 py-1.5 text-xs text-pretty">
          <TriangleAlertIcon
            aria-hidden="true"
            className="mr-1.5 inline size-3.5 -translate-y-px"
          />
          This provider is a gateway with no address of its own, so a key alone
          will not make it work. Whoever runs this server has to set{" "}
          <span className="font-mono font-medium">{row.envBaseUrl}</span> and{" "}
          <span className="font-mono font-medium">{row.envModel}</span> in its
          environment first.
        </p>
      ) : null}

      {editing ? (
        <KeyForm
          id={`${provider.id}-key-form`}
          row={row}
          onDone={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

function KeyStatus({
  hasKey,
  hint,
  updatedAt,
}: {
  hasKey: boolean;
  hint: string | null;
  updatedAt: string | null;
}) {
  if (!hasKey) {
    return (
      <span className="text-muted-foreground hidden text-xs sm:inline">
        No key stored
      </span>
    );
  }

  return (
    <span className="hidden text-right text-xs sm:block">
      <span className="text-diff-added-foreground flex items-center justify-end gap-1 font-medium">
        <CheckIcon aria-hidden="true" className="size-3.5" />
        Key stored
        <span className="text-muted-foreground font-mono font-normal">
          {hint}
        </span>
      </span>
      {updatedAt ? (
        <span className="text-muted-foreground">
          Updated {formatRelative(updatedAt)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Mirrors what app/routes_keys.py will accept: at least 8 characters after
 * trimming, at most 400, and no control characters (`ord < 32` or `ord == 127`).
 *
 * Restated here only because those three are cheap, unambiguous, and turn a
 * round trip into an instant message. Everything that actually matters about a
 * key — whether it is real, whether the provider accepts it — is knowable only
 * to the provider, and this form does not pretend otherwise.
 */
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

const keySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(8, "That key looks too short to be valid.")
    .max(400, "That key is too long to be valid.")
    .refine((value) => !hasControlCharacters(value), {
      message: "That key contains characters an API key cannot have.",
    }),
});

type KeyValues = z.infer<typeof keySchema>;

function KeyForm({
  id,
  row,
  onDone,
}: {
  id: string;
  row: ProviderRow;
  onDone: () => void;
}) {
  const putKey = usePutKey();
  const [failure, setFailure] = React.useState<unknown>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<KeyValues>({
    resolver: zodResolver(keySchema),
    defaultValues: { apiKey: "" },
  });

  const { ref: registerRef, ...field } = register("apiKey");
  const fieldId = `${row.provider.id}-api-key`;

  // Opening the disclosure has to land the caret in the input, or a keyboard
  // user is left at the toggle with the form open somewhere below them.
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await putKey.mutateAsync({
        provider: row.provider.id,
        apiKey: values.apiKey,
      });
      toast.success(`Saved your ${row.provider.label} key`, {
        description: "It is encrypted at rest and will not be shown again.",
      });
      onDone();
    } catch (error) {
      // The two codes the server attaches to this field specifically; anything
      // else (a 429, a database outage) is a whole-request failure.
      if (
        isApiError(error) &&
        (error.code === "invalid_api_key" || error.code === "invalid_request")
      ) {
        setError(
          "apiKey",
          { type: "server", message: error.message },
          { shouldFocus: true },
        );
        return;
      }
      setFailure(error);
    }
  });

  return (
    <form
      id={id}
      onSubmit={onSubmit}
      className="border-border/70 mt-3 space-y-3 border-t pt-3"
    >
      <SettingsField
        id={fieldId}
        label={`${row.provider.label} API key`}
        error={errors.apiKey?.message}
        hint={
          row.hasKey
            ? "Saving replaces the stored key. The existing one cannot be shown or recovered."
            : "Pasted once and encrypted immediately. It is never displayed again."
        }
      >
        <SecretInput
          {...field}
          ref={(node) => {
            registerRef(node);
            inputRef.current = node;
          }}
          id={fieldId}
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the key from your provider dashboard"
          aria-invalid={errors.apiKey ? true : undefined}
          aria-describedby={describedBy(fieldId, {
            error: errors.apiKey,
            hint: true,
          })}
        />
      </SettingsField>

      {failure ? (
        <ErrorState error={failure} title="Could not save that key" />
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {row.hasKey ? "Replace key" : "Save key"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDone}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
