/**
 * Conversion between the resume READ shape and the resume WRITE shape.
 *
 * This is the API's sharpest edge. `GET /api/resumes/{id}` returns
 * `ResumeData`; every write endpoint takes `ResumeDraft`. They differ in two
 * ways, in every nested section:
 *
 *   1. Entries carry a server-owned `id` on read (`ResumeExperience`,
 *      `ResumeProject`, `ResumeEducation`, `ResumeCustomSection`); the draft
 *      equivalents have no `id` field at all.
 *   2. Bullets are `{ id, text }` objects on read and plain `string`s on
 *      write. Same for `achievements`.
 *
 * Because every request model is Pydantic `extra="forbid"`, sending a
 * `ResumeData` where a `ResumeDraft` is expected fails with 422
 * `invalid_request` — it does not silently ignore the extra keys.
 *
 * Verified field-by-field against the generated OpenAPI schema; `skills` and
 * `identity.links` are structurally identical and pass through unchanged.
 */

import type {
  ResumeBullet,
  ResumeData,
  ResumeDraft,
  ResumeDraftCustomSection,
  ResumeDraftEducation,
  ResumeDraftExperience,
  ResumeDraftIdentity,
  ResumeDraftProject,
} from "./types";

/** `[{id, text}]` -> `["text"]`. Blank bullets are dropped: the server rejects
 * empty strings (`ResumeBullet.text` has `min_length=1`). */
function bulletsToText(bullets: ResumeBullet[] | undefined): string[] {
  return (bullets ?? [])
    .map((bullet) => bullet.text)
    .filter((text) => text.trim().length > 0);
}

function toDraftIdentity(identity: ResumeData["identity"]): ResumeDraftIdentity {
  // ResumeLink and ResumeDraftLink are structurally identical.
  return {
    name: identity.name,
    email: identity.email,
    phone: identity.phone,
    location: identity.location,
    links: (identity.links ?? []).map((link) => ({
      label: link.label,
      url: link.url,
    })),
  };
}

function toDraftExperience(
  entries: ResumeData["experience"],
): ResumeDraftExperience[] {
  // `id` is deliberately not spread: it does not exist on the draft type and
  // would be rejected by extra="forbid".
  return (entries ?? []).map((entry) => ({
    company: entry.company,
    role: entry.role,
    location: entry.location,
    start: entry.start,
    end: entry.end,
    bullets: bulletsToText(entry.bullets),
  }));
}

function toDraftProjects(
  entries: ResumeData["projects"],
): ResumeDraftProject[] {
  return (entries ?? []).map((entry) => ({
    name: entry.name,
    url: entry.url,
    technologies: entry.technologies ?? [],
    bullets: bulletsToText(entry.bullets),
  }));
}

function toDraftEducation(
  entries: ResumeData["education"],
): ResumeDraftEducation[] {
  // `details` is already string[] on both sides — only `id` is stripped.
  return (entries ?? []).map((entry) => ({
    institution: entry.institution,
    degree: entry.degree,
    location: entry.location,
    start: entry.start,
    end: entry.end,
    details: entry.details ?? [],
  }));
}

function toDraftCustomSections(
  entries: ResumeData["custom_sections"],
): ResumeDraftCustomSection[] {
  return (entries ?? []).map((entry) => ({
    title: entry.title,
    bullets: bulletsToText(entry.bullets),
  }));
}

/**
 * Convert a stored resume into an editable draft.
 *
 * Use this whenever loading an existing resume into the builder form. The
 * returned object is safe to POST/PUT back.
 *
 * Note this is lossy by design: bullet ids are dropped, because the server
 * reassigns them on save. That is also why a tailoring proposal's
 * `bullet_rewrites` (which address bullets *by id*) must be applied against
 * `ResumeData`, never against a draft.
 */
export function resumeDataToDraft(resume: ResumeData): ResumeDraft {
  return {
    identity: toDraftIdentity(resume.identity),
    summary: resume.summary ?? "",
    experience: toDraftExperience(resume.experience),
    projects: toDraftProjects(resume.projects),
    education: toDraftEducation(resume.education),
    // Structurally identical; copied rather than aliased so form edits cannot
    // mutate the cached query data.
    skills: (resume.skills ?? []).map((category) => ({
      category: category.category,
      items: [...(category.items ?? [])],
    })),
    achievements: bulletsToText(resume.achievements),
    custom_sections: toDraftCustomSections(resume.custom_sections),
  };
}

/** An empty draft, for "create a resume from scratch" in the builder. */
export function emptyResumeDraft(): ResumeDraft {
  return {
    identity: { name: "", email: "", phone: "", location: "", links: [] },
    summary: "",
    experience: [],
    projects: [],
    education: [],
    skills: [],
    achievements: [],
    custom_sections: [],
  };
}
