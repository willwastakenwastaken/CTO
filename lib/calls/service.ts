// Simulation call service — server-side orchestration of the M5 simulation
// engine + Supabase persistence.
//
// Every function derives rows from a `userId` supplied by the caller, which
// MUST come from the server session (lib/auth/session.ts) — never from the
// browser. RLS (migrations/002) independently enforces ownership.
//
// Idempotency model:
//  * Segment/event/suggestion ids are deterministic (uuidFromParts), so every
//    write is an idempotent upsert (onConflict: "id", ignoreDuplicates) —
//    replaying an advance regenerates identical rows and writes no-ops.
//  * advanceCall compares the client's cursor against the authoritative
//    segment count: a stale client is reconciled (no writes); an interrupted
//    write (segment persisted but its events never were) is repaired by
//    re-running the advance; a client ahead of the DB is rejected
//    (STALE_CURSOR).
//  * Conversation state is re-derived from persisted events on every rebuild
//    (deterministic), so row.cached conversation_state is just a cache.
import { randomUUID } from "node:crypto";
import { applyEvents, createConversationState, toJson } from "@/domain/conversation-state/state";
import type { ConversationState } from "@/domain/conversation-state/types";
import type { CallEvent } from "@/domain/events/types";
import { buildReview, type ReviewPayload, type ReviewSuggestion } from "@/domain/review/build-review";
import * as sim from "@/domain/simulation/engine";
import {
  reconcileLiveSnapshot,
  snapshotFor,
  type LiveSessionSnapshot,
} from "@/domain/simulation/snapshot";
import type {
  AdvancePlan,
  PlannedSuggestion,
  SimulationScenario,
  SimulationSession,
  SimulationSuggestion,
} from "@/domain/simulation/types";
import { getScenario } from "@/providers/simulation/registry";
import { uuidFromParts } from "@/domain/utils/uuid";
import { humanizeStage } from "@/domain/utils/format";
import type { CallStore } from "@/lib/calls/store";
import { CallServiceError } from "@/lib/calls/types";
import {
  buildWorkspace,
  type LiveWorkspace,
} from "@/lib/calls/workspace";
import { applyStageTransition } from "@/domain/pipeline/rules";
import type { PipelineStage } from "@/domain/pipeline/types";
import type { StoredReviewPayload } from "@/domain/schemas/review";
import type {
  ActivityRow,
  AiSuggestionRow,
  CallEventRow,
  CallSessionRow,
  ProductEventRow,
  ProspectNoteRow,
  TranscriptSegmentRow,
} from "@/lib/calls/types";

export interface SimulationServiceOptions {
  store: CallStore;
  /** Server-derived session user id — never browser-supplied. */
  userId: string;
}

export type FeedbackAction = "useful" | "not_useful" | "dismiss";

export interface AdvanceOutcome {
  snapshot: LiveSessionSnapshot;
  /** True when the turn was advanced (persisted); false when reconciled. */
  advanced: boolean;
  /** True when an interrupted advance was repaired. */
  repaired: boolean;
}

export interface EndOutcome {
  callId: string;
  review: ReviewPayload;
  snapshot: null;
}

/** Refusal reasons for finalizeReview (the review page renders these calmly). */
export type FinalizeRefusal =
  | { category: "NO_REVIEW"; message: string }
  | { category: "INVALID_STATE"; message: string };

export type FinalizeReviewOutcome =
  | {
      ok: true;
      callId: string;
      /** The persisted review payload (includes preCallStage). */
      review: StoredReviewPayload;
      /** True when this run generated + persisted the review. */
      created: boolean;
      durationSeconds: number | null;
    }
  | { ok: false; error: FinalizeRefusal };

export type ApplyRecommendationOutcome =
  | {
      ok: true;
      prospectId: string;
      fromStage: string;
      toStage: string;
      /** False when the prospect was already at the recommended stage. */
      applied: boolean;
      /** True when this run actually changed the stage (false = no-op). */
      changed: boolean;
    }
  | {
      ok: false;
      error:
        | { category: "NO_REVIEW"; message: string }
        | { category: "NO_PROSPECT"; message: string }
        | { category: "STALE_STAGE"; message: string; currentStage: string; expectedStage: string }
        | { category: "PIPELINE"; message: string };
    };

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

