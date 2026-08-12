// Simulation engine — deterministic, pure, unit-testable.
//
// Turns an ordered scenario (providers/simulation/*.ts) into persisted
// transcript segments, Zod-validated events (M4 pipeline), conversation-state
// updates (M4 rules: corrections outrank, rep statements can't confirm
// prospect facts, missing evidence never erases), and ONE suggestion (or a
// calm listening state) via the M4 intervention policy.
//
// Contract highlights:
//  * start sets started_at exactly once (idempotent re-start).
//  * advance returns an ordered PLAN (segment -> events -> suggestion ->
//    state) that the persistence layer executes with the segment FIRST.
//    Segment/event/suggestion ids are deterministic (uuidFromParts), so a
//    replayed advance regenerates identical rows and upserts no-op.
//  * advance is guarded against double-advance (advanceInFlight is only
//    cleared by finishAdvance — no hidden timers in domain logic; the UI
//    drives one advance/tick at a time).
//  * pause/resume are view controls (DB status stays "live" while paused);
//    end/cancel use the M4 session state machine; restart is a deliberate
//    reset action that requires a NEW call id (old history is preserved).
//  * suggestions expire (expiresAtMs) or are superseded (supersedesId /
//    supersededBy) WITHOUT deleting history.
import {
  SUGGESTION_TTL_MS,
  evaluateIntervention,
} from "@/domain/coaching/intervention-policy";
import type { SuggestionDraft, SuggestionInput } from "@/domain/coaching/types";
import { applyEvents, createConversationState, setStage } from "@/domain/conversation-state/state";
import type { ConversationState } from "@/domain/conversation-state/types";
import { DEFAULT_EVENT_CATEGORY, EVENT_IMPORTANCE_HINT } from "@/domain/events/taxonomy";
import type { CallEvent } from "@/domain/events/types";
import { CallEventSchema } from "@/domain/schemas/call-event";
import { applyTransition } from "@/domain/sessions/state-machine";
import type { TranscriptSegment } from "@/domain/transcript/types";
import { uuidFromParts } from "@/domain/utils/uuid";
import type {
  AdvancePlan,
  PlannedSuggestion,
  SimulationError,
  SimulationResult,
  SimulationScenario,
  SimulationSession,
  SimulationSuggestion,
  SimulationTurn,
} from "@/domain/simulation/types";

/** Bounded working memory of recent transcript segments kept in the session. */
export const RECENT_TRANSCRIPT_WINDOW = 10;

export function createSimulationSession(input: {
  callId: string;
  scenarioId: string;
}): SimulationSession {
  return {
    callId: input.callId,
    scenarioId: input.scenarioId,
    status: "prepared",
    paused: false,
    advanceInFlight: false,
    revealedTurnCount: 0,
    conversationState: createConversationState(),
    suggestions: [],
    activeSuggestionId: null,
    recentTranscript: [],
    startedAtMs: null,
    endedAtMs: null,
    lastSavedAtMs: null,
  };
}

function error(category: SimulationError["category"], message: string): SimulationError {
  return { category, message };
}

function suggestionInput(s: SimulationSuggestion): SuggestionInput {
  return {
    id: s.id,
    action: s.action,
    text: s.text,
    reason: s.reason,
    priority: s.priority,
    createdAtMs: s.createdAtMs,
    expiresAtMs: s.expiresAtMs,
    displayedAtMs: s.displayedAtMs ?? null,
    dismissedAtMs: s.dismissedAtMs ?? null,
    usedAtMs: s.usedAtMs ?? null,
  };
}

/** Replaces a suggestion in the history list (same id) or appends it. */
function upsertSuggestion(
  suggestions: SimulationSuggestion[],
  suggestion: SimulationSuggestion
): SimulationSuggestion[] {
  const existing = suggestions.some((s) => s.id === suggestion.id);
  if (!existing) return [...suggestions, suggestion];
  return suggestions.map((s) => (s.id === suggestion.id ? suggestion : s));
}

/**
 * Starts the call: prepared -> live. started_at (startedAtMs) is set exactly
 * once; re-starting an already-live call is an idempotent no-op.
 */
