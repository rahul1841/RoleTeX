import { z } from "zod";
import {
  JD_CONTENT_MAX,
  JD_CONTENT_MIN,
  JD_TITLE_MAX,
  formatNumber,
} from "./limits";

/**
 * The create/edit form's shape, mirroring app/schemas.py exactly.
 *
 * Mirroring rather than approximating matters here because every request model
 * on this API is Pydantic `extra="forbid"` with real `Field` constraints: a
 * client rule that is looser produces a 422 the user cannot act on, and one
 * that is stricter silently forbids something the server would have accepted.
 *
 * TWO DELIBERATE ASYMMETRIES, both copied from the server:
 *
 *  - The title is trimmed and then measured; `create_jd` does
 *    `payload.title.strip()`, so trailing spaces are not the user's problem.
 *  - The content is NOT trimmed. `Field(min_length=50)` runs against the raw
 *    string, so trimming here would reject a paste the server accepts (and
 *    would quietly rewrite whitespace the tailoring prompt sees verbatim).
 */
export const jdFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give this job description a title so you can find it later.")
    .max(
      JD_TITLE_MAX,
      `Titles are limited to ${formatNumber(JD_TITLE_MAX)} characters.`,
    ),
  content: z
    .string()
    .min(
      JD_CONTENT_MIN,
      `Paste at least ${JD_CONTENT_MIN} characters — the server rejects anything shorter as too little to tailor against.`,
    )
    .max(
      JD_CONTENT_MAX,
      `Job descriptions are limited to ${formatNumber(JD_CONTENT_MAX)} characters. Trim the boilerplate and keep the requirements.`,
    ),
});

export type JdFormValues = z.infer<typeof jdFormSchema>;

/** How the list can be ordered. The API offers no sort parameter. */
export const JD_SORTS = {
  updated: "Recently updated",
  created: "Recently added",
  title: "Title A–Z",
} as const;

export type JdSort = keyof typeof JD_SORTS;

export const DEFAULT_JD_SORT: JdSort = "updated";

export function isJdSort(value: string): value is JdSort {
  return value in JD_SORTS;
}
