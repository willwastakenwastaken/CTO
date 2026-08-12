// Coaching domain types (placeholder).
// Coaching must be evidence-backed from completed call data. Patterns are only
// inferred after at least THREE eligible calls; never fabricate trends.

export type SuggestionAction =
  | "ASK"
  | "SAY"
  | "CLARIFY"
  | "LISTEN"
  | "CLOSE"
  | "DO_NOT_PUSH";

export interface Suggestion {
  id: string; // UUID string
  action: SuggestionAction;
  text: string;
  reason: string;
  // TODO(Phase 1): priority, expiration, display/dismiss/use times, feedback.
}

export interface CoachingObservation {
  kind: "strength" | "improvement";
  // TODO(Phase 1): evidence-backed strength or improvement area payload.
}