export function startSimulation(
  session: SimulationSession,
  nowMs: number
): SimulationResult<{ session: SimulationSession; startedAtSet: boolean }> {
  if (session.advanceInFlight) {
    return { ok: false, error: error("ADVANCE_IN_FLIGHT", "Complete the in-flight advance before starting.") };
  }
  const transition = applyTransition({
    currentStatus: session.status,
    targetStatus: "live",
    startedAt: session.startedAtMs !== null ? new Date(session.startedAtMs).toISOString() : null,
    now: new Date(nowMs).toISOString(),
  });
  if (!transition.ok) {
    return {
      ok: false,
      error: error(
        "INVALID_STATE",
        `Cannot start a call in status "${session.status}". ${transition.error.message}`
      ),
    };
  }
  return {
    ok: true,
    value: {
      session: {
        ...session,
        status: "live",
        startedAtMs: transition.startedAtSet ? nowMs : session.startedAtMs,
        paused: false,
      },
      startedAtSet: transition.startedAtSet,
    },
  };
}

/** Marks a started call as paused (view control; DB status stays "live"). */
export function pauseSimulation(session: SimulationSession): SimulationResult<SimulationSession> {
  if (session.status !== "live") {
    return { ok: false, error: error("NOT_LIVE", `Cannot pause a call in status "${session.status}".`) };
  }
  if (session.paused) {
    return { ok: false, error: error("INVALID_STATE", "Call is already paused.") };
  }
  if (session.advanceInFlight) {
    return { ok: false, error: error("ADVANCE_IN_FLIGHT", "Complete the in-flight advance before pausing.") };
  }
  return { ok: true, value: { ...session, paused: true } };
}

/** Resumes a paused call. */
export function resumeSimulation(session: SimulationSession): SimulationResult<SimulationSession> {
  if (session.status !== "live") {
    return { ok: false, error: error("NOT_LIVE", `Cannot resume a call in status "${session.status}".`) };
  }
  if (!session.paused) {
    return { ok: false, error: error("INVALID_STATE", "Call is not paused.") };
  }
  return { ok: true, value: { ...session, paused: false } };
}

function buildSegment(
  callId: string,
  turn: SimulationTurn,
  sequence: number
): TranscriptSegment {
  return {
    id: uuidFromParts(callId, "segment", turn.key),
    callId,
    sequence,
    speaker: turn.speaker,
    text: turn.text,
    relativeTimeMs: turn.relativeTimeMs,
    confidence: turn.confidence ?? 0.95,
    isFinal: turn.isFinal ?? true,
  };
}

function buildEvents(callId: string, turn: SimulationTurn, segmentId: string): CallEvent[] {
  const hints = turn.events ?? [];
  return hints.map((hint, index) => {
    const draft = {
      id: uuidFromParts(callId, "event", turn.key, String(index)),
      callId,
      segmentId,
      type: hint.type,
      category: DEFAULT_EVENT_CATEGORY[hint.type],
      confidence: hint.confidence ?? 0.9,
      speaker: hint.speaker ?? turn.speaker,
      exactEvidence: turn.text,
      importance: hint.importance ?? EVENT_IMPORTANCE_HINT[hint.type],
      relativeTimeMs: turn.relativeTimeMs,
      metadata: hint.metadata ?? {},
    };
    return CallEventSchema.parse(draft); // Zod-validated output
  });
}

function materializeSuggestion(
  draft: SuggestionDraft,
  session: SimulationSession,
  eventId: string,
  turn: SimulationTurn,
  nowMs: number
): PlannedSuggestion {
  const text = turn.suggestionText !== undefined ? turn.suggestionText : draft.text;
  const reason = turn.suggestionReason !== undefined ? turn.suggestionReason : draft.reason;
  const expiresAtMs = nowMs + (draft.expiresAtMs ?? SUGGESTION_TTL_MS);
  return {
    id: uuidFromParts(session.callId, "suggestion", eventId),
    action: draft.action,
    text,
    reason,
    priority: draft.priority,
    eventId,
    createdAtMs: nowMs,
    expiresAtMs,
    supersedesId: draft.supersedesId ?? null,
  };
}

