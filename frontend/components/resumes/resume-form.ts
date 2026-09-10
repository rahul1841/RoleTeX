import { z } from "zod";
import type {
  ResumeData,
  ResumeDraft,
  ResumeStyle,
  ResumeStyleInput,
} from "@/lib/api/types";
import { emptyResumeDraft, resumeDataToDraft } from "@/lib/api/mappers";

/**
 * The builder's form model, and the two conversions around it.
 *
 * THREE shapes, not two. The API already distinguishes the read shape
 * (`ResumeData`: server ids everywhere, bullets are `{ id, text }`) from the
 * write shape (`ResumeDraft`: no ids, bullets are plain strings). The form
 * needs a third, for two reasons that are both about `useFieldArray`:
 *
 *  - RHF keys array rows by a generated `id` on the row object, so an array of
 *    bare strings loses its identity the moment a row moves. Bullets are
 *    therefore `{ value }` objects while they are being edited. Rendering a
 *    list of primitives by index instead is what makes a reorder look like the
 *    text was retyped, and it breaks focus.
 *  - Free-tag lists (a project's technologies, a skill group's items) are one
 *    comma-separated input, not a nested array. A chip editor for "Python,
 *    SQL" is a worse way to type a list of five words than a text field.
 *
 * Everything is converted at the boundary; nothing is ever cast. `formToDraft`
 * is the only function that produces something safe to send.
 */

// --- server-mirrored limits ------------------------------------------------
// These are backend/app/schemas.py and backend/app/builder.py, restated. They exist so the
// form can refuse locally what the server would refuse remotely, with a
// message about the field rather than a 422 about the request.

export const LIMITS = {
  name: 160,
  email: 254,
  phone: 80,
  location: 180,
  linkLabel: 100,
  linkUrl: 500,
  role: 200,
  company: 200,
  dateText: 80,
  projectName: 200,
  projectUrl: 500,
  institution: 250,
  degree: 250,
  skillCategory: 120,
  sectionTitle: 80,
  /** backend/app/builder.py MAX_TEXT_ITEM_CHARACTERS — bullets and achievements. */
  bullet: 1_000,
  /** backend/app/builder.py MAX_SHORT_ITEM_CHARACTERS — tags and education details. */
  shortItem: 200,
  /** backend/app/resume.py MAX_SUMMARY_WORDS / MAX_SUMMARY_CHARACTERS. */
  summaryWords: 12,
  summaryChars: 120,
  resumeName: 120,
} as const;

/** Array caps, so "Add" can be disabled instead of the save failing. */
export const MAX_ENTRIES = {
  links: 12,
  experience: 30,
  projects: 30,
  education: 20,
  skills: 30,
  achievements: 50,
  customSections: 10,
  bullets: 30,
  details: 20,
  technologies: 40,
  skillItems: 100,
} as const;

export const FONT_SIZES = ["10pt", "11pt", "12pt"] as const;
export type FontSize = (typeof FONT_SIZES)[number];

/** backend/app/importer.py sanitize_style clamps the margin to this range. */
export const MARGIN_RANGE = { min: 1, max: 3, step: 0.1 } as const;

// --- form types ------------------------------------------------------------

/** One editable line. The wrapper object is what `useFieldArray` keys on. */
export interface TextItem {
  value: string;
}

export interface LinkFormValues {
  label: string;
  url: string;
}

export interface ExperienceFormValues {
  role: string;
  company: string;
  location: string;
  start: string;
  end: string;
  bullets: TextItem[];
}

export interface ProjectFormValues {
  name: string;
  url: string;
  /** Comma-separated; split on save. */
  technologies: string;
  bullets: TextItem[];
}

export interface EducationFormValues {
  institution: string;
  degree: string;
  location: string;
  start: string;
  end: string;
  details: TextItem[];
}

export interface SkillFormValues {
  category: string;
  /** Comma-separated; split on save. */
  items: string;
}

