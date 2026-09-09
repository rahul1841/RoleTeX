/**
 * The primitives every feature screen is built from.
 *
 * Import from `@/components/common`, not from the individual files — the
 * grouping is the point: a list screen that needs a header, an empty state, an
 * error state and a skeleton should reach for one import and get four
 * components that already agree with each other.
 */
export { PageHeader, type PageHeaderProps } from "./page-header";
export { PageContainer, type PageContainerProps } from "./page-container";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { ErrorState, type ErrorStateProps } from "./error-state";
export {
  LoadingState,
  type LoadingStateProps,
  Spinner,
  ListSkeleton,
  CardSkeleton,
  CardGridSkeleton,
  TextSkeleton,
} from "./loading-state";
export { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";
export { CopyButton, type CopyButtonProps } from "./copy-button";
export { RequiresStorage, type RequiresStorageProps } from "./requires-storage";
