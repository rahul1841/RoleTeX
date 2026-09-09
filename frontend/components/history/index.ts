/**
 * Run history.
 *
 * The change-review pieces are NOT here: `ChangeList`, `UnifiedDiff`,
 * `CodeBlock` and `RunWarnings` come from `@/components/tailor`, and every
 * base64-PDF path comes from `@/components/pdf`. A stored run and a fresh one
 * are the same artifacts, so a second implementation of either would only
 * guarantee the two screens drift apart.
 *
 * What lives here is history-specific: the two-pane workspace, the run list,
 * the stored-run record, and re-compiling a run without an LLM call.
 */
export { HistoryWorkspace } from "./history-workspace";
export { RunList, runHref, type RunListProps } from "./run-list";
export { RunDetail, type RunDetailProps } from "./run-detail";
export { RunFlags } from "./run-flags";
export { RecompilePanel, type RecompilePanelProps } from "./recompile-panel";
export { JdExcerpt, type JdExcerptProps } from "./jd-excerpt";
export {
  formatRunTimestamp,
  formatEngine,
  formatPageCount,
  formatByteSize,
  countLines,
  describeTarget,
  type RunTimestamp,
} from "./format";
