// Event taxonomy: fixed priority/precedence ordering used by the intervention
// policy, plus default category and importance hints for event producers.
import type {
  CallEvent,
  EventCategory,
  EventType,
} from "@/domain/events/types";
import { EVENT_TYPES } from "@/domain/events/types";

/**
 * Intervention priority per event type (higher = more urgent to act on).
 * Follows the spec preference order: timely prospect questions, high-priority
 * objections, LISTEN while useful detail is shared, buying signals, then
 * missed discovery. PRICE_DISCUSSION sits with objections (it IS the price
 * objection); TIMELINE/AUTHORITY/COMPETITOR rank below missed discovery.
 */
export const EVENT_PRIORITY: Record<EventType, number> = {
  QUESTION: 10, // timely prospect question — answer first
  OBJECTION: 9, // high-priority objection
  PRICE_DISCUSSION: 8, // price concern — quantify value, never discount
  PAIN_DISCOVERED: 7, // pain elaboration — LISTEN while detail is shared
  BUYING_SIGNAL: 6,
  TIMELINE_SIGNAL: 5,
  MISSED_DISCOVERY: 4,
  AUTHORITY_SIGNAL: 3,
  COMPETITOR_MENTION: 2,
};

/** Default category per type (event producers may override). */
export const DEFAULT_EVENT_CATEGORY: Record<EventType, EventCategory> = {
  OBJECTION: "negative",
  QUESTION: "neutral",
  BUYING_SIGNAL: "positive",
  PRICE_DISCUSSION: "negative",
  COMPETITOR_MENTION: "negative",
  PAIN_DISCOVERED: "positive",
  AUTHORITY_SIGNAL: "positive",
  TIMELINE_SIGNAL: "positive",
  MISSED_DISCOVERY: "neutral",
};

/** Importance hint (0-10) for deterministic event producers (e.g. the ABC
 * simulation) when no stronger signal is available. */
export const EVENT_IMPORTANCE_HINT: Record<EventType, number> = {
  OBJECTION: 8,
  PRICE_DISCUSSION: 8,
  BUYING_SIGNAL: 7,
  TIMELINE_SIGNAL: 6,
  PAIN_DISCOVERED: 6,
  QUESTION: 5,
  AUTHORITY_SIGNAL: 5,
  COMPETITOR_MENTION: 4,
  MISSED_DISCOVERY: 3,
};

export type PrecedenceKey = Pick<
  CallEvent,
  "type" | "importance" | "relativeTimeMs"
>;

/**
 * Compare two events for intervention precedence. Returns a negative number
 * when `a` outranks `b`. Order: priority desc, then importance desc, then
 * most recent (relativeTimeMs desc).
 */
export function compareEventPrecedence(a: PrecedenceKey, b: PrecedenceKey): number {
  const priorityDiff = EVENT_PRIORITY[b.type] - EVENT_PRIORITY[a.type];
  if (priorityDiff !== 0) return priorityDiff;
  const importanceDiff = b.importance - a.importance;
  if (importanceDiff !== 0) return importanceDiff;
  return b.relativeTimeMs - a.relativeTimeMs;
}

/** Sorts events by intervention precedence (most urgent first). */
export function sortEventsByPrecedence(events: readonly CallEvent[]): CallEvent[] {
  return [...events].sort(compareEventPrecedence);
}

export { EVENT_TYPES };
export type { EventCategory, EventType };
