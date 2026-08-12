// Zod schema for the structured call-event shape (call_events table).
// Events are the ONLY input to application logic — never parse arbitrary
// prose. `exactEvidence` must be a verbatim quote; never invented.
import { z } from "zod";
import {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  SPEAKER_ROLES,
} from "@/domain/events/types";

export const CallEventSchema = z.object({
  id: z.uuid(),
  callId: z.uuid().optional(),
  segmentId: z.uuid().nullable().optional(),
  type: z.enum(EVENT_TYPES),
  category: z.enum(EVENT_CATEGORIES),
  confidence: z.number().min(0).max(1),
  speaker: z.enum(SPEAKER_ROLES),
  exactEvidence: z.string().min(1),
  importance: z.number().int().min(0).max(10),
  relativeTimeMs: z.number().int().min(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CallEvent = z.infer<typeof CallEventSchema>;
export type CallEventInput = z.input<typeof CallEventSchema>;

/** Structured metadata hints the deterministic simulation may attach. */
export const CallEventMetadataSchema = z.object({
  /** For OBJECTION events: "price" marks the price objection. */
  objectionType: z.string().optional(),
  /** For PAIN_DISCOVERED events: "pain" | "impact". */
  facet: z.string().optional(),
  /** For MISSED_DISCOVERY events: which dimension the rep missed. */
  dimension: z.string().optional(),
  /** For PRICE_DISCUSSION events: false => neutral mention, not a concern. */
  isConcern: z.boolean().optional(),
});
export type CallEventMetadata = z.infer<typeof CallEventMetadataSchema>;
