/**
 * Turning a `ResumeChange.field_id` into something a human can find.
 *
 * The server's ids are the stable contract between validation, rendering and
 * the model (rules.md R-12), so they are deliberately terse: `exp_2_b3`,
 * `project_1_b1`, `cus_1_b2`, `ach_4`, plus the two whole-field ids `summary`
 * and `skills_order`. Shown raw they tell a reviewer nothing about *where* on
 * their resume the change landed, which is the first question a review asks.
 *
 * An unrecognised id is passed through untouched rather than guessed at:
 * imported resumes carry server-assigned ids, but the seed resume in
 * `backend/resume/data.json` carries whatever its author wrote, and inventing a label
 * for one of those would be worse than showing the id.
 */

export type ChangeKind = "summary" | "skills" | "bullet" | "other";

export interface FieldLocation {
  /** The resume section: "Experience 2", "Summary", "Skills". */
  section: string;
  /** Where inside it: "Bullet 3". Absent for whole-field changes. */
  detail?: string;
  kind: ChangeKind;
}

const BULLET_PATTERNS: { pattern: RegExp; section: (n: string) => string }[] = [
  { pattern: /^exp_(\d+)_b(\d+)$/, section: (n) => `Experience ${n}` },
  { pattern: /^project_(\d+)_b(\d+)$/, section: (n) => `Project ${n}` },
  { pattern: /^cus_(\d+)_b(\d+)$/, section: (n) => `Custom section ${n}` },
];

export function describeFieldId(fieldId: string): FieldLocation {
  if (fieldId === "summary") {
    return { section: "Summary", kind: "summary" };
  }
  if (fieldId === "skills_order") {
    return { section: "Skills", detail: "Order", kind: "skills" };
  }

  for (const { pattern, section } of BULLET_PATTERNS) {
    const match = pattern.exec(fieldId);
    if (match) {
      return {
        section: section(match[1]),
        detail: `Bullet ${match[2]}`,
        kind: "bullet",
      };
    }
  }

  const achievement = /^ach_(\d+)$/.exec(fieldId);
  if (achievement) {
    return {
      section: "Achievements",
      detail: `Item ${achievement[1]}`,
      kind: "bullet",
    };
  }

  return { section: fieldId, kind: "other" };
}
