/**
 * The tailoring workspace.
 *
 * `TailorWorkspace` is the whole screen; everything else is exported for the
 * history screen, which reviews a *stored* run with the same change list, diff
 * and code blocks this one shows for a fresh one.
 */
export { TailorWorkspace } from "./tailor-workspace";
export { ChangeList, type ChangeListProps } from "./change-list";
export { UnifiedDiff, type UnifiedDiffProps, parseUnifiedDiff } from "./unified-diff";
export { CodeBlock, type CodeBlockProps } from "./code-block";
export { RunWarnings, type RunWarningsProps } from "./run-warnings";
export { ResultPdf, type ResultPdfProps } from "./result-pdf";
export { describeFieldId, type FieldLocation, type ChangeKind } from "./field-id";
export { wordDiff, type WordDiff, type DiffSpan } from "./word-diff";
