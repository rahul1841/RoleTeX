"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteKey,
  listKeys,
  listProviders,
  putKey,
} from "@/lib/api/endpoints/keys";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  KeysResponse,
  ProviderInfo,
  PutKeyResponse,
  UserResponse,
} from "@/lib/api/types";

/**
 * The provider catalog and the user's stored API keys.
 *
 * Two queries that are always read together but are emphatically not the same
 * fact. `/api/providers` is a public, static description of what this build of
 * the server can talk to. `/api/keys` is per-user, private, and carries only
 * metadata — the ciphertext never leaves Mongo and the plaintext is never
 * echoed back, so "this provider has a key" is the strongest statement the UI
 * can ever make about it.
 */

/**
 * `GET /api/providers`.
 *
 * The catalog is compiled into the server (app/llm.py `PROVIDERS`), so it
 * cannot change while the page is open. Cached forever, like health.
 */
export function useProviders() {
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: listProviders,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * `GET /api/keys` — which providers this account has stored a key for.
 *
 * Requires a session, so demo mode and the signed-out moment before a redirect
 * must not ask; both would produce a 401 that is noise rather than news.
 */
export function useKeys(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.keys,
    queryFn: listKeys,
    enabled,
  });
}

/**
 * A provider row, joined from the two queries above.
 *
 * `hasKey` comes from `/api/keys` rather than from `user.providers_with_keys`
 * because the key list also carries the hint and the timestamp, and one source
 * of truth for a row beats two that can disagree mid-mutation.
 *
 * `configurable` is the honest reading of an empty `default_model`. Every entry
 * in the catalog is `needs_key: true`, but `grid` ships with no base URL and no
 * model (app/llm.py), so a key alone will not make it work — the operator has
 * to set `GRID_BASE_URL` and `GRID_MODEL` in the server environment. Deriving
 * that from the catalog rather than hard-coding "grid" means a future gateway
 * with the same shape is described correctly too.
 */
export interface ProviderRow {
  provider: ProviderInfo;
  hasKey: boolean;
  /** Masked tail of the stored key, e.g. "…cdef". Never the key itself. */
  hint: string | null;
  updatedAt: string | null;
  /** False when the server has no built-in endpoint for this provider. */
  selfContained: boolean;
  /** `GRID_BASE_URL`-style names to name in the explanation. */
  envBaseUrl: string;
  envModel: string;
}

export function buildProviderRows(
  providers: readonly ProviderInfo[] | undefined,
  keys: KeysResponse | undefined,
): ProviderRow[] {
  const stored = new Map(
    (keys?.keys ?? []).map((key) => [key.provider, key] as const),
  );

  return (providers ?? []).map((provider) => {
    const key = stored.get(provider.id);
    const upper = provider.id.toUpperCase();
    return {
      provider,
      hasKey: Boolean(key),
      hint: key?.hint ?? null,
      updatedAt: key?.updated_at ?? null,
      selfContained: provider.default_model.trim().length > 0,
      envBaseUrl: `${upper}_BASE_URL`,
      envModel: `${upper}_MODEL`,
    };
  });
}

/**
 * `PUT /api/keys/{provider}` — store or replace one key.
 *
 * THE ONE OPTIMISTIC WRITE ON THIS SCREEN. Storing a key flips a boolean the
 * user can see in three places at once (the provider row, the default-provider
 * warning, and the account summary), and waiting a round trip to flip it makes
 * a successful save feel like it did nothing. Nothing is spent and nothing is
 * compiled, so an optimistic flip that rolls back on failure is safe here in a
 * way it would not be for tailoring.
 *
 * `providers_with_keys` on the cached user is updated alongside the key list
 * because they are the same fact rendered by different components; leaving one
 * behind is how a "no key stored" warning survives next to a "configured"
 * badge.
 */
export function usePutKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      putKey(provider, { api_key: apiKey }),

    onMutate: async ({ provider }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.keys }),
        queryClient.cancelQueries({ queryKey: queryKeys.session.me }),
      ]);

      const previousKeys = queryClient.getQueryData<KeysResponse>(
        queryKeys.keys,
      );
      const previousMe = queryClient.getQueryData<UserResponse>(
        queryKeys.session.me,
      );

      // `providers_with_keys` is a defaulted list server-side, so the generated
      // type makes it optional; treat a missing list as an empty one.
      const withKeys = previousMe?.user.providers_with_keys ?? [];
      if (previousMe && !withKeys.includes(provider)) {
        queryClient.setQueryData<UserResponse>(queryKeys.session.me, {
          ...previousMe,
          user: {
            ...previousMe.user,
            providers_with_keys: [...withKeys, provider].sort(),
          },
        });
      }

      return { previousKeys, previousMe };
    },

    onError: (_error, _variables, context) => {
      if (context?.previousKeys !== undefined) {
        queryClient.setQueryData(queryKeys.keys, context.previousKeys);
      }
      if (context?.previousMe !== undefined) {
        queryClient.setQueryData(queryKeys.session.me, context.previousMe);
      }
    },

    // The response carries the real hint the server derived from the key, so
    // the row can show "…cdef" immediately instead of a placeholder that would
    // change under the user a moment later.
    onSuccess: (response: PutKeyResponse) => {
      queryClient.setQueryData<KeysResponse>(queryKeys.keys, (current) => {
        const now = new Date().toISOString();
        const entry = {
          provider: response.provider,
          hint: response.hint,
          updated_at: now,
        };
        const existing = current?.keys ?? [];
        const alreadyStored = existing.some(
          (key) => key.provider === response.provider,
        );
        return {
          keys: alreadyStored
            ? existing.map((key) =>
                key.provider === response.provider ? entry : key,
              )
            : [...existing, entry],
        };
      });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.keys });
      void queryClient.invalidateQueries({ queryKey: queryKeys.session.me });
    },
  });
}

/**
 * `DELETE /api/keys/{provider}`.
 *
 * Not optimistic, deliberately. Removing a key can break tailoring, and the
 * row must not claim the key is gone until the server says it is — a rollback
 * after the user has already moved on reads as the delete undoing itself.
 */
export function useDeleteKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: string) => deleteKey(provider),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.keys });
      void queryClient.invalidateQueries({ queryKey: queryKeys.session.me });
    },
  });
}
