"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  addResumeVersionFromLatex,
  addResumeVersionFromPdf,
  createResumeFromLatex,
  createResumeFromPdf,
  createResumeManual,
  deleteResume,
  getResume,
  getResumeVersionSource,
  listResumeVersions,
  listResumes,
  previewResume,
  renameResume,
  updateResumeContent,
  type PdfImportOptions,
} from "@/lib/api/endpoints/resumes";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  ResumeContentUpdateRequest,
  ResumeCreateRequest,
  ResumeCreateResponse,
  ResumeListResponse,
  ResumeManualCreateRequest,
  ResumePreviewRequest,
  ResumeResponse,
} from "@/lib/api/types";

/**
 * Every resume query and mutation, and the invalidation each write owes.
 *
 * The rule this file exists to enforce: a resume write can change three cached
 * things at once. `PUT /content` adds a version, so it moves the detail *and*
 * the version list *and* the summary row in the list (whose `version` and
 * `updated_at` both change). Scattering those invalidations across components
 * is how a UI ends up showing "v1" next to a resume that is on v3.
 */

/** Everything derived from a single resume: detail, versions, sources. */
function invalidateResume(client: QueryClient, id: string): void {
  void client.invalidateQueries({ queryKey: queryKeys.resumes.detail(id) });
  void client.invalidateQueries({ queryKey: queryKeys.resumes.versions(id) });
  void client.invalidateQueries({ queryKey: queryKeys.resumes.list });
}

export function useResumes() {
  return useQuery({
    queryKey: queryKeys.resumes.list,
    queryFn: listResumes,
  });
}

/** The selected resume. `null` disables the query, for the list-only view. */
export function useResume(id: string | null) {
  return useQuery({
    queryKey: queryKeys.resumes.detail(id ?? "none"),
    queryFn: () => getResume(id as string),
    enabled: Boolean(id),
  });
}

export function useResumeVersions(id: string | null) {
  return useQuery({
    queryKey: queryKeys.resumes.versions(id ?? "none"),
    queryFn: () => listResumeVersions(id as string),
    enabled: Boolean(id),
  });
}

/**
 * The stored LaTeX for one version.
 *
 * Held far longer than the default: a version's source is immutable once
 * written, so re-fetching it when the user flips back to a version they just
 * looked at is pure waste.
 */
export function useResumeVersionSource(id: string | null, version: number | null) {
  return useQuery({
    queryKey: queryKeys.resumes.versionSource(id ?? "none", version ?? 0),
    queryFn: () => getResumeVersionSource(id as string, version as number),
    enabled: Boolean(id) && version !== null,
    staleTime: Infinity,
  });
}

/** Create from the builder. No LLM, no provider key, no long timeout. */
export function useCreateResume() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ResumeManualCreateRequest) => createResumeManual(body),
    onSuccess: (response) => {
      client.setQueryData<ResumeResponse>(
        queryKeys.resumes.detail(response.resume.id),
        { resume: response.resume },
      );
      void client.invalidateQueries({ queryKey: queryKeys.resumes.list });
    },
  });
}

/** Save edited content as the resume's next version. */
export function useUpdateResumeContent(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ResumeContentUpdateRequest) =>
      updateResumeContent(id, body),
    onSuccess: (response) => {
      client.setQueryData<ResumeResponse>(queryKeys.resumes.detail(id), {
        resume: response.resume,
      });
      invalidateResume(client, id);
    },
  });
}

export interface RenameVariables {
  id: string;
  name: string;
}

/**
 * Rename, applied optimistically.
 *
 * One of the two places in this feature where an optimistic update is
 * appropriate: it is a single short string, the server does no work beyond
 * writing it, and a failure is trivially reversible. Nothing that spends
 * tokens or runs Tectonic gets this treatment.
 */