export interface CustomSectionFormValues {
  title: string;
  bullets: TextItem[];
}

export interface ResumeFormValues {
  /**
   * The library name — what the list shows, not anything that is printed.
   *
   * It lives in the form rather than beside it so the one submit path validates
   * it too. Only the create flow renders it; renaming afterwards is a separate
   * endpoint (`PATCH /api/resumes/{id}`) and a separate dialog, and `formToDraft`
   * drops this field entirely.
   */
  resumeName: string;
  identity: {
    name: string;
    email: string;
    phone: string;
    location: string;
    links: LinkFormValues[];
  };
  summary: string;
  experience: ExperienceFormValues[];
  projects: ProjectFormValues[];
  education: EducationFormValues[];
  skills: SkillFormValues[];
  achievements: TextItem[];
  custom_sections: CustomSectionFormValues[];
  style: {
    font_size: FontSize;
    margin_cm: number;
    /** `#RRGGBB`, or empty for the template default. */
    accent_hex: string;
  };
}

// --- helpers ---------------------------------------------------------------

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isHttpUrl(value: string): boolean {
  const lowered = value.toLowerCase();
  return lowered.startsWith("http://") || lowered.startsWith("https://");
}

function texts(items: TextItem[] | undefined): string[] {
  return (items ?? [])
    .map((item) => item.value.trim())
    .filter((value) => value.length > 0);
}

function splitTags(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * A row the user added and never filled in.
 *
 * Mirrors `_entry_is_blank` in backend/app/builder.py exactly, because the server
 * silently drops these rather than rejecting them. Validating them locally
 * would make the form stricter than the API and stop people saving with an
 * empty row left at the bottom — which is what an "Add" button always leaves.
 */
function isBlankEntry(fields: string[], ...lists: string[][]): boolean {
  if (fields.some((field) => field.trim().length > 0)) return false;
  return !lists.some((list) => list.some((item) => item.trim().length > 0));
}

function requireText(
  ctx: z.RefinementCtx,
  value: string,
  path: string,
  message: string,
): void {
  if (value.trim().length === 0) {
    ctx.addIssue({ code: "custom", path: [path], message });
  }
}

// --- validation ------------------------------------------------------------

const textItemSchema = (max: number, label: string) =>
  z.object({
    value: z.string().max(max, `${label} is longer than ${max} characters.`),
  });

const linkSchema = z
  .object({
    label: z.string().max(LIMITS.linkLabel),
    url: z.string().max(LIMITS.linkUrl),
  })
  .superRefine((link, ctx) => {
    const label = link.label.trim();
    const url = link.url.trim();
    // A wholly empty row is the "Add link" affordance, not an error.
    if (!label && !url) return;
    requireText(ctx, link.label, "label", "Give this link a label.");
    if (!url) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Add the web address.",
      });
    } else if (!isHttpUrl(url)) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Must start with http:// or https://",
      });
    }
  });

const experienceSchema = z
  .object({
    role: z.string().max(LIMITS.role),
    company: z.string().max(LIMITS.company),
    location: z.string().max(LIMITS.location),
    start: z.string().max(LIMITS.dateText),
    end: z.string().max(LIMITS.dateText),
    bullets: z.array(textItemSchema(LIMITS.bullet, "This bullet")),
  })
  .superRefine((entry, ctx) => {
    const bullets = entry.bullets.map((bullet) => bullet.value);
    if (
      isBlankEntry(
        [entry.role, entry.company, entry.location, entry.start, entry.end],
        bullets,
      )
    ) {
      return;
    }
    requireText(ctx, entry.role, "role", "A job title is required.");
    requireText(ctx, entry.company, "company", "A company is required.");
    requireText(ctx, entry.start, "start", "A start date is required.");
    requireText(ctx, entry.end, "end", "An end date is required.");
  });

