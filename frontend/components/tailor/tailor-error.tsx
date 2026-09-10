"use client";

import * as React from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/common";
import { isApiError } from "@/lib/api/errors";
import { CodeBlock } from "./code-block";

/**
 * Every way a tailoring run can fail, with copy that says what actually
 * happened and what to do about it.
 *
 * Built on <ErrorState> rather than beside it: that primitive already renders
 * the message, the per-field problems a 422 carries, the machine code a bug
 * report needs, and — the part worth not reimplementing — a live countdown for
 * a 429 that disables its own retry button until the limit lifts.
 *
 * What this adds is judgement about the specific failure: whether retrying is
 * even sensible (adding a Retry to `llm_key_required` would just spend the
 * user's time), where to send them, and, for a compile failure, the escape
 * hatch of re-running with compilation switched off so they at least get the
 * change list and the LaTeX source.
 *
 * Retrying is ALWAYS a button the user presses. Nothing here retries on its
 * own — a tailoring run costs provider tokens and a LaTeX compile.
 */

const COMPILE_CODES = new Set([
  "latex_compile_failed",
  "compile_timeout",
  "compiler_not_found",
  "compiler_start_failed",
  "job_setup_failed",
  "pdf_missing",
  "source_too_large",
]);

interface Explanation {
  title: string;
  guidance?: React.ReactNode;
  action?: React.ReactNode;
  /** Whether re-running the identical request could plausibly succeed. */
  retryable: boolean;
  /** Offer "run again without compiling" — only useful for compile failures. */
  offerSkipCompile: boolean;
}

const settingsLink = (
  <ButtonLink variant="outline" size="sm" href="/settings">
    Open Settings
  </ButtonLink>
);

const resumesLink = (
  <ButtonLink variant="outline" size="sm" href="/resumes">
    Go to Resumes
  </ButtonLink>
);

function explain(error: unknown): Explanation {
  if (!isApiError(error)) {
    return {
      title: "The run did not finish",
      retryable: true,
      offerSkipCompile: false,
    };
  }

  if (COMPILE_CODES.has(error.code)) {
    return {
      title: "The PDF could not be compiled",
      guidance:
        "The model's proposal was accepted, but Tectonic could not turn it into a document, so nothing was returned and nothing was saved. Running again without compiling still gives you the change list and the LaTeX source — and if the resume was close to spilling onto a second page, turning off “Require one page” avoids the shortening repair that most often causes this.",
      retryable: true,
      offerSkipCompile: true,
    };
  }

  switch (error.code) {
    case "provider_required":
      return {
        title: "Choose an AI provider first",
        guidance:
          "This server does not pick one for you. Select a provider for this run, or set a default in Settings so you never have to.",
        action: settingsLink,
        retryable: false,
        offerSkipCompile: false,
      };

    case "llm_key_required":
      return {
        title: "That provider has no API key",
        guidance:
          "Keys are stored per user and encrypted on the server; RoleTeX never has one of its own. Add a key for this provider, then run again.",
        action: settingsLink,
        retryable: false,
        offerSkipCompile: false,
      };

    case "key_decrypt_failed":
      return {
        title: "Your stored key could not be read",
        guidance:
          "The server's secret key changed since this API key was saved, so the stored ciphertext no longer decrypts. Nothing was sent to the provider. Re-enter the key in Settings and it will work again.",
        action: settingsLink,
        retryable: false,
        offerSkipCompile: false,
      };

    case "unknown_provider":
      return {
        title: "This server does not support that provider",
        action: settingsLink,
        retryable: false,
        offerSkipCompile: false,
      };

    case "invalid_llm_proposal":
      return {
        title: "The model's proposal was rejected",
        guidance:
          "The server refuses any proposal that invents facts: new numbers that are not in your resume, bullets that do not exist, or a skills order that is not a permutation of your own skills. It already retried once. Running again may produce a valid proposal — a stronger model usually does — and costs another API call.",
        retryable: true,
        offerSkipCompile: false,
      };

    case "resume_required":
      return {
        title: "Pick a resume to tailor",
        guidance:
          "This server stores resumes per account, so a run has to name one. Import or build a resume first.",
        action: resumesLink,
        retryable: false,
        offerSkipCompile: false,
      };

    case "resume_not_found":
    case "jd_not_found":
      return {
        title: "That selection no longer exists",
        guidance:
          "The resume or job description was deleted, or belongs to another account. Pick again from the lists above.",
        retryable: false,
        offerSkipCompile: false,
      };

    case "jd_required":
      return {
        title: "Exactly one job description is required",
        guidance:
          "The request carried both a saved job description and pasted text, or neither. The form is supposed to make that impossible — if you can reproduce it, it is a bug worth reporting.",
        retryable: false,
        offerSkipCompile: false,
      };

    case "llm_not_configured":
      return {
        title: "No AI provider is configured on this server",
        guidance:
          "Whoever runs this deployment has not set up a provider, so tailoring cannot run at all.",
        action: settingsLink,
        retryable: false,
        offerSkipCompile: false,
      };

    case "llm_provider_error":
      return {
        title: "The provider rejected the request",
        guidance:
          error.status === 429
            ? "The provider is rate limiting your key, not this server. Wait for their window to reset, or run with a different provider."
            : "The provider returned an error. Their message is above; a bad or expired key and an unavailable model are the usual causes.",
        retryable: true,
        offerSkipCompile: false,
      };

    case "rate_limited":
    case "too_many_requests":
      return {
        title: "Too many runs, too quickly",
        guidance:
          "This server limits how often the expensive endpoints can be called, per account and per address. The button above unlocks when the window lifts.",
        retryable: true,
        offerSkipCompile: false,
      };

    case "email_verification_required":
      return {
        title: "Verify your email address first",
        guidance:
          "This server requires a verified address before spending provider tokens.",
        action: settingsLink,
        retryable: false,
        offerSkipCompile: false,
      };

    case "database_not_configured":
      return {
        title: "This server has no database",
        guidance:
          "It is running in demo mode, so saved resumes, saved job descriptions and run history do not exist. Paste a job description instead and it will tailor the built-in sample resume.",
        retryable: false,
        offerSkipCompile: false,
      };

    case "render_failed":
      return {
        title: "The server could not render the proposal",
        guidance:
          "The proposal passed validation but could not be placed into the locked LaTeX template. This is a server-side problem rather than something you can fix from here.",
        retryable: true,
        offerSkipCompile: false,
      };

    case "timeout":
      return {
        title: "The server took too long to answer",
        guidance:
          "The run may well have finished on the server after the client gave up — check History before spending another call.",
        retryable: true,
        offerSkipCompile: false,
      };

    case "network_error":
      return {
        title: "Could not reach the server",
        retryable: true,
        offerSkipCompile: false,
      };

    default:
      return {
        title: "The run did not finish",
        retryable: true,
        offerSkipCompile: false,
      };
  }
}

