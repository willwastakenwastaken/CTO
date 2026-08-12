// Coaching domain types.
// Coaching must be evidence-backed from completed call data. Patterns are only
// inferred after at least THREE eligible calls; never fabricate trends.
// Suggestion actions MUST match migrations/001_initial_schema.sql
// (public.suggestion_action).

export const SUGGESTION_ACTIONS = [
  "ASK",
  "SAY",
  "CLARIFY",
  "LISTEN",
  "CLOSE",
  "DO_NOT_PUSH",
] as const;
export type SuggestionAction = (typeof SUGGESTION_ACTIONS)[number];

/** A persisted suggestion row (ai_suggestions). Times are ISO strings. */
export interface Suggestion {
  id: string; // UUID string
  callId?: string;
  eventId?: string | null;
  action: SuggestionAction;
  text: string;
  reason?: string | null;
  priority: number;
  expiresAt?: string | null;
  displayedAt?: string | null;
  dismissedAt?: string | null;
  usedAt?: string | null;
  feedback?: "useful" | "not_useful" | null;
  createdAt?: string | null;
}

/**
 * In-memory suggestion shape for the intervention policy. Times are
 * milliseconds (epoch or call-relative — policy only compares them).
 */
export interface SuggestionInput {
  id: string;
  action: SuggestionAction;
  text: string;
  reason?: string | null;
  priority: number;
  createdAtMs: number;
  expiresAtMs?: number | null;
  displayedAtMs?: number | null;
  dismissedAtMs?: number | null;
  usedAtMs?: number | null;
}

/** A suggestion the policy wants to surface (not yet persisted). */
export interface SuggestionDraft {
  action: SuggestionAction;
  text: string;
  reason: string | null;
  priority: number;
  /** Event UUID that triggered this suggestion. */
  eventId: string;
  expiresAtMs: number | null;
  /** Set when this draft supersedes an active suggestion (history kept). */
  supersedesId?: string | null;
}

export const COACHING_OBSERVATION_KINDS = ["strength", "improvement"] as const;
export type CoachingObservationKind = (typeof COACHING_OBSERVATION_KINDS)[number];

export interface CoachingEvidenceRef {
  eventId: string;
  segmentId?: string;
  quote: string;
  relativeTimeMs: number;
}

/** One concrete, evidence-backed rep-coaching observation. */
export interface CoachingObservation {
  kind: CoachingObservationKind;
  area: string;
  observation: string;
  evidence: CoachingEvidenceRef[];
}