const projectSchema = z
  .object({
    name: z.string().max(LIMITS.projectName),
    url: z.string().max(LIMITS.projectUrl),
    technologies: z.string(),
    bullets: z.array(textItemSchema(LIMITS.bullet, "This bullet")),
  })
  .superRefine((entry, ctx) => {
    const bullets = entry.bullets.map((bullet) => bullet.value);
    const tags = splitTags(entry.technologies);
    if (isBlankEntry([entry.name, entry.url], bullets, tags)) return;
    requireText(ctx, entry.name, "name", "A project name is required.");
    const url = entry.url.trim();
    if (url && !isHttpUrl(url)) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Must start with http:// or https://",
      });
    }
    if (tags.some((tag) => tag.length > LIMITS.shortItem)) {
      ctx.addIssue({
        code: "custom",
        path: ["technologies"],
        message: `Each technology must be under ${LIMITS.shortItem} characters.`,
      });
    }
  });

const educationSchema = z
  .object({
    institution: z.string().max(LIMITS.institution),
    degree: z.string().max(LIMITS.degree),
    location: z.string().max(LIMITS.location),
    start: z.string().max(LIMITS.dateText),
    end: z.string().max(LIMITS.dateText),
    details: z.array(textItemSchema(LIMITS.shortItem, "This detail")),
  })
  .superRefine((entry, ctx) => {
    const details = entry.details.map((detail) => detail.value);
    if (
      isBlankEntry(
        [
          entry.institution,
          entry.degree,
          entry.location,
          entry.start,
          entry.end,
        ],
        details,
      )
    ) {
      return;
    }
    requireText(ctx, entry.institution, "institution", "A school is required.");
    requireText(ctx, entry.degree, "degree", "A degree is required.");
    requireText(ctx, entry.start, "start", "A start date is required.");
    requireText(ctx, entry.end, "end", "An end date is required.");
  });

const skillSchema = z
  .object({
    category: z.string().max(LIMITS.skillCategory),
    items: z.string(),
  })
  .superRefine((entry, ctx) => {
    const items = splitTags(entry.items);
    if (isBlankEntry([entry.category], items)) return;
    requireText(ctx, entry.category, "category", "Name this group.");
    if (items.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "List at least one skill, or remove the group.",
      });
    }
    if (items.some((item) => item.length > LIMITS.shortItem)) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: `Each skill must be under ${LIMITS.shortItem} characters.`,
      });
    }
  });

const customSectionSchema = z
  .object({
    title: z.string().max(LIMITS.sectionTitle),
    bullets: z.array(textItemSchema(LIMITS.bullet, "This line")),
  })
  .superRefine((entry, ctx) => {
    const bullets = entry.bullets.map((bullet) => bullet.value);
    if (isBlankEntry([entry.title], bullets)) return;
    requireText(ctx, entry.title, "title", "Give this section a heading.");
    if (bullets.every((bullet) => bullet.trim().length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["bullets"],
        message: "Add at least one line, or remove the section.",
      });
    }
  });

/**
 * The whole form.
 *
 * Name and email are the only unconditionally required fields, matching
 * `_validate_identity`. Everything else is required *conditionally*, once a
 * row has been started — which is why almost every entry uses `superRefine`
 * rather than `.min(1)`.
 */
