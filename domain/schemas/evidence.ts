// Evidence items: structured references to confirmed facts used by scoring,
// reviews, and coaching. `quote` is a verbatim transcript quote — never
// invented. Mirrors call_sessions.evidence JSONB.
import { z } from "zod";

export const EVIDENCE_KINDS = [
  "pain",
  "impact",
  "authority",
  "budget",
  "timeline",
  "current_solution",
  "competitor",
  "objection",
  "price_concern",
  "buying_signal",
  "next_step",
  "rejection",
  "fit",
  "interest",
  "other",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EvidenceItemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(EVIDENCE_KINDS),
  /** Short human-readable summary of the fact (evidence-based). */
  summary: z.string().min(1),
  /** Verbatim quote supporting the fact. */
  quote: z.string().min(1),
  eventId: z.uuid().optional(),
  segmentId: z.uuid().optional(),
  relativeTimeMs: z.number().int().min(0).optional(),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
