// Simulation domain types.
// Phase 1 ships a deterministic, clearly labeled simulated scenario
// (ABC Roofing). No real audio, no production AI, no Twilio.
//
// The scenario fixture (providers/simulation/*.ts) declares ordered turns with
// structured event hints; the engine (domain/simulation/engine.ts) turns those
// into Zod-validated CallEvents, conversation-state updates, and ONE
// suggestion (or a calm listening state) per the M4 intervention policy.
import type { SuggestionAction } from "@/domain/coaching/types";
import type { ConversationStage } from "@/domain/conversation-state/types";
import type { CallSessionStatus } from "@/domain/sessions/types";
import type { EventType, SpeakerRole } from "@/domain/events/types";
import type { TranscriptSegment } from "@/domain/transcript/types";

/** Structured hint for one sales signal to emit for a turn. The engine fills
 * in `exactEvidence` (verbatim turn text), `segmentId`, `callId`, confidence
 * and importance defaults — application logic never parses arbitrary prose. */
export interface SimulationTurnEventHint {
  type: EventType;
  /** Defaults to the turn's speaker. Rep statements can never confirm
   * prospect facts, so fixture events are prospect/system by default. */
  speaker?: SpeakerRole;
  importance?: number;
  confidence?: number;
  /** Structured metadata: objectionType, facet, dimension, isConcern, ... */
  metadata?: Record<string, unknown>;
}

/** One ordered transcript turn of a deterministic scenario. */
export interface SimulationTurn {
  /** Stable key unique within the scenario (feeds deterministic ids). */
  key: string;
  speaker: SpeakerRole;
  /** Verbatim line the rep/prospect says. */
  text: string;
  /** Milliseconds from call start (non-negative; monotonic per scenario). */
  relativeTimeMs: number;
  confidence?: number;
  isFinal?: boolean;
  /** Structured signals this turn emits (may be empty -> calm listening). */
  events?: SimulationTurnEventHint[];
  /**
   * Deterministic coaching wording. When the intervention policy produces a
   * suggestion for this turn, the engine replaces the policy's generic
   * `text`/`reason` with this scripted wording (action/priority/timing stay
   * policy-driven). Used for e.g. the exact ASK NEXT value question.
   */
  suggestionText?: string;
  suggestionReason?: string;
  /** Optional conversation-stage transition declared by the scenario. */
  stage?: ConversationStage;
}

export interface SimulationScenario {
  id: string; // UUID string
  label: string;
  /** Every Phase 1 scenario record is clearly labeled simulated. */
  simulated: true;
  prospectName: string;
  prospectCompany: string;
  summary: string;
  callObjective: string;
  /** Sales-profile guardrails the policy must respect (e.g. no discounts). */
  guardrails?: string[];
  turns: readonly SimulationTurn[];
}

/** A suggestion as tracked by the engine (history + supersession links). */
export interface SimulationSuggestion {
  id: string;
  action: SuggestionAction;
  text: string;
  reason: string | null;
  priority: number;
  eventId: string | null;
  /** Sim-clock (call-relative) milliseconds. */
  createdAtMs: number;
  expiresAtMs: number;
  displayedAtMs?: number | null;
  dismissedAtMs?: number | null;
  usedAtMs?: number | null;
  feedback?: "useful" | "not_useful" | null;
  /** Id of the suggestion this one superseded (history is never deleted). */
  supersedesId?: string | null;
  /** Id of the suggestion that superseded this one, once that happens. */
  supersededBy?: string | null;
}

/** In-memory state of one simulated call session (bounded, rebuildable). */
export interface SimulationSession {
  callId: string;
  scenarioId: string;
  /** Call lifecycle status (prepared -> live -> processing -> completed). */
  status: CallSessionStatus;
  /** UI pause is a view control; the DB status stays "live" while paused. */
  paused: boolean;
  /** In-flight guard: true between plan creation and finishAdvance(). */
  advanceInFlight: boolean;
  /** Number of scenario turns revealed/persisted so far (the cursor). */
  revealedTurnCount: number;
  conversationState: import("@/domain/conversation-state/types").ConversationState;
  /** Ordered suggestion history for this call (persisted rows mirror it). */
  suggestions: SimulationSuggestion[];
  /** Id of the suggestion currently shown, if any (null = listening). */
  activeSuggestionId: string | null;
  /** Bounded working memory of the most recent transcript segments. */
  recentTranscript: TranscriptSegment[];
  /** Wall-clock ms when the call went live (set exactly once). */
  startedAtMs: number | null;
  /** Wall-clock ms when the call ended. */
  endedAtMs: number | null;
  /** Wall-clock ms of the last successful persistence. */
  lastSavedAtMs: number | null;
}

/** A suggestion the plan wants persisted (all times sim-relative). */
export interface PlannedSuggestion {
  id: string;
  action: SuggestionAction;
  text: string;
  reason: string | null;
  priority: number;
  eventId: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  supersedesId: string | null;
}

export type SuggestionOp =
  | { kind: "none" }
  | { kind: "create"; suggestion: PlannedSuggestion };

/** What one advance produces (the persistence layer executes it in order:
 * segment FIRST, then events, then suggestion, then session state). */
export interface AdvancePlan {
  /** Index of the turn being revealed. */
  cursor: number;
  segment: TranscriptSegment;
  /** Zod-validated structured events derived via the M4 event pipeline. */
  events: import("@/domain/events/types").CallEvent[];
  suggestionOp: SuggestionOp;
  /** Conversation state AFTER applying this turn's events. */
  nextState: import("@/domain/conversation-state/types").ConversationState;
  mode: "suggestion" | "listening";
  /** Policy reason (listening or the chosen suggestion). */
  reason: string | null;
}

export type SimulationErrorCategory =
  | "ADVANCE_IN_FLIGHT"
  | "NOT_LIVE"
  | "END_OF_SCENARIO"
  | "INVALID_STATE"
  | "STALE_CURSOR"
  | "NOT_FOUND";

export interface SimulationError {
  category: SimulationErrorCategory;
  message: string;
}

export type SimulationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SimulationError };
