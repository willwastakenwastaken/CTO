// DB-shaped JSON for call_sessions.review_payload — the full rendered Call
// Review. Refreshing a completed review loads this same saved payload.
import { z } from "zod";
import { PIPELINE_STAGES } from "@/domain/pipeline/types";
import { CoachingObservationSchema } from "@/domain/schemas/coaching";

export const ReviewEvidenceRefSchema = z.object({
  eventId: z.uuid(),
  segmentId: z.uuid().optional(),
  quote: z.string().min(1),
  relativeTimeMs: z.number().int().min(0),
});
export type ReviewEvidenceRef = z.infer<typeof ReviewEvidenceRefSchema>;

export const PurchaseIntentSectionSchema = z.object({
  score: z.number().int().min(0).max(100).nullable(),
  label: z.string().min(1),
  /** 0..1 fraction of the seven evidence dimensions that are known. */
  evidenceCompleteness: z.number().min(0).max(1),
  positives: z.array(z.string()),
  risks: z.array(z.string()),
  unknowns: z.array(z.string()),
  scoringVersion: z.string(),
});
export type PurchaseIntentSection = z.infer<typeof PurchaseIntentSectionSchema>;

export const ReviewPayloadSchema = z.object({
  outcome: z.string().nullable().optional(),
  /** Two- or three-sentence evidence-based summary. */
  summary: z.string().min(1),
  purchaseIntent: PurchaseIntentSectionSchema,
  facts: z.object({
    pain: z.string().nullable(),
    impact: z.string().nullable(),
    authority: z.string().nullable(),
    budget: z.string().nullable(),
    timing: z.string().nullable(),
    currentSolution: z.string().nullable(),
    competitors: z.array(z.string()),
    decisionProcess: z.string().nullable(),
  }),
  buyingSignals: z.array(ReviewEvidenceRefSchema).default([]),
  objections: z.array(ReviewEvidenceRefSchema).default([]),
  /** One specific next action. */
  nextAction: z.string().min(1),
  /** One to three concrete rep-coaching observations. */
  coaching: z.array(CoachingObservationSchema).min(1).max(3),
  pipelineRecommendation: z.object({
    targetStage: z.enum(PIPELINE_STAGES),
    reason: z.string().min(1),
  }),
  segmentReferences: z.array(z.uuid()).default([]),
  scoringVersion: z.string(),
});

export type ReviewPayload = z.infer<typeof ReviewPayloadSchema>;