export function useRenameResume() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name }: RenameVariables) =>
      renameResume(id, { name: name.trim() }),

    onMutate: async ({ id, name }: RenameVariables) => {
      // In-flight fetches would land after the optimistic write and undo it.
      await client.cancelQueries({ queryKey: queryKeys.resumes.list });
      await client.cancelQueries({ queryKey: queryKeys.resumes.detail(id) });

      const previousList = client.getQueryData<ResumeListResponse>(
        queryKeys.resumes.list,
      );
      const previousDetail = client.getQueryData<ResumeResponse>(
        queryKeys.resumes.detail(id),
      );
      const trimmed = name.trim();

      if (previousList) {
        client.setQueryData<ResumeListResponse>(queryKeys.resumes.list, {
          ...previousList,
          resumes: (previousList.resumes ?? []).map((resume) =>
            resume.id === id ? { ...resume, name: trimmed } : resume,
          ),
        });
      }
      if (previousDetail) {
        client.setQueryData<ResumeResponse>(queryKeys.resumes.detail(id), {
          resume: { ...previousDetail.resume, name: trimmed },
        });
      }

      return { previousList, previousDetail };
    },

    onError: (_error, { id }, context) => {
      if (context?.previousList) {
        client.setQueryData(queryKeys.resumes.list, context.previousList);
      }
      if (context?.previousDetail) {
        client.setQueryData(
          queryKeys.resumes.detail(id),
          context.previousDetail,
        );
      }
    },

    onSettled: (_data, _error, { id }) => {
      void client.invalidateQueries({ queryKey: queryKeys.resumes.list });
      void client.invalidateQueries({ queryKey: queryKeys.resumes.detail(id) });
    },
  });
}

export function useDeleteResume() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResume(id),
    onSuccess: (_data, id) => {
      // Removed rather than invalidated: the record is gone, and refetching it
      // would only produce a 404 the UI has to special-case.
      client.removeQueries({ queryKey: queryKeys.resumes.detail(id) });
      client.removeQueries({ queryKey: queryKeys.resumes.versions(id) });
      void client.invalidateQueries({ queryKey: queryKeys.resumes.list });
    },
  });
}

/** Import from pasted LaTeX. Runs an LLM extraction. */
export function useImportResumeFromLatex() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ResumeCreateRequest) => createResumeFromLatex(body),
    onSuccess: (response: ResumeCreateResponse) => {
      client.setQueryData<ResumeResponse>(
        queryKeys.resumes.detail(response.resume.id),
        { resume: response.resume },
      );
      void client.invalidateQueries({ queryKey: queryKeys.resumes.list });
    },
  });
}

/** Import from an uploaded PDF (multipart). Runs an LLM extraction. */
export function useImportResumeFromPdf() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (options: PdfImportOptions) => createResumeFromPdf(options),
    onSuccess: (response: ResumeCreateResponse) => {
      client.setQueryData<ResumeResponse>(
        queryKeys.resumes.detail(response.resume.id),
        { resume: response.resume },
      );
      void client.invalidateQueries({ queryKey: queryKeys.resumes.list });
    },
  });
}

export interface AddVersionFromLatexVariables {
  id: string;
  body: ResumeCreateRequest;
}

export function useAddResumeVersionFromLatex() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: AddVersionFromLatexVariables) =>
      addResumeVersionFromLatex(id, body),
    onSuccess: (_response, { id }) => invalidateResume(client, id),
  });
}

export interface AddVersionFromPdfVariables {
  id: string;
  options: Omit<PdfImportOptions, "name">;
}

export function useAddResumeVersionFromPdf() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, options }: AddVersionFromPdfVariables) =>
      addResumeVersionFromPdf(id, options),
    onSuccess: (_response, { id }) => invalidateResume(client, id),
  });
}

/**
 * Compile one PDF on demand — the download path, and the "preview what is
 * stored" path.
 *
 * A mutation rather than a query even though it reads nothing: it runs
 * Tectonic, so it must never fire on mount, on focus, or on a retry. The
 * editor's continuous preview does not use this at all; see
 * `useLivePreview` in components/resumes, which owns its own debounce,
 * cancellation and staleness rules.
 */
export function usePreviewResume() {
  return useMutation({
    mutationFn: (body: ResumePreviewRequest) => previewResume(body),
  });
}
