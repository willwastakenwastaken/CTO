// Zod schemas for the Prospects workspace: the create/edit form, inline
// edits (next action, stage), notes, and the list query inputs (searchParams).
// Pure module — unit-tested by Vitest. Fields are .optional() (never
// .default()) so the schema's input and output types stay identical, which
// keeps RHF + zodResolver's transformed-values typing straightforward.
import { z } from "zod";
import { PIPELINE_STAGES } from "@/domain/pipeline/types";
import type { PipelineStage } from "@/domain/pipeline/types";

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `Keep ${label} under ${max} characters.`).optional();

/** A non-empty value must be a valid email; "" (blank) and undefined are fine. */
const optionalEmail = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .email("Enter a valid email address.")
      .max(254, "Keep the email under 254 characters."),
  ])
  .optional();

/** A non-empty value must be a valid absolute URL; "" (blank) is fine. */
const optionalUrl = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .url("Enter a valid URL, e.g. https://example.com.")
      .max(500, "Keep the URL under 500 characters."),
  ])
  .optional();

/** "" (no due date) and undefined are fine; anything else must be YYYY-MM-DD. */
const optionalDate = z
  .union([z.literal(""), z.string().date("Enter a valid date (YYYY-MM-DD).")])
  .optional();

export const tagsSchema = z
  .array(z.string().trim().max(80, "Keep tags under 80 characters."))
  .max(24, "Too many tags — keep it under 24.")
  .optional();

/**
 * The create/edit prospect form. Every field is optional: blank = unknown,
 * never fabricated. At least one of first name, last name, or company is
 * required so the prospect is recognizable in lists.
 */
export const prospectFormSchema = z
  .object({
    first_name: optionalText(120, "the first name"),
    last_name: optionalText(120, "the last name"),
    title: optionalText(120, "the title"),
    email: optionalEmail,
    phone: optionalText(40, "the phone number"),
    company: optionalText(200, "the company name"),
    website: optionalUrl,
    industry: optionalText(200, "the industry"),
    size: optionalText(40, "the company size"),
    location: optionalText(200, "the location"),
    stage: z.enum(PIPELINE_STAGES).optional(),
    next_action: optionalText(500, "the next action"),
    next_action_due_date: optionalDate,
    tags: tagsSchema,
    source: optionalText(120, "the source"),
  })
  .superRefine((values, ctx) => {
    if (
      !values.first_name?.trim() &&
      !values.last_name?.trim() &&
      !values.company?.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["first_name"],
        message:
          "Add a name or company so you can recognize this prospect (blank fields stay unknown).",
      });
    }
  });

export type ProspectFormValues = z.infer<typeof prospectFormSchema>;

/** Stage-change action input (from the Command Center stage control). */
export const stageChangeSchema = z.object({
  targetStage: z.enum(PIPELINE_STAGES),
  /** The stage the client believes the prospect is in (stale-cursor check). */
  expectedStage: z.enum(PIPELINE_STAGES),
  /** Explicit confirmation — required for terminal stages (closed_won/lost). */
  confirmed: z.boolean().optional(),
});
export type StageChangeValues = z.infer<typeof stageChangeSchema>;

/** Inline next-action edit on the Command Center (only these two fields). */
export const nextActionSchema = z.object({
  next_action: optionalText(500, "the next action"),
  next_action_due_date: optionalDate,
});
export type NextActionValues = z.infer<typeof nextActionSchema>;

/** General-note creation on the Command Center. */
export const noteSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Add a short title.")
    .max(200, "Keep the title under 200 characters."),
  body: z.string().trim().max(4000, "Keep the note under 4000 characters.").optional(),
});
export type NoteValues = z.infer<typeof noteSchema>;

/** Opportunity Fit reasons are persisted as DB-shaped JSON — validate it. */
export const opportunityFitReasonsSchema = z.array(
  z.object({
    dimension: z.string(),
    score: z.number().min(0).max(100).nullable(),
    reason: z.string(),
  })
);

/** List query inputs (searchParams on /prospects) — parse defensively. */
export const PROSPECT_SORTS = [
  "name",
  "company",
  "created",
  "last_contact",
  "due",
] as const;
export type ProspectSort = (typeof PROSPECT_SORTS)[number];

export const prospectListQuerySchema = z.object({
  q: z.string().trim().max(200, "Search is too long.").optional(),
  stage: z.enum(PIPELINE_STAGES).optional(),
  sort: z.enum(PROSPECT_SORTS).optional(),
});
export type ProspectListQuery = z.infer<typeof prospectListQuerySchema>;

/** Validates a stage string as a PipelineStage (route/action boundary). */
export function parseStage(value: unknown): PipelineStage | null {
  const parsed = z.enum(PIPELINE_STAGES).safeParse(value);
  return parsed.success ? parsed.data : null;
}
