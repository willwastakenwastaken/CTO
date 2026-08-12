// Conversation state — the evolving truth model of a live call (placeholder).
// Confirmed facts require evidence ids; later explicit corrections outrank
// earlier statements; rep statements cannot confirm prospect facts; missing
// evidence never erases confirmed information.

export type InterestLevel = "unknown" | "low" | "medium" | "high";

export interface ConversationState {
  stage: string;
  interest: InterestLevel;
  // TODO(Phase 1): pain, impact, authority, budget, timeline, current solution,
  // competitors, objections, buying signals, next objective — each with
  // evidence ids.
}