export const resumeFormSchema = z.object({
  resumeName: z
    .string()
    .max(LIMITS.resumeName, `Keep the name under ${LIMITS.resumeName} characters.`),
  identity: z.object({
    name: z
      .string()
      .trim()
      .min(1, "Your name is required.")
      .max(LIMITS.name, `Keep this under ${LIMITS.name} characters.`),
    email: z
      .string()
      .trim()
      .min(1, "Your email address is required.")
      .max(LIMITS.email)
      .regex(EMAIL_PATTERN, "That does not look like an email address."),
    phone: z.string().max(LIMITS.phone),
    location: z.string().max(LIMITS.location),
    links: z.array(linkSchema).max(MAX_ENTRIES.links),
  }),
  summary: z
    .string()
    .max(
      LIMITS.summaryChars,
      `The headline has to fit on one line — ${LIMITS.summaryChars} characters at most.`,
    )
    .refine(
      (value) =>
        value.trim().length === 0 ||
        value.trim().split(/\s+/).length <= LIMITS.summaryWords,
      `The headline has to fit on one line — ${LIMITS.summaryWords} words at most.`,
    ),
  experience: z.array(experienceSchema).max(MAX_ENTRIES.experience),
  projects: z.array(projectSchema).max(MAX_ENTRIES.projects),
  education: z.array(educationSchema).max(MAX_ENTRIES.education),
  skills: z.array(skillSchema).max(MAX_ENTRIES.skills),
  achievements: z
    .array(textItemSchema(LIMITS.bullet, "This achievement"))
    .max(MAX_ENTRIES.achievements),
  custom_sections: z
    .array(customSectionSchema)
    .max(MAX_ENTRIES.customSections),
  style: z.object({
    font_size: z.enum(FONT_SIZES),
    margin_cm: z.number().min(MARGIN_RANGE.min).max(MARGIN_RANGE.max),
    accent_hex: z
      .string()
      .refine(
        (value) => value === "" || /^#[0-9a-fA-F]{6}$/.test(value),
        "Use a six-digit hex colour, like #3355FF.",
      ),
  }),
});

/**
 * Whether the draft has anything worth storing.
 *
 * `POST /manual` and `PUT /content` both refuse a resume that is only a
 * contact block (`require_content=True`), while `POST /preview` allows it. So
 * this is checked at save time only — the live preview of a half-typed resume
 * is exactly the thing the relaxation exists for.
 */
export function hasContent(values: ResumeFormValues): boolean {
  const draft = formToDraft(values);
  return Boolean(
    draft.experience?.length ||
      draft.projects?.length ||
      draft.education?.length ||
      draft.skills?.length ||
      draft.achievements?.length ||
      draft.custom_sections?.length,
  );
}

// --- conversions -----------------------------------------------------------

function toItems(values: string[] | undefined): TextItem[] {
  return (values ?? []).map((value) => ({ value }));
}

export function draftToForm(
  draft: ResumeDraft,
  style?: ResumeStyle | null,
  resumeName = "",
): ResumeFormValues {
  const identity = draft.identity;
  return {
    resumeName,
    identity: {
      name: identity?.name ?? "",
      email: identity?.email ?? "",
      phone: identity?.phone ?? "",
      location: identity?.location ?? "",
      links: (identity?.links ?? []).map((link) => ({
        label: link.label,
        url: link.url,
      })),
    },
    summary: draft.summary ?? "",
    experience: (draft.experience ?? []).map((entry) => ({
      role: entry.role,
      company: entry.company,
      location: entry.location,
      start: entry.start,
      end: entry.end,
      bullets: toItems(entry.bullets),
    })),
    projects: (draft.projects ?? []).map((entry) => ({
      name: entry.name,
      url: entry.url,
      technologies: (entry.technologies ?? []).join(", "),
      bullets: toItems(entry.bullets),
    })),
    education: (draft.education ?? []).map((entry) => ({
      institution: entry.institution,
      degree: entry.degree,
      location: entry.location,
      start: entry.start,
      end: entry.end,
      details: toItems(entry.details),
    })),
    skills: (draft.skills ?? []).map((entry) => ({
      category: entry.category,
      items: (entry.items ?? []).join(", "),
    })),
    achievements: toItems(draft.achievements),
    custom_sections: (draft.custom_sections ?? []).map((entry) => ({
      title: entry.title,
      bullets: toItems(entry.bullets),
    })),
    style: {
      font_size: (FONT_SIZES as readonly string[]).includes(
        style?.font_size ?? "",
      )
        ? (style?.font_size as FontSize)
        : "10pt",
      margin_cm: Math.min(
        MARGIN_RANGE.max,
        Math.max(MARGIN_RANGE.min, style?.margin_cm ?? 2),
      ),
      accent_hex: style?.accent_hex ? `#${style.accent_hex}` : "",
    },
  };
}