/**
 * Advances the simulation by ONE ordered turn. Returns the plan the
 * persistence layer executes (segment FIRST, then events, then suggestion,
 * then state) plus the in-flight session. Replaying the same advance
 * regenerates identical deterministic ids, so persistence upserts no-op.
 *
 * The policy's clock is the scenario's sim clock (call-relative ms), which
 * makes every advance deterministic and unit-testable.
 */
export function advanceSimulation(
  session: SimulationSession,
  scenario: SimulationScenario,
  nowMs?: number
): SimulationResult<{ session: SimulationSession; plan: AdvancePlan }> {
  if (session.advanceInFlight) {
    return {
      ok: false,
      error: error(
        "ADVANCE_IN_FLIGHT",
        "An advance is already in flight — finish it before advancing again (no double advancement)."
      ),
    };
  }
  if (session.status !== "live") {
    return {
      ok: false,
      error: error("NOT_LIVE", `Cannot advance a call in status "${session.status}".`),
    };
  }
  if (session.paused) {
    return { ok: false, error: error("NOT_LIVE", "Call is paused — resume before advancing.") };
  }

  const cursor = session.revealedTurnCount;
  const turn = scenario.turns[cursor];
  if (!turn) {
    return {
      ok: false,
      error: error(
        "END_OF_SCENARIO",
        `Scenario "${scenario.id}" has no turn at cursor ${cursor}. End the call instead of advancing.`
      ),
    };
  }

  const simNowMs = nowMs ?? turn.relativeTimeMs;
  const segment = buildSegment(session.callId, turn, cursor);
  const events = buildEvents(session.callId, turn, segment.id);

  // M4 pipeline: apply events to conversation state (evidence ids attached).
  let nextState: ConversationState = applyEvents(session.conversationState, events);
  if (turn.stage && turn.stage !== nextState.stage) {
    nextState = setStage(nextState, turn.stage);
  }

  const recentTranscript = [...session.recentTranscript, segment].slice(-RECENT_TRANSCRIPT_WINDOW);

  // M4 intervention policy: one suggestion (or calm listening).
  let runningSuggestions = session.suggestions;
  let runningActiveId = session.activeSuggestionId;
  let lastPlanned: PlannedSuggestion | null = null;
  let mode: "suggestion" | "listening" = "listening";
  let reason: string | null = null;

  for (const event of events) {
    const active = runningActiveId
      ? (runningSuggestions.find((s) => s.id === runningActiveId) ?? null)
      : null;
    const decision = evaluateIntervention({
      event,
      state: nextState,
      recentTranscript,
      currentSuggestion: active ? suggestionInput(active) : null,
      previousSuggestions: runningSuggestions.map(suggestionInput),
      callObjective: scenario.callObjective,
      guardrails: scenario.guardrails ?? [],
      nowMs: simNowMs,
    });
    if (decision.suggestion) {
      const planned = materializeSuggestion(decision.suggestion, session, event.id, turn, simNowMs);
      const record: SimulationSuggestion = {
        id: planned.id,
        action: planned.action,
        text: planned.text,
        reason: planned.reason,
        priority: planned.priority,
        eventId: planned.eventId,
        createdAtMs: planned.createdAtMs,
        expiresAtMs: planned.expiresAtMs,
        supersedesId: planned.supersedesId,
        supersededBy: null,
      };
      let nextList = upsertSuggestion(runningSuggestions, record);
      // Mark the superseded suggestion (history kept, never deleted).
      if (planned.supersedesId) {
        nextList = nextList.map((s) =>
          s.id === planned.supersedesId ? { ...s, supersededBy: planned.id } : s
        );
      }
      runningSuggestions = nextList;
      runningActiveId = planned.id;
      lastPlanned = planned;
      mode = "suggestion";
      reason = decision.reason;
    }
  }

  const plan: AdvancePlan = {
    cursor,
    segment,
    events,
    suggestionOp: lastPlanned ? { kind: "create", suggestion: lastPlanned } : { kind: "none" },
    nextState,
    mode,
    reason,
  };

  const nextSession: SimulationSession = {
    ...session,
    revealedTurnCount: cursor + 1,
    conversationState: nextState,
    suggestions: runningSuggestions,
    activeSuggestionId: runningActiveId,
    recentTranscript,
    advanceInFlight: true,
  };

  return { ok: true, value: { session: nextSession, plan } };
}

