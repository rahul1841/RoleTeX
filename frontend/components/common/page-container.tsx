import * as React from "react";
import { cn } from "cn";

export interface PageContainerProps extends React.ComponentProps<"div"> {
  /**
   * `default` suits reading-and-form screens (lists, settings, detail views).
   * `wide` is for the tailor workspace, where a resume, a job description and
   * a PDF preview have to share the viewport.
   * `full` removes the measure entirely for anything that must go edge to edge.
   */
  width?: "default" | "wide" | "full";
}

const WIDTHS = {
  default: "max-w-5xl",
  wide: "max-w-[96rem]",
  full: "max-w-none",
} as const;

/**
 * The horizontal measure and page padding every screen sits in.
 *
 * This is not applied by the shell because the shell cannot know which screens
 * want the wide workspace; each page picks. Keeping the padding here means the
 * sticky header's bottom edge always meets content at the same inset.
 */
export function PageContainer({
  width = "default",
  className,
  ...props
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8",
        WIDTHS[width],
        className,
      )}
      {...props}
    />
  );
}
