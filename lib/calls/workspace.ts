// Live Call workspace — the bounded payload the /calls/[callId]/live page
// renders, plus pure helpers (signal window, hero labels) that the UI uses.
//
// This module is intentionally free of Next/Supabase imports so Vitest can
// unit-test it directly. buildWorkspace() maps persisted rows + the rebuilt
// engine session into the serializable shape the client renders; the service
// (lib/calls/service.ts getWorkspace) supplies those inputs.
import { snapshotFor, type LiveSessionSnapshot } from "@/domain/simulation/snapshot";
import type { SimulationScenario, SimulationSession } from "@/domain/simulation/types";
import type { ConversationState } from "@/domain/conversation-state/types";
import type { CallSessionStatus } from "@/domain/sessions/types";
import type { EventCategory, EventType, SpeakerRole } from "@/domain/events/types";
import type { SuggestionAction } from "@/domain/coaching/types";
import type {
  AiSuggestionRow,
  CallEventRow,
  CallSessionRow,
  TranscriptSegmentRow,
} from "@/lib/calls/types";

// ---------------------------------------------------------------------------
// Workspace shape (serializable; this is what crosses the action boundary)
// ---------------------------------------------------------------------------

export interface WorkspaceSegment {
  id: string; // UUID string — never Number(id)
  sequence: number;
  speaker: SpeakerRole;
  text: string;
  relativeTimeMs: number;
}

export interface WorkspaceEvent {
  id: string; // UUID string
  type: EventType;
  category: EventCategory;
  speaker: SpeakerRole;
  /** Verbatim quote from the transcript segment. */
  exactEvidence: string;
  importance: number;
  relativeTimeMs: number;
  /** Structured (non-prose) hints, e.g. { isConcern: true }. */
  metadata: Record<string, unknown>;
}

export interface WorkspaceSuggestion {
  id: string; // UUID string
  action: SuggestionAction;
  text: string;
  reason: string | null;
  priority: number;
  eventId: string | null;
  /** Sim-clock (call-relative) ms; null = never set. */
  createdAtMs: number;
  expiresAtMs: number | null;
  dismissedAtMs: number | null;
  usedAtMs: number | null;
  feedback: "useful" | "not_useful" | null;
  supersedesId: string | null;
  supersededBy: string | null;
}

export interface LiveWorkspace {
  callId: string; // UUID string
  status: CallSessionStatus;
  scenarioId: string;
  scenarioLabel: string;
  /** Total scenario turns — lets the client know the scenario is complete. */
  scenarioTurnCount: number;
  callObjective: string;
  prospectName: string;
  prospectCompany: string;
  /** Every Phase 1 call is clearly labeled simulated. */
  simulated: true;
  /** Wall-clock ms when the call went live (null until started). */
  startedAtMs: number | null;
  /** Bounded session snapshot; null once the call is terminal. */
  snapshot: LiveSessionSnapshot | null;
  /** Revealed transcript segments, oldest first. */
  segments: WorkspaceSegment[];
  /** All events in reveal order (signal window is derived client-side). */
  events: WorkspaceEvent[];
  conversationState: ConversationState;
  /** Full suggestion history (dismissed/superseded ones stay visible to code). */
  suggestions: WorkspaceSuggestion[];
  /** The suggestion currently shown, if any (null = calm Listening). */
  activeSuggestion: WorkspaceSuggestion | null;
}

// ---------------------------------------------------------------------------
// buildWorkspace: persisted rows + rebuilt session -> serializable payload
// ---------------------------------------------------------------------------

export interface BuildWorkspaceInput {
  row: CallSessionRow;
  segments: TranscriptSegmentRow[];
  events: CallEventRow[];
  /** Raw suggestion rows (used only for their timestamps). */
  suggestions: AiSuggestionRow[];
  /** The authoritative rebuilt engine session (activeSuggestionId trusted). */
  session: SimulationSession;
  scenario: SimulationScenario;
  /** Linked prospect row, when the call is attached to one. */
  prospect: { name: string | null; company: string | null } | null;
}

