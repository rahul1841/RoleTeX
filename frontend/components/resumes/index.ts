/**
 * The resume library, the builder, and everything they are made of.
 *
 * The page imports only <ResumesWorkspace>; the rest is exported for the other
 * feature screens that legitimately need a piece of it — the tailor workspace
 * needs the preview panel and the draft conversions, and history needs the
 * source-type labels.
 */
export { ResumesWorkspace } from "./resumes-workspace";
export { ResumeLibrary } from "./resume-library";
export { ResumeDetailView } from "./resume-detail";
export { NewResumeView } from "./new-resume-view";
export { ResumeBuilder, type ResumeBuilderProps } from "./resume-builder";
export { PreviewPanel, type PreviewPanelProps } from "./preview-panel";
export {
  useLivePreview,
  type LivePreviewState,
  type PreviewResult,
} from "./use-live-preview";
export { ImportResumeDialog } from "./import-dialog";
export { RenameResumeDialog } from "./rename-dialog";
export { ResumeCard } from "./resume-card";
export { ResumeSheet } from "./resume-sheet";
export {
  resumeErrorGuidance,
  resumeErrorTitle,
  isQuotaError,
  needsProviderSetup,
  type ResumeErrorGuidance,
} from "./errors";
export {
  absoluteTime,
  contentSummary,
  isLowConfidenceSource,
  relativeTime,
  sortResumes,
  sourceHint,
  sourceLabel,
} from "./format";
export {
  draftToForm,
  emptyResumeForm,
  formToDraft,
  formToStyle,
  hasContent,
  resumeDataToForm,
  resumeFormSchema,
  FONT_SIZES,
  LIMITS,
  MARGIN_RANGE,
  MAX_ENTRIES,
  type FontSize,
  type ResumeFormValues,
} from "./resume-form";
