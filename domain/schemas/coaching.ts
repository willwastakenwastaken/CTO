// Structured coaching output: evidence-backed observations for the Call
// Review and Coach surfaces. Never fabricate trends or quotes.
import { z } from "zod";

export const CoachingEvidenceRefSchema = z.object({
  eventId: z.uuid(),
  segmentId: z.uuid().optional(),
  quote: z.string().min(1),
  relativeTimeMs: z.number().int().min(0),
});
export type CoachingEvidenceRef = z.infer<typeof CoachingEvidenceRefSchema>;

export const CoachingObservationSchema = z.object({
  kind: z.enum(["strength", "improvement"]),
  /** Coaching area, e.g. "price handling". */
  area: z.string().min(1),
  /** One concrete, evidence-backed observation sentence. */
  observation: z.string().min(1),
  evidence: z.array(CoachingEvidenceRefSchema).default([]),
});
export type CoachingObservationOutput = z.infer<
  typeof CoachingObservationSchema
>;

/** Structured call-summary note content (prospect_notes.structured_content). */
export const CallSummaryNoteSchema = z.object({
  situation: z.string(),
  pain: z.string(),
  impact: z.string(),
  decisionProcess: z.string(),
  timing: z.string(),
  objections: z.array(z.string()),
  nextStep: z.string(),
});
export type CallSummaryNote = z.infer<typeof CallSummaryNoteSchema>;
