// Call Strategy — the BEFORE-the-call brief (spec: known prospect context,
// opportunity angle, likely pain hypotheses, ONE call objective, ONE opener,
// three to five discovery questions, up to three likely objections, desired
// close). Pure, deterministic, honest: every section is derived ONLY from the
// Sales Profile + prospect rows actually stored. "Blank = unknown" — the
// builder never invents prospect facts, pain areas, or personalization, and it
// returns an explicit onboarding-required state when no Sales Profile exists.
//
// The output is Zod-validated (callStrategySchema) so the UI can trust the
// shape it renders; saved facts, profile-derived content, and hypotheses are
// labeled separately by construction (see the `basis`/`source` fields).
import { z } from "zod";

// ---------------------------------------------------------------------------
// Inputs (persistence-shaped subsets — server maps rows onto these)
// ---------------------------------------------------------------------------

export interface CallStrategyProfileInput {
  name: string | null;
  product_name: string | null;
  description: string | null;
  benefits: string | null;
  problems_solved: string | null;
  differentiators: string | null;
  ideal_customer: string | null;
  call_goal: string | null;
  preferred_cta: string | null;
  objections: readonly string[];
  guardrails: readonly string[];
}

export interface CallStrategyProspectInput {
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  company: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  tags: readonly string[];
  source: string | null;
}

// ---------------------------------------------------------------------------
// Output (Zod-validated)
// ---------------------------------------------------------------------------

export const anglePointSchema = z.object({
  label: z.string(),
  detail: z.string(),
});

export const painHypothesisSchema = z.object({
  /** The problem sentence from the profile (verbatim, labeled a hypothesis). */
  hypothesis: z.string(),
  /** Why it is plausible for THIS prospect (industry/size/tag/ideal match). */
  support: z.string(),
});

export const discoveryQuestionSchema = z.object({
  question: z.string(),
  /** Where the question comes from: profile content or a neutral standard. */
  basis: z.string(),
});

export const expectedObjectionSchema = z.object({
  objection: z.string(),
  /** The guardrail that applies when this objection comes up, if any. */
  relatedGuardrail: z.string().nullable(),
});

export const callStrategyReadySchema = z.object({
  state: z.literal("ready"),
  /** The sales profile's own name, when it has one. */
  profileName: z.string().nullable(),
  context: z.object({
    /** Display name (falls back to company / "Unnamed prospect"). */
    name: z.string(),
    company: z.string().nullable(),
    title: z.string().nullable(),
    industry: z.string().nullable(),
    size: z.string().nullable(),
    location: z.string().nullable(),
    tags: z.array(z.string()),
    source: z.string().nullable(),
    /** One-line summary of the known facts; null when nothing is recorded. */
    summary: z.string().nullable(),
  }),
  angle: z.object({
    present: z.boolean(),
    summary: z.string().nullable(),
    points: z.array(anglePointSchema),
    /** Honest explanation when no angle is inferable (never fabricated). */
    note: z.string().nullable(),
  }),
  painHypotheses: z.array(painHypothesisSchema),
  objective: z.object({
    text: z.string(),
    source: z.enum(["profile", "default"]),
  }),
  opener: z.object({
    text: z.string(),
    greeting: z.string(),
    hook: z.string().nullable(),
    cta: z.string().nullable(),
    source: z.enum(["profile", "template"]),
    note: z.string().nullable(),
  }),
  discoveryQuestions: z.array(discoveryQuestionSchema),
  objectionsToExpect: z.array(expectedObjectionSchema),
  /** The profile's guardrails, surfaced so the rep keeps them in mind. */
  guardrails: z.array(z.string()),
  close: z.object({
    instruction: z.string(),
    source: z.enum(["profile", "template"]),
    note: z.string().nullable(),
  }),
});

export const onboardingRequiredSchema = z.object({
  state: z.literal("onboarding_required"),
  reason: z.string(),
});

export const callStrategySchema = z.discriminatedUnion("state", [
  onboardingRequiredSchema,
  callStrategyReadySchema,
]);

export type CallStrategyResult = z.infer<typeof callStrategySchema>;
export type CallStrategyReady = z.infer<typeof callStrategyReadySchema>;
export type AnglePoint = z.infer<typeof anglePointSchema>;
export type PainHypothesis = z.infer<typeof painHypothesisSchema>;
export type DiscoveryQuestion = z.infer<typeof discoveryQuestionSchema>;
export type ExpectedObjection = z.infer<typeof expectedObjectionSchema>;