export function buildWorkspace(input: BuildWorkspaceInput): LiveWorkspace {
  const { row, segments, events, session, scenario, prospect } = input;
  const startedAtMs = row.started_at ? Date.parse(row.started_at) : null;
  const active = session.activeSuggestionId
    ? (session.suggestions.find((s) => s.id === session.activeSuggestionId) ?? null)
    : null;
  return {
    callId: row.id,
    status: row.status as CallSessionStatus,
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    scenarioTurnCount: scenario.turns.length,
    callObjective: scenario.callObjective,
    prospectName: prospect?.name?.trim() || scenario.prospectName,
    prospectCompany: prospect?.company?.trim() || scenario.prospectCompany,
    simulated: true,
    startedAtMs,
    snapshot: snapshotFor(session),
    segments: segments.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      speaker: s.speaker,
      text: s.text,
      relativeTimeMs: s.relative_time_ms,
    })),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      category: e.category,
      speaker: e.speaker,
      exactEvidence: e.exact_evidence,
      importance: e.importance,
      relativeTimeMs: e.relative_time_ms,
      metadata: (e.metadata ?? {}) as Record<string, unknown>,
    })),
    conversationState: session.conversationState,
    suggestions: session.suggestions.map((s) => ({
      id: s.id,
      action: s.action,
      text: s.text,
      reason: s.reason ?? null,
      priority: s.priority,
      eventId: s.eventId ?? null,
      createdAtMs: s.createdAtMs,
      expiresAtMs: s.expiresAtMs === Number.MAX_SAFE_INTEGER ? null : s.expiresAtMs,
      dismissedAtMs: s.dismissedAtMs ?? null,
      usedAtMs: s.usedAtMs ?? null,
      feedback: s.feedback ?? null,
      supersedesId: s.supersedesId ?? null,
      supersededBy: s.supersededBy ?? null,
    })),
    activeSuggestion: active
      ? {
          id: active.id,
          action: active.action,
          text: active.text,
          reason: active.reason ?? null,
          priority: active.priority,
          eventId: active.eventId ?? null,
          createdAtMs: active.createdAtMs,
          expiresAtMs: active.expiresAtMs === Number.MAX_SAFE_INTEGER ? null : active.expiresAtMs,
          dismissedAtMs: active.dismissedAtMs ?? null,
          usedAtMs: active.usedAtMs ?? null,
          feedback: active.feedback ?? null,
          supersedesId: active.supersedesId ?? null,
          supersededBy: active.supersededBy ?? null,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Signal window — "only three to five recent meaningful signals"
// ---------------------------------------------------------------------------

/** Event types worth showing in the compact signals strip. Prospect
 * questions are handled by the recommendation hero, not the signal feed. */
export const SIGNAL_WORTHY_TYPES: readonly EventType[] = [
  "OBJECTION",
  "BUYING_SIGNAL",
  "PRICE_DISCUSSION",
  "PAIN_DISCOVERED",
  "AUTHORITY_SIGNAL",
  "TIMELINE_SIGNAL",
  "COMPETITOR_MENTION",
  "MISSED_DISCOVERY",
] as const;

export const MAX_SIGNALS = 5;

/**
 * Picks the `max` most recent meaningful events, most recent first.
 * Deterministic: ties break on event id so replays never reorder the strip.
 */
export function selectSignalWindow(
  events: readonly WorkspaceEvent[],
  max: number = MAX_SIGNALS
): WorkspaceEvent[] {
  const meaningful = events.filter((e) =>
    (SIGNAL_WORTHY_TYPES as readonly string[]).includes(e.type)
  );
  return [...meaningful]
    .sort(
      (a, b) =>
        a.relativeTimeMs - b.relativeTimeMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .slice(-Math.max(0, max))
    .reverse();
}

// ---------------------------------------------------------------------------
// Hero labels — e.g. "PRICE CONCERN / ASK NEXT" (uppercase is a CSS concern)
// ---------------------------------------------------------------------------

/** Human label for an event type (price discussions read as concern when the
 * structured metadata marks them so — never parsed from prose). */
export function eventLabel(type: EventType, metadata?: Record<string, unknown>): string {
  if (type === "PRICE_DISCUSSION") {
    return metadata?.isConcern === true ? "Price concern" : "Price discussion";
  }
  switch (type) {
    case "OBJECTION":
      return "Objection";
    case "QUESTION":
      return "Prospect question";
    case "BUYING_SIGNAL":
      return "Buying signal";
    case "COMPETITOR_MENTION":
      return "Competitor mention";
    case "PAIN_DISCOVERED":
      return "Pain discovered";
    case "AUTHORITY_SIGNAL":
      return "Authority";
    case "TIMELINE_SIGNAL":
      return "Timeline";
    case "MISSED_DISCOVERY":
      return "Missed discovery";
  }
}

export function actionLabel(action: SuggestionAction): string {
  switch (action) {
    case "ASK":
      return "Ask next";
    case "SAY":
      return "Say this";
    case "CLARIFY":
      return "Clarify";
    case "LISTEN":
      return "Listen";
    case "CLOSE":
      return "Close";
    case "DO_NOT_PUSH":
      return "Don't push";
  }
}

export interface HeroKickers {
  /** Event-derived label, e.g. "Price concern" (null when no trigger event). */
  eventLabel: string | null;
  /** Action label, e.g. "Ask next". */
  actionLabel: string;
}

/**
 * The two small kicker labels above the recommendation text. The event label
 * describes what was heard ("PRICE CONCERN"), the action label what to do
 * ("ASK NEXT"). When they'd read identically, the event label is dropped.
 */
export function heroKickers(
  suggestion: Pick<WorkspaceSuggestion, "action" | "eventId">,
  events: readonly WorkspaceEvent[]
): HeroKickers {
  const trigger = suggestion.eventId
    ? (events.find((e) => e.id === suggestion.eventId) ?? null)
    : null;
  const evLabel = trigger ? eventLabel(trigger.type, trigger.metadata) : null;
  const actLabel = actionLabel(suggestion.action);
  if (evLabel && evLabel.toLowerCase() === actLabel.toLowerCase()) {
    return { eventLabel: null, actionLabel: actLabel };
  }
  return { eventLabel: evLabel, actionLabel: actLabel };
}
