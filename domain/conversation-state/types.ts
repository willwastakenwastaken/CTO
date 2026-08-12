// Conversation state — the evolving truth model of a live call.
// Confirmed facts require evidence ids; later explicit corrections outrank
// earlier statements; rep statements cannot confirm prospect facts; missing
// evidence never erases confirmed information.

export const INTEREST_LEVELS = ["unknown", "low", "medium", "high"] as const;
export type InterestLevel = (typeof INTEREST_LEVELS)[number];

export const CONVERSATION_STAGES = [
  "opening",
  "discovery",
  "qualification",
  "presentation",
  "closing",
] as const;
export type ConversationStage = (typeof CONVERSATION_STAGES)[number];

/**
 * A confirmed (or updated) fact. `value` is the latest confirmed value;
 * `evidenceIds` accumulates every event UUID that confirmed or updated it
 * (history is preserved — missing/removed evidence never erases a fact).
 */
export interface StateFact {
  value: string;
  /** Event UUIDs (call_events.id) that support this fact, oldest first. */
  evidenceIds: string[];
  /** Relative time (ms) of the latest update that set `value`. */
  updatedAtMs: number;
}

/**
 * Mutable-truth model of what is known about the prospect so far.
 * Single facts are `null` when not yet confirmed (never invented).
 */
export interface ConversationState {
  stage: ConversationStage;
  interest: InterestLevel;
  pain: StateFact | null;
  impact: StateFact | null;
  authority: StateFact | null;
  budget: StateFact | null;
  timeline: StateFact | null;
  currentSolution: StateFact | null;
  nextObjective: StateFact | null;
  competitors: StateFact[];
  objections: StateFact[];
  buyingSignals: StateFact[];
  /** Monotonic version counter; bumps on every mutation. */
  version: number;
}