/**
 * The Tectonic log the server attaches to a compile failure, if it reached us.
 *
 * `compiler_failure()` in app/routes_runs.py puts the last 8 KB of the log in
 * the structured error body as `compiler_log`, but `ApiError` in
 * lib/api/errors.ts keeps only status, code, message, field errors and
 * retry-after, so today this is always null. It is read defensively rather
 * than dropped so the log appears the moment that shared parser preserves it,
 * with no change here.
 */
function compilerLogFrom(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as {
    compilerLog?: unknown;
    details?: { compiler_log?: unknown } | null;
  };
  if (typeof candidate.compilerLog === "string") return candidate.compilerLog;
  const nested = candidate.details?.compiler_log;
  return typeof nested === "string" ? nested : null;
}

export interface TailorErrorProps {
  error: unknown;
  /** Re-runs the identical request. Always user-initiated. */
  onRetry: () => void;
  /** Re-runs with `compile: false`. Offered only for compile failures. */
  onRetryWithoutCompiling: () => void;
  className?: string;
}

export function TailorError({
  error,
  onRetry,
  onRetryWithoutCompiling,
  className,
}: TailorErrorProps) {
  const explanation = explain(error);
  const log = compilerLogFrom(error);

  const actions = (
    <>
      {explanation.offerSkipCompile ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetryWithoutCompiling}
        >
          Run again without compiling
        </Button>
      ) : null}
      {explanation.action}
    </>
  );

  return (
    <div className={className}>
      <ErrorState
        error={error}
        title={explanation.title}
        onRetry={explanation.retryable ? onRetry : undefined}
        retryLabel="Run again"
        action={actions}
      />

      {explanation.guidance ? (
        <p className="text-muted-foreground mt-2.5 text-sm text-pretty">
          {explanation.guidance}
        </p>
      ) : null}

      {explanation.retryable ? (
        <p className="text-muted-foreground/80 mt-1.5 text-xs text-pretty">
          Running again spends another provider call
          {explanation.offerSkipCompile ? " and another compile" : ""}. Nothing
          here retries on its own.
        </p>
      ) : null}

      {log ? (
        <CodeBlock
          className="mt-3"
          label="Compiler log"
          subject="Compiler log"
          value={log}
        />
      ) : null}
    </div>
  );
}