function rowToEvent(row: CallEventRow): CallEvent {
  return {
    id: row.id,
    callId: row.call_id,
    segmentId: row.segment_id,
    type: row.type,
    category: row.category,
    confidence: row.confidence,
    speaker: row.speaker,
    exactEvidence: row.exact_evidence,
    importance: row.importance,
    relativeTimeMs: row.relative_time_ms,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

/** Events in reveal order: by their segment's sequence, then relative time. */
function orderEventsBySegment(
  events: readonly CallEventRow[],
  segments: readonly TranscriptSegmentRow[]
): CallEventRow[] {
  const seqBySegment = new Map<string, number>();
  segments.forEach((s) => seqBySegment.set(s.id, s.sequence));
  return [...events].sort((a, b) => {
    const sa = a.segment_id ? seqBySegment.get(a.segment_id) : undefined;
    const sb = b.segment_id ? seqBySegment.get(b.segment_id) : undefined;
    const oa = sa ?? Number.MAX_SAFE_INTEGER;
    const ob = sb ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.relative_time_ms - b.relative_time_ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** Deterministic state rebuild: replay every persisted event from scratch. */
function deriveState(
  events: readonly CallEventRow[],
  segments: readonly TranscriptSegmentRow[]
): ConversationState {
  const ordered = orderEventsBySegment(events, segments);
  let state = createConversationState();
  for (const row of ordered) {
    state = applyEvents(state, [rowToEvent(row)]);
  }
  return state;
}

function suggestionRowsToSim(
  rows: readonly AiSuggestionRow[],
  startedAtMs: number | null
): SimulationSuggestion[] {
  const base = startedAtMs ?? 0;
  const records: SimulationSuggestion[] = rows.map((r) => ({
    id: r.id,
    action: r.action,
    text: r.text,
    reason: r.reason,
    priority: r.priority,
    eventId: r.event_id,
    createdAtMs: r.created_at ? Math.max(0, Date.parse(r.created_at) - base) : 0,
    expiresAtMs: r.expires_at ? Date.parse(r.expires_at) - base : Number.MAX_SAFE_INTEGER,
    displayedAtMs: r.displayed_at ? Date.parse(r.displayed_at) - base : null,
    dismissedAtMs: r.dismissed_at ? Date.parse(r.dismissed_at) - base : null,
    usedAtMs: r.used_at ? Date.parse(r.used_at) - base : null,
    feedback: r.feedback,
    supersedesId: null,
    supersededBy: r.superseded_by,
  }));
  // Reconstruct the supersede links (stored as superseded_by on the old row).
  for (const r of rows) {
    if (r.superseded_by) {
      const older = records.find((s) => s.id === r.id);
      const newer = records.find((s) => s.id === r.superseded_by);
      if (older && newer) newer.supersedesId = older.id;
    }
  }
  return records;
}

function computeActiveSuggestion(
  suggestions: readonly SimulationSuggestion[],
  nowSimMs: number
): string | null {
  let active: SimulationSuggestion | null = null;
  for (const s of suggestions) {
    if (s.dismissedAtMs != null || s.usedAtMs != null) continue;
    if (s.expiresAtMs <= nowSimMs) continue;
    if (!active || s.createdAtMs > active.createdAtMs) active = s;
  }
  return active ? active.id : null;
}

function rebuildSession(
  row: CallSessionRow,
  segments: readonly TranscriptSegmentRow[],
  events: readonly CallEventRow[],
  suggestionRows: readonly AiSuggestionRow[],
  scenario: SimulationScenario,
  revealedTurnCount?: number
): SimulationSession {
  const startedAtMs = row.started_at ? Date.parse(row.started_at) : null;
  const revealed = revealedTurnCount ?? segments.length;
  const nowSimMs = segments.length > 0 ? segments[segments.length - 1].relative_time_ms : 0;
  const suggestions = suggestionRowsToSim(suggestionRows, startedAtMs);
  const recent = segments
    .slice(-sim.RECENT_TRANSCRIPT_WINDOW)
    .map((s) => ({
      id: s.id,
      callId: s.call_id,
      sequence: s.sequence,
      speaker: s.speaker,
      text: s.text,
      relativeTimeMs: s.relative_time_ms,
      confidence: s.confidence,
      isFinal: s.is_final,
    }));
  return {
    callId: row.id,
    scenarioId: scenario.id,
    status: row.status as SimulationSession["status"],
    paused: false,
    advanceInFlight: false,
    revealedTurnCount: revealed,
    conversationState: deriveState(events, segments),
    suggestions,
    activeSuggestionId: computeActiveSuggestion(suggestions, nowSimMs),
    recentTranscript: recent,
    startedAtMs,
    endedAtMs: null,
    lastSavedAtMs: row.updated_at ? Date.parse(row.updated_at) : null,
  };
}

function toSegmentRow(
  segment: import("@/domain/transcript/types").TranscriptSegment,
  userId: string
): TranscriptSegmentRow {
  return {
    id: segment.id,
    user_id: userId,
    call_id: segment.callId as string,
    sequence: segment.sequence,
    speaker: segment.speaker,
    text: segment.text,
    relative_time_ms: segment.relativeTimeMs,
    confidence: segment.confidence,
    is_final: segment.isFinal,
  };
}

function toEventRow(event: CallEvent, userId: string): CallEventRow {
  return {
    id: event.id,
    user_id: userId,
    call_id: event.callId as string,
    segment_id: event.segmentId ?? null,
    type: event.type,
    category: event.category,
    confidence: event.confidence,
    speaker: event.speaker,
    exact_evidence: event.exactEvidence,
    importance: event.importance,
    relative_time_ms: event.relativeTimeMs,
    metadata: event.metadata ?? {},
  };
}

function toSuggestionRow(
  planned: PlannedSuggestion,
  userId: string,
  row: CallSessionRow
): AiSuggestionRow {
  const base = row.started_at ? Date.parse(row.started_at) : 0;
  return {
    id: planned.id,
    user_id: userId,
    call_id: row.id,
    event_id: planned.eventId,
    action: planned.action,
    text: planned.text,
    reason: planned.reason,
    priority: planned.priority,
    expires_at: new Date(base + planned.expiresAtMs).toISOString(),
    displayed_at: null,
    dismissed_at: null,
    used_at: null,
    feedback: null,
    superseded_by: null,
    created_at: new Date(base + planned.createdAtMs).toISOString(),
  };
}

function toReviewSuggestions(rows: readonly AiSuggestionRow[]): ReviewSuggestion[] {
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    text: r.text,
    reason: r.reason,
    priority: r.priority,
    createdAtMs: r.created_at ? Date.parse(r.created_at) : 0,
    expiresAtMs: r.expires_at ? Date.parse(r.expires_at) : null,
    usedAtMs: r.used_at ? Date.parse(r.used_at) : null,
    dismissedAtMs: r.dismissed_at ? Date.parse(r.dismissed_at) : null,
    feedback: r.feedback,
    eventId: r.event_id,
  }));
}

function mapEngineError(err: { category: string; message: string }): never {
  const category = err.category as CallServiceError["category"];
  throw new CallServiceError(category, err.message);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** One call summary note per call (deterministic id -> idempotent upsert). */
function buildCallSummaryNote(
  callId: string,
  row: CallSessionRow,
  stored: StoredReviewPayload,
  scenario: SimulationScenario
): ProspectNoteRow {
  return {
    id: uuidFromParts(callId, "note", "call_summary"),
    user_id: row.user_id,
    prospect_id: row.prospect_id ?? "",
    call_id: callId,
    type: "call_summary",
    title: `Call summary — ${scenario.prospectCompany} practice`,
    body: stored.summary,
    structured_content: {
      situation: scenario.summary,
      pain: stored.facts.pain,
      impact: stored.facts.impact,
      decisionProcess: stored.facts.decisionProcess,
      timing: stored.facts.timing,
      objections: stored.objections.map((o) => o.quote),
      nextStep: stored.nextAction,
      evidence: {
        positives: stored.purchaseIntent.positives,
        risks: stored.purchaseIntent.risks,
        unknowns: stored.purchaseIntent.unknowns,
        buyingSignals: stored.buyingSignals.map((b) => b.quote),
      },
      purchaseIntent: {
        score: stored.purchaseIntent.score,
        label: stored.purchaseIntent.label,
        evidenceCompleteness: stored.purchaseIntent.evidenceCompleteness,
        scoringVersion: stored.purchaseIntent.scoringVersion,
      },
      pipelineRecommendation: stored.pipelineRecommendation,
    },
  };
}

function buildCallCompletedActivity(
  callId: string,
  row: CallSessionRow,
  stored: StoredReviewPayload,
  nowMs: number
): ActivityRow {
  const target = stored.pipelineRecommendation.targetStage;
  const summary = stored.preCallStage
    ? `Practice call completed — ${humanizeStage(stored.preCallStage)} → ${humanizeStage(target)} recommended`
    : `Practice call completed — ${humanizeStage(target)} recommended`;
  return {
    id: uuidFromParts(callId, "activity", "call_completed"),
    user_id: row.user_id,
    prospect_id: row.prospect_id,
    call_id: callId,
    type: "call_completed",
    summary,
    metadata: {
      callId,
      mode: "practice",
      simulated: true,
      outcome: stored.outcome,
      durationSeconds: row.duration_seconds,
      purchaseIntent: {
        score: stored.purchaseIntent.score,
        label: stored.purchaseIntent.label,
        evidenceCompleteness: stored.purchaseIntent.evidenceCompleteness,
      },
      pipelineRecommendation: target,
      preCallStage: stored.preCallStage,
    },
    occurred_at: iso(nowMs),
  };
}

function buildReviewCreatedEvent(
  callId: string,
  row: CallSessionRow,
  stored: StoredReviewPayload,
  nowMs: number
): ProductEventRow {
  return {
    id: uuidFromParts(callId, "product_event", "review_created"),
    user_id: row.user_id,
    session_id: callId,
    type: "review_created",
    summary: `Call review created — ${humanizeStage(stored.pipelineRecommendation.targetStage)} recommended.`,
    metadata: {
      callId,
      recommendation: stored.pipelineRecommendation.targetStage,
      pipelineReason: stored.pipelineRecommendation.reason,
      preCallStage: stored.preCallStage,
      outcome: stored.outcome,
      purchaseIntent: {
        score: stored.purchaseIntent.score,
        label: stored.purchaseIntent.label,
        evidenceCompleteness: stored.purchaseIntent.evidenceCompleteness,
      },
    },
    occurred_at: iso(nowMs),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createSimulationService({ store, userId }: SimulationServiceOptions) {
  async function loadCall(callId: string): Promise<{
    row: CallSessionRow;
    segments: TranscriptSegmentRow[];
    events: CallEventRow[];
    suggestions: AiSuggestionRow[];
  }> {
    const row = await store.getSession(callId);
    if (!row || row.user_id !== userId) {
      throw new CallServiceError("NOT_FOUND", `Call session "${callId}" not found for this user.`);
    }
    const [segments, events, suggestions] = await Promise.all([
      store.listSegments(callId),
      store.listEvents(callId),
      store.listSuggestions(callId),
    ]);
    return { row, segments, events, suggestions };
  }

  /** Shared write sequence for one advance. Segment FIRST, then events, then
   * suggestion, then session state (spec: persist the next ordered segment
   * BEFORE deriving events and state). */
  async function persistPlan(
    row: CallSessionRow,
    plan: AdvancePlan,
    inFlightSession: SimulationSession,
    nowMs: number
  ): Promise<LiveSessionSnapshot> {
    await store.upsertSegment(toSegmentRow(plan.segment, userId));
    await store.upsertEvents(plan.events.map((e) => toEventRow(e, userId)));
    if (plan.suggestionOp.kind === "create") {
      const planned = plan.suggestionOp.suggestion;
      await store.upsertSuggestion(toSuggestionRow(planned, userId, row));
      if (planned.supersedesId) {
        await store.markSuggestionSuperseded(planned.supersedesId, planned.id);
      }
    }
    await store.updateSession(row.id, { conversation_state: toJson(plan.nextState) });
    return snapshotFor(sim.finishAdvance(inFlightSession, nowMs)) as LiveSessionSnapshot;
  }

  /**
   * Creates the M7 lifecycle effects exactly once per call: one structured
   * call-summary note, one call_completed activity, one review_created
   * product event. Every row id is deterministic (uuidFromParts) so even a
   * concurrent double-finalize cannot duplicate; re-running when rows exist
   * is a read-only no-op (the review retry path must not re-write).
   */
  async function persistReviewEffects(
    callId: string,
    row: CallSessionRow,
    stored: StoredReviewPayload,
    scenario: SimulationScenario,
    nowMs: number
  ): Promise<void> {
    if (row.prospect_id) {
      const existingNote = await store.getNoteByCallAndType(callId, "call_summary");
      if (!existingNote) {
        await store.upsertNote(buildCallSummaryNote(callId, row, stored, scenario));
      }
    }
    const existingActivity = await store.getActivityByCallAndType(callId, "call_completed");
    if (!existingActivity) {
      await store.upsertActivity(buildCallCompletedActivity(callId, row, stored, nowMs));
    }
    const existingEvent = await store.getProductEventBySessionAndType(callId, "review_created");
    if (!existingEvent) {
      await store.upsertProductEvent(buildReviewCreatedEvent(callId, row, stored, nowMs));
    }
  }

  /** Loads the prospect stage at review time (the stage Apply would move from). */
  async function capturePreCallStage(prospectId: string | null): Promise<string | null> {
    if (!prospectId) return null;
    const prospect = await store.getProspectRecord(prospectId);
    if (!prospect || prospect.user_id !== userId) return null;
    return prospect.stage;
  }

  /**
   * Idempotent "finalize review" operation — the AFTER-the-call loop:
   *   live -> processing -> completed, or processing -> completed (never
   *   downgrades a completed call). Persists the evidence-based review onto
   *   the session, then creates exactly one call-summary note, one
   *   call_completed activity, and one review_created product event.
   *   Re-running on a completed call re-fetches the saved payload without
   *   regenerating or re-writing anything.
   */
  async function finalizeReviewCore(
    callId: string,
    nowMs: number
  ): Promise<FinalizeReviewOutcome> {
    const { row, segments, events, suggestions } = await loadCall(callId);
    const scenario = getScenario(row.scenario);

    if (row.status === "cancelled" || row.status === "failed") {
      return {
        ok: false,
        error: {
          category: "NO_REVIEW",
          message: `No review is generated for a ${row.status} call — the transcript is kept, but there is nothing to review.`,
        },
      };
    }
    if (row.status === "prepared") {
      return {
        ok: false,
        error: {
          category: "INVALID_STATE",
          message: "This call hasn't started yet — end it from the live workspace first.",
        },
      };
    }

    // Completed with a persisted review: re-fetch (never regenerate). The
    // effects are ensured idempotently (no-op when they already exist).
    if (row.status === "completed" && row.review_payload != null) {
      const stored = row.review_payload as StoredReviewPayload;
      await persistReviewEffects(callId, row, stored, scenario, nowMs);
      return {
        ok: true,
        callId,
        review: stored,
        created: false,
        durationSeconds: row.duration_seconds,
      };
    }

    const startedAtMs = row.started_at ? Date.parse(row.started_at) : null;
    const durationSeconds =
      row.duration_seconds ??
      (startedAtMs !== null ? Math.max(0, Math.floor((nowMs - startedAtMs) / 1000)) : null);

    // Generate the review. A live session goes through the state machine
    // (live -> processing -> completed); a processing session (End Session
    // already ran) completes directly. Never downgrades a completed call.
    let session = rebuildSession(row, segments, events, suggestions, scenario);
    if (session.status === "live") {
      const ended = sim.endSimulation(session, nowMs);
      if (!ended.ok) mapEngineError(ended.error);
      session = ended.value;
      await store.updateSession(callId, { status: "processing", duration_seconds: durationSeconds });
    }

    const review = buildReview({
      session,
      scenario,
      events: events.map(rowToEvent),
      segments: segments.map((s) => ({
        id: s.id,
        callId: s.call_id,
        sequence: s.sequence,
        speaker: s.speaker,
        text: s.text,
        relativeTimeMs: s.relative_time_ms,
        confidence: s.confidence,
        isFinal: s.is_final,
      })),
      suggestions: toReviewSuggestions(suggestions),
    });
    const preCallStage = await capturePreCallStage(row.prospect_id);
    const stored: StoredReviewPayload = { ...review, preCallStage };

    await store.updateSession(callId, {
      status: "completed",
      outcome: review.outcome ?? null,
      purchase_intent_score: review.purchaseIntent.score,
      purchase_intent_label: review.purchaseIntent.label,
      purchase_intent_explanation:
        review.purchaseIntent.score === null
          ? "Insufficient data — not enough revealed evidence."
          : `${review.purchaseIntent.label} (${review.purchaseIntent.evidenceCompleteness} evidence completeness) — ${review.purchaseIntent.scoringVersion}`,
      evidence: {
        positives: review.purchaseIntent.positives,
        risks: review.purchaseIntent.risks,
        unknowns: review.purchaseIntent.unknowns,
      },
      summary: review.summary,
      next_action: review.nextAction,
      pipeline_recommendation: review.pipelineRecommendation.targetStage,
      pipeline_recommendation_reason: review.pipelineRecommendation.reason,
      review_payload: stored,
      error: null,
    });
    await persistReviewEffects(callId, row, stored, scenario, nowMs);
    return { ok: true, callId, review: stored, created: true, durationSeconds };
  }

  return {
    /** Creates a prepared simulated call session row + engine session. */
    async prepareCall(input: {
      prospectId?: string | null;
      salesProfileId?: string | null;
      scenarioId?: string | null;
    }): Promise<{ callId: string; snapshot: LiveSessionSnapshot }> {
      const scenario = getScenario(input.scenarioId ?? "abc_roofing");
      const callId = randomUUID();
      const session = sim.createSimulationSession({ callId, scenarioId: scenario.id });
      await store.insertSession({
        id: callId,
        user_id: userId,
        prospect_id: input.prospectId ?? null,
        sales_profile_id: input.salesProfileId ?? null,
        mode: "practice",
        scenario: scenario.id,
        is_simulated: true,
        status: "prepared",
        objective: scenario.callObjective,
        timing: null,
        started_at: null,
        duration_seconds: null,
        outcome: null,
        opportunity_fit_score: null,
        opportunity_fit_label: null,
        opportunity_fit_explanation: null,
        purchase_intent_score: null,
        purchase_intent_label: null,
        purchase_intent_explanation: null,
        evidence: [],
        summary: null,
        next_action: null,
        pipeline_recommendation: null,
        pipeline_recommendation_reason: null,
        conversation_state: toJson(session.conversationState),
        review_payload: null,
        error: null,
      });
      return { callId, snapshot: snapshotFor(session) as LiveSessionSnapshot };
    },

    /** prepared -> live; started_at set exactly once (idempotent re-start). */
    async startCall(callId: string, nowMs: number = Date.now()): Promise<LiveSessionSnapshot> {
      const { row, segments, events, suggestions } = await loadCall(callId);
      const scenario = getScenario(row.scenario);
      const session = rebuildSession(row, segments, events, suggestions, scenario);
      const result = sim.startSimulation(session, nowMs);
      if (!result.ok) mapEngineError(result.error);
      const { session: started, startedAtSet } = result.value;
      if (startedAtSet) {
        await store.updateSession(callId, { status: "live", started_at: iso(nowMs) });
      }
      return snapshotFor(started) as LiveSessionSnapshot;
    },

    /** Advances ONE turn (or reconciles/repairs a replay). See module docs. */
    async advanceCall(
      callId: string,
      input: { expectedCursor?: number; nowMs?: number } = {}
    ): Promise<AdvanceOutcome> {
      const nowMs = input.nowMs ?? Date.now();
      const { row, segments, events, suggestions } = await loadCall(callId);
      const scenario = getScenario(row.scenario);
      const authoritativeRevealed = segments.length;
      const cursor = input.expectedCursor ?? authoritativeRevealed;

      if (cursor !== authoritativeRevealed) {
        if (cursor > authoritativeRevealed) {
          throw new CallServiceError(
            "STALE_CURSOR",
            `Stale call cursor: client is at ${cursor} but the call has ${authoritativeRevealed} revealed turns. Reconcile before advancing.`
          );
        }
        // Replay path: the turn was already persisted (retry / another tab /
        // Strict Mode). If the last segment's events never got written, the
        // advance was interrupted — repair it by re-running the advance
        // (segment upsert no-ops via its deterministic id).
        const lastSegment = segments[segments.length - 1];
        const lastHasEvents =
          lastSegment !== undefined && events.some((e) => e.segment_id === lastSegment.id);
        if (lastSegment && !lastHasEvents) {
          const priorSegments = segments.slice(0, segments.length - 1);
          const priorEvents = events.filter((e) => e.segment_id !== lastSegment.id);
          const repairSession = rebuildSession(
            row,
            priorSegments,
            priorEvents,
            suggestions,
            scenario,
            segments.length - 1
          );
          const turn = scenario.turns[repairSession.revealedTurnCount];
          const simNowMs = turn?.relativeTimeMs ?? nowMs;
          const repaired = sim.advanceSimulation(repairSession, scenario, simNowMs);
          if (!repaired.ok) mapEngineError(repaired.error);
          const snapshot = await persistPlan(
            row,
            repaired.value.plan,
            repaired.value.session,
            nowMs
          );
          return { snapshot, advanced: true, repaired: true };
        }
        const session = rebuildSession(row, segments, events, suggestions, scenario);
        return {
          snapshot: snapshotFor(session) as LiveSessionSnapshot,
          advanced: false,
          repaired: false,
        };
      }

      const session = rebuildSession(row, segments, events, suggestions, scenario);
      const turn = scenario.turns[cursor];
      const simNowMs = turn?.relativeTimeMs ?? nowMs;
      const result = sim.advanceSimulation(session, scenario, simNowMs);
      if (!result.ok) mapEngineError(result.error);
      const snapshot = await persistPlan(
        row,
        result.value.plan,
        result.value.session,
        nowMs
      );
      return { snapshot, advanced: true, repaired: false };
    },

    async pauseCall(callId: string): Promise<LiveSessionSnapshot> {
      const { row, segments, events, suggestions } = await loadCall(callId);
      const scenario = getScenario(row.scenario);
      const session = rebuildSession(row, segments, events, suggestions, scenario);
      const result = sim.pauseSimulation(session);
      if (!result.ok) mapEngineError(result.error);
      return snapshotFor(result.value) as LiveSessionSnapshot;
    },

    async resumeCall(callId: string): Promise<LiveSessionSnapshot> {
      const { row, segments, events, suggestions } = await loadCall(callId);
      const scenario = getScenario(row.scenario);
      const session = rebuildSession(row, segments, events, suggestions, scenario);
      const result = sim.resumeSimulation(session);
      if (!result.ok) mapEngineError(result.error);
      return snapshotFor(result.value) as LiveSessionSnapshot;
    },

    /**
     * Ends the call: live -> (generate review) -> completed. Delegates to the
     * M7 finalizeReview operation so every completion path (End Session from
     * the live workspace, or the review page's own finalize) persists the
     * identical review + note + activity + product event. Idempotent.
     */
    async endCall(callId: string, nowMs: number = Date.now()): Promise<EndOutcome> {
      const result = await finalizeReviewCore(callId, nowMs);
      if (!result.ok) {
        throw new CallServiceError("INVALID_STATE", result.error.message);
      }
      return { callId, review: result.review, snapshot: null };
    },

    /**
     * Finalize (or re-fetch) the evidence-based review for a call. Ownership-
     * guarded (NOT_FOUND for another user's call), refuses cancelled/failed
     * and prepared calls, never downgrades a completed call, and is safe to
     * re-run: the review is regenerated at most once and the call-summary
     * note / call_completed activity / review_created product event are each
     * created exactly once.
     */
    async finalizeReview(callId: string, nowMs: number = Date.now()): Promise<FinalizeReviewOutcome> {
      return finalizeReviewCore(callId, nowMs);
    },

    /**
     * Applies the review's pipeline recommendation with a stale-stage recheck
     * (spec: NEVER silently move the pipeline). The prospect's CURRENT stage
     * is compared against the pre-call stage captured when the review was
     * generated; when they differ, `confirmed: true` is required. Applying
     * when the prospect is already at the recommended stage is a no-op.
     * Creates exactly one stage_changed activity and one review_applied
     * product event per apply.
     */
    async applyReviewRecommendation(
      callId: string,
      input: { confirmed?: boolean; nowMs?: number } = {}
    ): Promise<ApplyRecommendationOutcome> {
      const nowMs = input.nowMs ?? Date.now();
      const { row } = await loadCall(callId); // throws NOT_FOUND when not owned
      if (row.status !== "completed" || row.review_payload == null) {
        return {
          ok: false,
          error: {
            category: "NO_REVIEW",
            message: "This call has no completed review to apply.",
          },
        };
      }
      const prospectId = row.prospect_id;
      if (!prospectId) {
        return {
          ok: false,
          error: {
            category: "NO_PROSPECT",
            message: "This practice call isn't linked to a prospect, so there's no pipeline record to update.",
          },
        };
      }
      const prospect = await store.getProspectRecord(prospectId);
      if (!prospect || prospect.user_id !== userId) {
        return {
          ok: false,
          error: {
            category: "NO_PROSPECT",
            message: "The linked prospect no longer exists.",
          },
        };
      }
      const payload = row.review_payload as StoredReviewPayload;
      const targetStage = payload.pipelineRecommendation.targetStage;
      // Legacy payloads (finalized before M7) have no preCallStage: skip the
      // stale check by treating the current stage as expected.
      const expectedStage = payload.preCallStage ?? prospect.stage;
      const currentStage = prospect.stage;

      // Idempotency: already at the recommended stage -> no-op (applying
      // twice never duplicates activities or events).
      if (currentStage === targetStage) {
        return {
          ok: true,
          prospectId,
          fromStage: currentStage,
          toStage: targetStage,
          applied: false,
          changed: false,
        };
      }

      // Stale-stage recheck: the prospect moved since the review was
      // generated. Blocked until the user explicitly confirms.
      if (currentStage !== expectedStage && input.confirmed !== true) {
        return {
          ok: false,
          error: {
            category: "STALE_STAGE",
            message: `The prospect moved from ${humanizeStage(expectedStage)} to ${humanizeStage(currentStage)} since this call. Confirm to apply anyway.`,
            currentStage,
            expectedStage,
          },
        };
      }

      const transition = applyStageTransition({
        prospectId,
        currentStage: currentStage as PipelineStage,
        expectedStage: currentStage as PipelineStage,
        targetStage: targetStage as PipelineStage,
        confirmed: true, // the caller already confirmed in the UI dialog
      });
      if (!transition.ok) {
        return { ok: false, error: { category: "PIPELINE", message: transition.error.message } };
      }

      await store.updateProspect(prospectId, {
        stage: targetStage,
        last_contact_at: iso(nowMs),
      });
      // Exactly one stage_changed activity per apply (deterministic id).
      await store.upsertActivity({
        id: uuidFromParts(callId, "activity", "stage_changed", targetStage),
        user_id: userId,
        prospect_id: prospectId,
        call_id: callId,
        type: "stage_changed",
        summary: `Pipeline stage changed — ${humanizeStage(currentStage)} → ${humanizeStage(targetStage)} (from call review).`,
        metadata: {
          callId,
          fromStage: currentStage,
          toStage: targetStage,
          source: "call_review",
          recommendation: payload.pipelineRecommendation.reason,
        },
        occurred_at: iso(nowMs),
      });
      await store.upsertProductEvent({
        id: uuidFromParts(callId, "product_event", "review_applied"),
        user_id: userId,
        session_id: callId,
        type: "review_applied",
        summary: `Applied call review recommendation: ${humanizeStage(currentStage)} → ${humanizeStage(targetStage)}.`,
        metadata: {
          callId,
          prospectId,
          fromStage: currentStage,
          toStage: targetStage,
          recommendation: targetStage,
        },
        occurred_at: iso(nowMs),
      });
      return {
        ok: true,
        prospectId,
        fromStage: currentStage,
        toStage: targetStage,
        applied: true,
        changed: true,
      };
    },

    /** Cancels a prepared/live call (history is preserved). */
    async cancelCall(callId: string, nowMs: number = Date.now()): Promise<{ snapshot: null }> {
      const { row, segments, events, suggestions } = await loadCall(callId);
      const scenario = getScenario(row.scenario);
      const session = rebuildSession(row, segments, events, suggestions, scenario);
      const result = sim.cancelSimulation(session, nowMs);
      if (!result.ok) mapEngineError(result.error);
      await store.updateSession(callId, { status: "cancelled" });
      return { snapshot: null };
    },

    /**
     * Deliberate restart: mints a NEW call row (prepared) under a fresh call
     * id. The old call's rows are left intact (history preserved).
     */
    async restartCall(callId: string): Promise<{ newCallId: string; snapshot: LiveSessionSnapshot }> {
      const { row, segments, events, suggestions } = await loadCall(callId);
      const scenario = getScenario(row.scenario);
      const session = rebuildSession(row, segments, events, suggestions, scenario);
      const newCallId = randomUUID();
      const fresh = sim.resetSimulation(session, newCallId);
      await store.insertSession({
        id: newCallId,
        user_id: userId,
        prospect_id: row.prospect_id,
        sales_profile_id: row.sales_profile_id,
        mode: "practice",
        scenario: scenario.id,
        is_simulated: true,
        status: "prepared",
        objective: scenario.callObjective,
        timing: null,
        started_at: null,
        duration_seconds: null,
        outcome: null,
        opportunity_fit_score: null,
        opportunity_fit_label: null,
        opportunity_fit_explanation: null,
        purchase_intent_score: null,
        purchase_intent_label: null,
        purchase_intent_explanation: null,
        evidence: [],
        summary: null,
        next_action: null,
        pipeline_recommendation: null,
        pipeline_recommendation_reason: null,
        conversation_state: toJson(fresh.conversationState),
        review_payload: null,
        error: null,
      });
      return { newCallId, snapshot: snapshotFor(fresh) as LiveSessionSnapshot };
    },

    /** Records recommendation feedback (dismissal is not negative feedback). */
    async saveSuggestionFeedback(
      callId: string,
      suggestionId: string,
      action: FeedbackAction,
      nowMs: number = Date.now()
    ): Promise<LiveSessionSnapshot | null> {
      const { row, segments, events, suggestions } = await loadCall(callId);
      const scenario = getScenario(row.scenario);
      const session = rebuildSession(row, segments, events, suggestions, scenario);
      const result = sim.applySuggestionFeedback(session, suggestionId, action, nowMs);
      if (!result.ok) mapEngineError(result.error);
      const updated = result.value;
      const record = updated.suggestions.find((s) => s.id === suggestionId);
      if (!record) throw new CallServiceError("NOT_FOUND", `No suggestion "${suggestionId}".`);
      await store.updateSuggestion(
        suggestionId,
        action === "dismiss"
          ? { dismissed_at: iso(nowMs) }
          : { used_at: iso(nowMs), feedback: action }
      );
      return snapshotFor(updated);
    },

    /** Bounded live snapshot (null once the call is terminal). */
    async getLiveSnapshot(callId: string): Promise<LiveSessionSnapshot | null> {
      const { row, segments, events, suggestions } = await loadCall(callId);
      const scenario = getScenario(row.scenario);
      const session = rebuildSession(row, segments, events, suggestions, scenario);
      return snapshotFor(session);
    },

    /** Full serializable payload the live workspace renders (header, hero,
     * transcript, deal state, signals, controls). Built from the same
     * authoritative rows the snapshot reconciles against. */
    async getWorkspace(callId: string): Promise<LiveWorkspace> {
      const { row, segments, events, suggestions } = await loadCall(callId);
      const scenario = getScenario(row.scenario);
      const session = rebuildSession(row, segments, events, suggestions, scenario);
      const prospect = row.prospect_id ? await store.getProspect(row.prospect_id) : null;
      return buildWorkspace({
        row,
        segments,
        events,
        suggestions,
        session,
        scenario,
        prospect,
      });
    },

    /** Snapshot -> authoritative reconcile (authoritative wins; cleared when
     * the call is terminal). */
    async reconcileCallSnapshot(
      callId: string,
      snapshot: LiveSessionSnapshot
    ): Promise<LiveSessionSnapshot | null> {
      const { row, segments, events, suggestions } = await loadCall(callId);
      const scenario = getScenario(row.scenario);
      const session = rebuildSession(row, segments, events, suggestions, scenario);
      const authoritative = snapshotFor(session);
      if (authoritative === null) return null;
      return reconcileLiveSnapshot(snapshot, {
        revealedTurnCount: authoritative.revealedTurnCount,
        conversationStateVersion: authoritative.conversationStateVersion,
        activeSuggestionId: authoritative.activeSuggestionId,
        lastSavedAtMs: authoritative.lastSavedAtMs,
        status: authoritative.status,
      });
    },
  };
}

export type SimulationService = ReturnType<typeof createSimulationService>;
