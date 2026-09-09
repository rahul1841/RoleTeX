/**
 * LLM provider catalog and per-user API keys.
 *
 * Keys are encrypted at rest server-side and are NEVER echoed back: `KeyInfo`
 * carries only metadata (which provider has a key, when it was set). The UI
 * must therefore treat "has a key" and "the key itself" as different things,
 * and must never try to pre-fill a key input.
 */

import { api } from "../client";
import type {
  KeysResponse,
  OkResponse,
  ProvidersResponse,
  PutKeyRequest,
  PutKeyResponse,
} from "../types";

/** Public catalog of supported providers. Safe to fetch signed out. */
export const listProviders = () => api.get<ProvidersResponse>("/api/providers");

export const listKeys = () => api.get<KeysResponse>("/api/keys");

export const putKey = (provider: string, body: PutKeyRequest) =>
  api.put<PutKeyResponse>(`/api/keys/${encodeURIComponent(provider)}`, body);

export const deleteKey = (provider: string) =>
  api.delete<OkResponse>(`/api/keys/${encodeURIComponent(provider)}`);
