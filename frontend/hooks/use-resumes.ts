"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  createResumeFromLatex,
  createResumeFromPdf,
  createResumeManual,
  deleteResume,
  getResume,
  listResumes,
  previewResume,
  renameResume,
  saveTailoredResume,
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
  TailoredResumeSaveRequest,
} from "@/lib/api/types";

/**
 * Every resume query and mutation, and the invalidation each write owes.
 *
 * The rule this file exists to enforce: a resume write changes two cached
 * things at once — the detail *and* the summary row in the list (whose
 * `updated_at` moves). Scattering those invalidations across components is how
 * a list ends up disagreeing with the resume it links to.
 */

/** Write a resume the server just returned, and refresh the list around it. */
function storeResume(client: QueryClient, response: ResumeCreateResponse): void {
  client.setQueryData<ResumeResponse>(
    queryKeys.resumes.detail(response.resume.id),
    { resume: response.resume },
  );
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

/**
 * Create from the builder — a new resume, or "Save as new resume" from the
 * editor. No LLM, no provider key, no long timeout.
 */
export function useCreateResume() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ResumeManualCreateRequest) => createResumeManual(body),
    onSuccess: (response) => storeResume(client, response),
  });
}

/** Overwrite a resume with edited content. */
export function useUpdateResumeContent(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ResumeContentUpdateRequest) =>
      updateResumeContent(id, body),
    onSuccess: (response) => storeResume(client, response),
  });
}

/**
 * Keep a tailoring result, as a new resume or over the original. Saved runs
 * are untouched either way: each one holds its own copy of the LaTeX.
 */
export function useSaveTailoredResume(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: TailoredResumeSaveRequest) => saveTailoredResume(id, body),
    onSuccess: (response) => storeResume(client, response),
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
      void client.invalidateQueries({ queryKey: queryKeys.resumes.list });
    },
  });
}

/** Import from pasted LaTeX. Runs an LLM extraction. */
export function useImportResumeFromLatex() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ResumeCreateRequest) => createResumeFromLatex(body),
    onSuccess: (response) => storeResume(client, response),
  });
}

/** Import from an uploaded PDF (multipart). Runs an LLM extraction. */
export function useImportResumeFromPdf() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (options: PdfImportOptions) => createResumeFromPdf(options),
    onSuccess: (response) => storeResume(client, response),
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
