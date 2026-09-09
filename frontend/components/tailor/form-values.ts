/**
 * The tailoring form's contract with the API, with no React in it.
 *
 * Kept apart from the panel that renders it because this is the part with
 * rules in it, and the rules are the server's: the field lengths mirror
 * `TailorRequest` in app/schemas.py, and `buildRequest` is the one place that
 * decides which of `job_description` / `jd_id` a request carries.
 */

import { z } from "zod";
import { JD_MAX_CHARACTERS, JD_MIN_CHARACTERS } from "@/hooks/use-tailor";
import type { TailorRequest } from "@/lib/api/types";

export interface TailorFormValues {
  resumeId: string;
  jdSource: "saved" | "paste";
  jdId: string;
  jobDescription: string;
  provider: string;
  model: string;
  compile: boolean;
  requireOnePage: boolean;
  saveRun: boolean;
}

/** Which field to focus when a submit fails, in the order they are read. */
export const FOCUS_ORDER = [
  "resumeId",
  "jdId",
  "jobDescription",
  "provider",
  "model",
] as const;

/** Labels for the run summary and the confirmation copy. */
export interface RunLabels {
  resume: string;
  jd: string;
  provider: string;
  model: string;
}

/**
 * Validation, parameterised by whether this server has storage.
 *
 * In demo mode there is no account and no database, so a resume id, a saved
 * job description and a provider choice are all meaningless — the server uses
 * its seed resume and its env-configured provider. Requiring them there would
 * block a mode that works.
 */
export function buildTailorSchema(storage: boolean) {
  return z
    .object({
      resumeId: z.string(),
      jdSource: z.enum(["saved", "paste"]),
      jdId: z.string(),
      jobDescription: z.string(),
      provider: z.string(),
      model: z.string(),
      compile: z.boolean(),
      requireOnePage: z.boolean(),
      saveRun: z.boolean(),
    })
    .superRefine((values, ctx) => {
      if (storage) {
        if (!values.resumeId) {
          ctx.addIssue({
            code: "custom",
            path: ["resumeId"],
            message: "Choose which resume to tailor.",
          });
        }
        if (!values.provider) {
          ctx.addIssue({
            code: "custom",
            path: ["provider"],
            message: "Choose an AI provider for this run.",
          });
        }
        if (values.jdSource === "saved" && !values.jdId) {
          ctx.addIssue({
            code: "custom",
            path: ["jdId"],
            message: "Choose a saved job description, or paste one instead.",
          });
        }
      }

      // Pasted text is the only job-description source without storage.
      if (!storage || values.jdSource === "paste") {
        const text = values.jobDescription.trim();
        if (text.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["jobDescription"],
            message: "Paste the job description you are tailoring for.",
          });
        } else if (text.length < JD_MIN_CHARACTERS) {
          ctx.addIssue({
            code: "custom",
            path: ["jobDescription"],
            message: `The server needs at least ${JD_MIN_CHARACTERS} characters; this is ${text.length}.`,
          });
        } else if (text.length > JD_MAX_CHARACTERS) {
          ctx.addIssue({
            code: "custom",
            path: ["jobDescription"],
            message: `The server accepts at most ${JD_MAX_CHARACTERS.toLocaleString()} characters; this is ${text.length.toLocaleString()}.`,
          });
        }
      }
    });
}

/**
 * Form values to request body.
 *
 * `TailorRequest` must carry EXACTLY ONE of `job_description` and `jd_id` —
 * the route answers 422 `jd_required` for both or neither. The two are set on
 * mutually exclusive branches here, so the invalid request cannot be built at
 * all rather than being caught by a check that someone could later remove.
 */
export function buildTailorRequest(
  values: TailorFormValues,
  storage: boolean,
): TailorRequest {
  const request: TailorRequest = {
    compile: values.compile,
    require_one_page: values.requireOnePage,
    save_run: storage ? values.saveRun : false,
  };

  if (storage && values.resumeId) request.resume_id = values.resumeId;
  if (values.provider) request.provider = values.provider;
  if (values.model.trim()) request.model = values.model.trim();

  if (storage && values.jdSource === "saved") {
    request.jd_id = values.jdId;
  } else {
    request.job_description = values.jobDescription.trim();
  }

  return request;
}
