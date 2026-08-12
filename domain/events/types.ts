// Event taxonomy and structured call-event shape (placeholder).
// Application logic must run on structured, Zod-validated events — never by
// parsing arbitrary prose.

export type EventType =
  | "OBJECTION"
  | "QUESTION"
  | "BUYING_SIGNAL"
  | "PRICE_DISCUSSION"
  | "COMPETITOR_MENTION"
  | "PAIN_DISCOVERED"
  | "AUTHORITY_SIGNAL"
  | "TIMELINE_SIGNAL"
  | "MISSED_DISCOVERY";

export type EventCategory = "positive" | "negative" | "neutral";

export interface CallEvent {
  id: string; // UUID string
  type: EventType;
  category: EventCategory;
  confidence: number; // 0..1
  // TODO(Phase 1): speaker, exact evidence, segment id, relative time,
  // importance, metadata — validated with Zod.
}