/** A stored resume, ready for the builder. Read shape in, form shape out. */
export function resumeDataToForm(
  data: ResumeData,
  style?: ResumeStyle | null,
  resumeName = "",
): ResumeFormValues {
  return draftToForm(resumeDataToDraft(data), style, resumeName);
}

export function emptyResumeForm(): ResumeFormValues {
  return draftToForm(emptyResumeDraft(), null, "");
}

/**
 * Form values to the write shape.
 *
 * Trims everything and drops empties, so a trailing blank bullet or a link row
 * the user opened and abandoned never reaches the server. Blank *entries* are
 * left in place: backend/app/builder.py prunes them, and removing them here would
 * renumber the entries that validation messages refer to.
 */
export function formToDraft(values: ResumeFormValues): ResumeDraft {
  return {
    identity: {
      name: values.identity.name.trim(),
      email: values.identity.email.trim(),
      phone: values.identity.phone.trim(),
      location: values.identity.location.trim(),
      links: values.identity.links
        .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
        .filter((link) => link.label.length > 0 && link.url.length > 0),
    },
    summary: values.summary.trim(),
    experience: values.experience.map((entry) => ({
      role: entry.role.trim(),
      company: entry.company.trim(),
      location: entry.location.trim(),
      start: entry.start.trim(),
      end: entry.end.trim(),
      bullets: texts(entry.bullets),
    })),
    projects: values.projects.map((entry) => ({
      name: entry.name.trim(),
      url: entry.url.trim(),
      technologies: splitTags(entry.technologies),
      bullets: texts(entry.bullets),
    })),
    education: values.education.map((entry) => ({
      institution: entry.institution.trim(),
      degree: entry.degree.trim(),
      location: entry.location.trim(),
      start: entry.start.trim(),
      end: entry.end.trim(),
      details: texts(entry.details),
    })),
    skills: values.skills.map((entry) => ({
      category: entry.category.trim(),
      items: splitTags(entry.items),
    })),
    achievements: texts(values.achievements),
    custom_sections: values.custom_sections.map((entry) => ({
      title: entry.title.trim(),
      bullets: texts(entry.bullets),
    })),
  };
}

/**
 * Form values to the style payload.
 *
 * `accent_hex` goes out without the leading `#` because `sanitize_style`
 * strips one anyway and `ResumeStyle` stores six characters; sending `null`
 * for an empty field is what restores the template default.
 */
export function formToStyle(values: ResumeFormValues): ResumeStyleInput {
  const accent = values.style.accent_hex.trim().replace(/^#/, "");
  return {
    paper: "a4paper",
    font_size: values.style.font_size,
    margin_cm: values.style.margin_cm,
    accent_hex: accent.length === 6 ? accent.toUpperCase() : null,
  };
}

/** Blank rows, used by every "Add" button. */
export const BLANK = {
  link: (): LinkFormValues => ({ label: "", url: "" }),
  bullet: (): TextItem => ({ value: "" }),
  experience: (): ExperienceFormValues => ({
    role: "",
    company: "",
    location: "",
    start: "",
    end: "",
    bullets: [{ value: "" }],
  }),
  project: (): ProjectFormValues => ({
    name: "",
    url: "",
    technologies: "",
    bullets: [{ value: "" }],
  }),
  education: (): EducationFormValues => ({
    institution: "",
    degree: "",
    location: "",
    start: "",
    end: "",
    details: [],
  }),
  skill: (): SkillFormValues => ({ category: "", items: "" }),
  customSection: (): CustomSectionFormValues => ({
    title: "",
    bullets: [{ value: "" }],
  }),
} as const;
