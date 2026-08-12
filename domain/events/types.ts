// Event taxonomy and structured call-event shape.
// Application logic runs on structured, Zod-validated events (see
// domain/schemas/call-event.ts) — never by parsing arbitrary prose.
//
// The nine event types, categories, and speaker roles below are the single
// source of truth and MUST match migrations/001_initial_schema.sql exactly
// (public.event_type, public.event_category, public.speaker_role).

export const EVENT_TYPES = [
  "OBJECTION",
  "QUESTION",
  "BUYING_SIGNAL",
  "PRICE_DISCUSSION",
  "COMPETITOR_MENTION",
  "PAIN_DISCOVERED",
  "AUTHORITY_SIGNAL",
  "TIMELINE_SIGNAL",
  "MISSED_DISCOVERY",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_CATEGORIES = ["positive", "negative", "neutral"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const SPEAKER_ROLES = ["rep", "prospect", "system"] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];

/**
 * Structured call event. `exactEvidence` is a verbatim quote — never invented.
 * `metadata` carries structured (non-prose) hints used by downstream logic,
 * e.g. `{ objectionType: "price" }`, `{ facet: "impact" }`,
 * `{ dimension: "budget" }`, `{ isConcern: true }`.
 */
export interface CallEvent {
  id: string; // UUID string — never Number(id)/parseInt(id)
  callId?: string;
  segmentId?: string | null;
  type: EventType;
  category: EventCategory;
  /** 0..1 detection confidence. */
  confidence: number;
  speaker: SpeakerRole;
  /** Verbatim quote from the transcript segment. */
  exactEvidence: string;
  /** 0..10 signal importance. */
  importance: number;
  /** Milliseconds from call start (non-negative). */
  relativeTimeMs: number;
  metadata: Record<string, unknown>;
}