/** Clears the in-flight guard after the plan was persisted. Idempotent. */
export function finishAdvance(session: SimulationSession, savedAtMs: number): SimulationSession {
  if (!session.advanceInFlight) return session;
  return { ...session, advanceInFlight: false, lastSavedAtMs: savedAtMs };
}

/**
 * Ends the call: live -> processing (review generation happens in the
 * persistence layer, then processing -> completed). Idempotent when already
 * processing. endedAtMs is set exactly once.
 */
export function endSimulation(
  session: SimulationSession,
  nowMs: number
): SimulationResult<SimulationSession> {
  if (session.advanceInFlight) {
    return {
      ok: false,
      error: error("ADVANCE_IN_FLIGHT", "Complete the in-flight advance before ending the call."),
    };
  }
  const transition = applyTransition({
    currentStatus: session.status,
    targetStatus: "processing",
    now: new Date(nowMs).toISOString(),
  });
  if (!transition.ok) {
    return {
      ok: false,
      error: error("INVALID_STATE", `Cannot end a call in status "${session.status}".`),
    };
  }
  return {
    ok: true,
    value: {
      ...session,
      status: "processing",
      paused: false,
      endedAtMs: session.endedAtMs ?? nowMs,
    },
  };
}

/** processing -> completed (idempotent re-apply allowed for review retry). */
export function completeSimulation(
  session: SimulationSession,
  nowMs: number
): SimulationResult<SimulationSession> {
  const transition = applyTransition({
    currentStatus: session.status,
    targetStatus: "completed",
    now: new Date(nowMs).toISOString(),
  });
  if (!transition.ok) {
    return {
      ok: false,
      error: error("INVALID_STATE", `Cannot complete a call in status "${session.status}".`),
    };
  }
  return {
    ok: true,
    value: {
      ...session,
      status: "completed",
      paused: false,
      endedAtMs: session.endedAtMs ?? nowMs,
    },
  };
}

/** Cancels a prepared or live call (prepared/live -> cancelled). */
export function cancelSimulation(
  session: SimulationSession,
  nowMs: number
): SimulationResult<SimulationSession> {
  const transition = applyTransition({
    currentStatus: session.status,
    targetStatus: "cancelled",
    now: new Date(nowMs).toISOString(),
  });
  if (!transition.ok) {
    return {
      ok: false,
      error: error("INVALID_STATE", `Cannot cancel a call in status "${session.status}".`),
    };
  }
  return {
    ok: true,
    value: { ...session, status: "cancelled", paused: false, endedAtMs: session.endedAtMs ?? nowMs },
  };
}

/**
 * Deliberate restart: returns a fresh prepared session for the same scenario
 * under a NEW call id. The old call's rows are left untouched (history is
 * preserved); the caller must mint the new call id and create a fresh
 * call_sessions row. Reset never happens implicitly.
 */
export function resetSimulation(
  session: SimulationSession,
  newCallId: string
): SimulationSession {
  return createSimulationSession({ callId: newCallId, scenarioId: session.scenarioId });
}

/**
 * Records recommendation feedback. "useful"/"not_useful" set usedAtMs +
 * feedback; "dismiss" sets dismissedAtMs and is NOT negative feedback.
 * Idempotent for the same action.
 */
export function applySuggestionFeedback(
  session: SimulationSession,
  suggestionId: string,
  action: "useful" | "not_useful" | "dismiss",
  nowMs: number
): SimulationResult<SimulationSession> {
  const existing = session.suggestions.find((s) => s.id === suggestionId);
  if (!existing) {
    return { ok: false, error: error("NOT_FOUND", `No suggestion "${suggestionId}" on this call.`) };
  }
  let next: SimulationSuggestion;
  if (action === "dismiss") {
    next = { ...existing, dismissedAtMs: existing.dismissedAtMs ?? nowMs };
  } else {
    next = {
      ...existing,
      usedAtMs: existing.usedAtMs ?? nowMs,
      feedback: action,
    };
  }
  return {
    ok: true,
    value: {
      ...session,
      suggestions: upsertSuggestion(session.suggestions, next),
      activeSuggestionId:
        session.activeSuggestionId === suggestionId ? null : session.activeSuggestionId,
    },
  };
}
