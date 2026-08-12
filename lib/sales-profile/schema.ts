import { z } from "zod";

/**
 * Zod schemas for every Phase 1 auth + onboarding form, plus the spec's
 * objection/guardrail defaults. Pure module — unit-tested by Vitest.
 */

// ---------------------------------------------------------------------------
// Auth forms
// ---------------------------------------------------------------------------

export const signupSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(80, "Keep your name under 80 characters."),
  email: z.string().trim().email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(128, "Keep your password under 128 characters."),
});

export type SignupValues = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginValues = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const accountSettingsSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(80, "Keep your name under 80 characters.")
    .optional(),
  timezone: z
    .string()
    .trim()
    .max(64, "Keep the timezone under 64 characters.")
    .optional(),
});

export type AccountSettingsValues = z.infer<typeof accountSettingsSchema>;

// ---------------------------------------------------------------------------
// Sales Profile onboarding
// ---------------------------------------------------------------------------

/** The spec's common-objection defaults, offered as selectable chips. */
export const OBJECTION_DEFAULTS = [
  "price",
  "existing vendor",
  "not interested",
  "need to think",
  "partner approval",
  "no time",
  "bad timing",
  "send information",
] as const;

/** The spec's guardrail examples, pre-filled and editable. */
export const GUARDRAIL_EXAMPLES = [
  "no unauthorized discounts",
  "no ROI guarantees",
  "no legal claims",
  "no invented features",
  "no implementation commitments",
] as const;

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `Keep ${label} under ${max} characters.`).optional();

// List fields accept empty strings from the form UI (e.g. a guardrail row the
// user left blank); compactList() drops those before saving. Optional (not
// .default()) so the schema's input and output types stay identical, which
// keeps RHF + zodResolver's transformed-values typing straightforward.
const stringList = (max: number, label: string) =>
  z
    .array(z.string().trim().max(200, `Keep ${label} entries under 200 characters.`))
    .max(24, `Too many ${label} — keep it under 24.`)
    .optional();

export const salesProfileSchema = z.object({
  product_name: z
    .string()
    .trim()
    .min(1, "Enter the product or service name.")
    .max(120, "Keep the product name under 120 characters."),
  description: optionalText(2000, "the description"),
  pricing: optionalText(300, "the pricing model"),
  ideal_customer: optionalText(1000, "the ideal customer description"),
  benefits: optionalText(1000, "the benefits"),
  problems_solved: optionalText(1000, "the problems solved"),
  differentiators: optionalText(1000, "the differentiators"),
  call_goal: optionalText(500, "the call objective"),
  preferred_cta: optionalText(500, "the preferred call to action"),
  sales_process: optionalText(1000, "the sales process"),
  objections: stringList(24, "objections"),
  guardrails: stringList(24, "guardrails"),
});

export type SalesProfileValues = z.infer<typeof salesProfileSchema>;

/**
 * Drops empty/whitespace-only entries and dedupes (case-insensitive) before a
 * list of objections/guardrails is saved. Never invents content.
 */
export function compactList(
  items: readonly (string | null | undefined)[] | null | undefined
): string[] {
  if (!items) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Trims a free-text form value; blank/whitespace becomes null (DB NULL). */
export function textOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
