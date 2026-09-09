import { isApiError, type ApiError } from "@/lib/api/errors";

/**
 * What a resume failure means, and what the user can do about it.
 *
 * `lib/api/errors.ts` already normalizes every failure into an `ApiError` with
 * a showable message. This adds the part that is specific to this feature: the
 * *next step*. "That PDF is too large" and "That request is too large" are both
 * 413 and read almost identically, but one means "pick a smaller file" and the
 * other means "paste less LaTeX", and only the error code tells them apart.
 */

export interface ResumeErrorGuidance {
  /** Replaces the generic <ErrorState> heading. */
  title: string;
  /** One sentence on what to do next. Rendered under the server's message. */
  hint?: string;
  /** Show a link to Settings — the failure is about provider configuration. */
  linksToSettings?: boolean;
  /** The user is at a limit; retrying will not help until they delete. */
  isQuota?: boolean;
}

const GUIDANCE: Record<string, ResumeErrorGuidance> = {
  // --- quotas (409). Retrying is pointless; deleting is the fix. ------------
  resume_quota_exceeded: {
    title: "You have reached the resume limit",
    hint: "Delete a resume you no longer need, then try again.",
    isQuota: true,
  },
  version_quota_exceeded: {
    title: "This resume has too many versions",
    hint: "Every save adds a version. Start a new resume to keep going.",
    isQuota: true,
  },

  // --- the two 413s, which are genuinely different problems ---------------
  pdf_too_large: {
    title: "That PDF is too large",
    hint: "The limit is 5 MB. Export it again at a lower quality, or remove images.",
  },
  request_too_large: {
    title: "That request is too large",
    hint: "The LaTeX you pasted exceeds the server's body limit. Paste the resume itself, without the class or package files.",
  },

  // --- PDF upload problems -------------------------------------------------
  invalid_pdf: {
    title: "That file is not a PDF",
    hint: "The upload has to be a real PDF — a renamed .docx will not work.",
  },
  pdf_too_many_pages: {
    title: "That PDF has too many pages",
    hint: "Import the resume itself, at most 3 pages — not a portfolio or a bound document.",
  },
  pdf_no_text: {
    title: "Nothing could be read from that PDF",
    hint: "It has no text layer and could not be rendered as images either.",
  },
  pdf_support_unavailable: {
    title: "This server cannot read PDFs",
    hint: "PDF import needs poppler tools that are not installed here. Paste LaTeX instead.",
  },
  pdf_extract_timeout: {
    title: "Reading that PDF took too long",
    hint: "Try a simpler PDF, or paste the LaTeX source instead.",
  },
  pdf_extract_failed: {
    title: "That PDF could not be read",
    hint: "Try exporting it again from the original document.",
  },

  // --- provider configuration ---------------------------------------------
  provider_required: {
    title: "Choose an AI provider",
    hint: "Importing runs an extraction model. Pick a provider, or set a default.",
    linksToSettings: true,
  },
  llm_key_required: {
    title: "This provider needs an API key",
    hint: "Add your key in Settings; it is stored encrypted and never shown again.",
    linksToSettings: true,
  },
  llm_not_configured: {
    title: "No AI provider is configured",
    hint: "Add a provider key in Settings, or write the resume by hand instead.",
    linksToSettings: true,
  },
  unknown_provider: {
    title: "That provider is not supported",
    linksToSettings: true,
  },
  key_decrypt_failed: {
    title: "Your stored key could not be read",
    hint: "Re-enter it in Settings.",
    linksToSettings: true,
  },
  invalid_api_key: {
    title: "That API key was rejected",
    hint: "Check the key in Settings — the provider refused it.",
    linksToSettings: true,
  },

  // --- extraction and validation -------------------------------------------
  invalid_extraction: {
    title: "The model could not read this resume",
    hint: "It may be missing a name, email, phone or location. Try another provider, or write it by hand.",
  },
  invalid_llm_proposal: {
    title: "The model returned something unusable",
    hint: "Try again, or use a different provider.",
  },
  incomplete_resume: {
    title: "This resume is not ready to save",
    hint: "Fix the fields listed below, then save again.",
  },

  // --- compilation ---------------------------------------------------------
  latex_compile_failed: {
    title: "The resume could not be compiled",
    hint: "The compiler log below says where it stopped.",
  },
  compile_timeout: {
    title: "Compiling took too long",
    hint: "Shorten the resume — a very long document can exceed the compile budget.",
  },
  compiler_not_found: {
    title: "No LaTeX compiler on this server",
    hint: "Previews and downloads are unavailable until one is installed.",
  },
  source_too_large: {
    title: "The rendered LaTeX is too large to compile",
    hint: "Remove some content and try again.",
  },
  render_failed: {
    title: "The resume could not be rendered",
  },
  preview_target_required: {
    title: "Nothing to preview",
  },
  resume_not_found: {
    title: "That resume no longer exists",
    hint: "It may have been deleted in another tab.",
  },
};

/** Guidance for a failure, or `null` when the generic error UI is enough. */
export function resumeErrorGuidance(error: unknown): ResumeErrorGuidance | null {
  if (!isApiError(error)) return null;
  return GUIDANCE[error.code] ?? null;
}

/** True for the 409s where a retry button would be a lie. */
export function isQuotaError(error: unknown): error is ApiError {
  return Boolean(resumeErrorGuidance(error)?.isQuota);
}

/** True when the fix lives in Settings rather than on this screen. */
export function needsProviderSetup(error: unknown): boolean {
  return Boolean(resumeErrorGuidance(error)?.linksToSettings);
}

/** The heading to show, falling back to the generic one. */
export function resumeErrorTitle(error: unknown): string | undefined {
  return resumeErrorGuidance(error)?.title;
}
