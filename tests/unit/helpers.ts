// Shared test factories for domain unit tests (not part of the product).
import type { CallEvent } from "@/domain/events/types";

let seq = 0;
export function nextUuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

export interface MakeEventOptions {
  id?: string;
  segmentId?: string;
  confidence?: number;
  importance?: number;
  relativeTimeMs?: number;
  metadata?: Record<string, unknown>;
}

export function makeEvent(
  type: CallEvent["type"],
  speaker: CallEvent["speaker"],
  exactEvidence: string,
  options: MakeEventOptions = {}
): CallEvent {
  return {
    id: options.id ?? nextUuid(),
    segmentId: options.segmentId ?? null,
    type,
    category:
      type === "OBJECTION" || type === "PRICE_DISCUSSION" || type === "COMPETITOR_MENTION"
        ? "negative"
        : type === "BUYING_SIGNAL" || type === "PAIN_DISCOVERED" || type === "AUTHORITY_SIGNAL" || type === "TIMELINE_SIGNAL"
          ? "positive"
          : "neutral",
    confidence: options.confidence ?? 0.9,
    speaker,
    exactEvidence,
    importance: options.importance ?? 5,
    relativeTimeMs: options.relativeTimeMs ?? 0,
    metadata: options.metadata ?? {},
  };
}
