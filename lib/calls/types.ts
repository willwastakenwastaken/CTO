// Persistence row shapes for the simulation engine — column names MUST match
// migrations/001_initial_schema.sql (and 003 for superseded_by). All
// server-side; user_id is derived from the session and never browser-supplied.
import type { SpeakerRole, EventType, EventCategory } from "@/domain/events/types";
import type { SuggestionAction } from "@/domain/coaching/types";

export interface CallSessionRow {
  id: string;
  user_id: string;
  prospect_id: string | null;
  sales_profile_id: string | null;
  mode: string | null;
  scenario: string | null;
  is_simulated: boolean;
  status: string;
  objective: string | null;
  timing: string | null;
  started_at: string | null;
  duration_seconds: number | null;
  outcome: string | null;
  opportunity_fit_score: number | null;
  opportunity_fit_label: string | null;
  opportunity_fit_explanation: string | null;
  purchase_intent_score: number | null;
  purchase_intent_label: string | null;
  purchase_intent_explanation: string | null;
  evidence: unknown;
  summary: string | null;
  next_action: string | null;
  pipeline_recommendation: string | null;
  pipeline_recommendation_reason: string | null;
  conversation_state: unknown;
  review_payload: unknown;
  error: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TranscriptSegmentRow {
  id: string;
  user_id: string;
  call_id: string;
  sequence: number;
  speaker: SpeakerRole;
  text: string;
  relative_time_ms: number;
  confidence: number;
  is_final: boolean;
  created_at?: string | null;
}

export interface CallEventRow {
  id: string;
  user_id: string;
  call_id: string;
  segment_id: string | null;
  type: EventType;
  category: EventCategory;
  confidence: number;
  speaker: SpeakerRole;
  exact_evidence: string;
  importance: number;
  relative_time_ms: number;
  metadata: unknown;
  created_at?: string | null;
}

export interface AiSuggestionRow {
  id: string;
  user_id: string;
  call_id: string;
  event_id: string | null;
  action: SuggestionAction;
  text: string;
  reason: string | null;
  priority: number;
  expires_at: string | null;
  displayed_at: string | null;
  dismissed_at: string | null;
  used_at: string | null;
  feedback: "useful" | "not_useful" | null;
  superseded_by: string | null;
  created_at?: string | null;
}

/** Stable error category for persistence failures (recoverable + safe). */
export class PersistenceError extends Error {
  readonly category = "PERSISTENCE_FAILED" as const;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PersistenceError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** Stable error category for service-level control failures. */
export class CallServiceError extends Error {
  readonly category:
    | "NOT_FOUND"
    | "STALE_CURSOR"
    | "INVALID_STATE"
    | "ADVANCE_IN_FLIGHT"
    | "END_OF_SCENARIO"
    | "NOT_LIVE";
  constructor(
    category: CallServiceError["category"],
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "CallServiceError";
    this.category = category;
  }
}
