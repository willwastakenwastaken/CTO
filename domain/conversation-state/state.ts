// Conversation state engine: how structured events mutate the truth model.
//
// Rules enforced here (spec):
//  * Confirmed facts carry evidence ids (event UUIDs).
//  * Later explicit corrections outrank earlier statements: the fact value is
//    replaced, but ALL evidence is kept (history preserved).
//  * Rep statements can NEVER confirm prospect facts — only prospect events
//    update prospect facts (MISSED_DISCOVERY is a system/rep-side coaching
//    signal that updates nextObjective).
//  * Missing evidence never erases confirmed information: retractEvidence()
//    removes an evidence id but never clears a fact value.
import type { CallEvent } from "@/domain/events/types";
import type { SpeakerRole } from "@/domain/events/types";
import {
  type ConversationStage,
  type ConversationState,
  type InterestLevel,
  type StateFact,
} from "@/domain/conversation-state/types";
import {
  normalizeConversationStateJson,
  type ConversationStateJson,
  type StateFactJson,
} from "@/domain/schemas/conversation-state";

/** Stable error categories for state-engine failures. */
export type ConversationStateErrorCategory = "INVALID_EVENT" | "INVALID_JSON";

export function createConversationState(
  stage: ConversationStage = "opening"
): ConversationState {
  return {
    stage,
    interest: "unknown",
    pain: null,
    impact: null,
    authority: null,
    budget: null,
    timeline: null,
    currentSolution: null,
    nextObjective: null,
    competitors: [],
    objections: [],
    buyingSignals: [],
    version: 0,
  };
}

function factFromEvent(event: CallEvent, value?: string): StateFact {
  return {
    value: value ?? event.exactEvidence,
    evidenceIds: [event.id],
    updatedAtMs: event.relativeTimeMs,
  };
}

/** Sets a single fact, applying the correction rule (value replaced, evidence
 * appended, history preserved). */
function setFact(
  current: StateFact | null,
  event: CallEvent,
  value?: string
): StateFact {
  if (current === null) return factFromEvent(event, value);
  const nextValue = value ?? event.exactEvidence;
  const evidenceIds = current.evidenceIds.includes(event.id)
    ? current.evidenceIds
    : [...current.evidenceIds, event.id];
  return {
    value: nextValue, // later explicit corrections outrank earlier statements
    evidenceIds,
    updatedAtMs: event.relativeTimeMs,
  };
}

/** Appends a fact to a list (objections, buying signals, competitors). */
function pushFact(
  facts: StateFact[],
  event: CallEvent,
  value?: string
): StateFact[] {
  const already = facts.find((f) => f.evidenceIds.includes(event.id));
  if (already) {
    return facts.map((f) =>
      f.evidenceIds.includes(event.id) ? setFact(f, event, value) : f
    );
  }
  return [...facts, factFromEvent(event, value)];
}

function bumpInterest(
  state: ConversationState,
  level: InterestLevel
): ConversationState {
  const ORDER: Record<InterestLevel, number> = {
    unknown: 0,
    low: 1,
    medium: 2,
    high: 3,
  };
  if (ORDER[level] <= ORDER[state.interest]) return state;
  return { ...state, interest: level, version: state.version + 1 };
}

function isProspectEvent(event: CallEvent): boolean {
  return event.speaker === "prospect";
}

/**
 * Applies one structured event to the conversation state (immutably).
 * Returns a NEW state object when anything changed; otherwise the same
 * reference. Events that carry no prospect-confirmable meaning (e.g. a rep
 * QUESTION) leave the state untouched.
 */
export function applyEvent(
  state: ConversationState,
  event: CallEvent
): ConversationState {
  switch (event.type) {
    case "OBJECTION": {
      if (!isProspectEvent(event)) return state;
      return {
        ...state,
        objections: pushFact(state.objections, event),
        version: state.version + 1,
      };
    }
    case "PRICE_DISCUSSION": {
      if (!isProspectEvent(event)) return state;
      // A neutral price mention (metadata.isConcern === false) is not an
      // objection and does not mutate state.
      if (event.metadata?.isConcern === false) return state;
      return {
        ...state,
        objections: pushFact(
          state.objections,
          event,
          `Price concern: ${event.exactEvidence}`
        ),
        version: state.version + 1,
      };
    }
    case "BUYING_SIGNAL": {
      if (!isProspectEvent(event)) return state;
      const next: ConversationState = {
        ...state,
        buyingSignals: pushFact(state.buyingSignals, event),
        version: state.version + 1,
      };
      return bumpInterest(next, "high");
    }
    case "PAIN_DISCOVERED": {
      if (!isProspectEvent(event)) return state;
      let next: ConversationState;
      if (event.metadata?.facet === "impact") {
        next = { ...state, impact: setFact(state.impact, event), version: state.version + 1 };
      } else {
        next = { ...state, pain: setFact(state.pain, event), version: state.version + 1 };
      }
      return bumpInterest(next, "medium");
    }
    case "AUTHORITY_SIGNAL": {
      if (!isProspectEvent(event)) return state;
      return {
        ...state,
        authority: setFact(state.authority, event),
        version: state.version + 1,
      };
    }
    case "TIMELINE_SIGNAL": {
      if (!isProspectEvent(event)) return state;
      const next: ConversationState = {
        ...state,
        timeline: setFact(state.timeline, event),
        version: state.version + 1,
      };
      return bumpInterest(next, "medium");
    }
    case "COMPETITOR_MENTION": {
      if (!isProspectEvent(event)) return state;
      return {
        ...state,
        competitors: pushFact(state.competitors, event),
        version: state.version + 1,
      };
    }
    case "MISSED_DISCOVERY": {
      // Coaching signal (system/rep side) — sets the rep's next objective.
      const dimension =
        typeof event.metadata?.dimension === "string"
          ? event.metadata.dimension
          : "the missed topic";
      return {
        ...state,
        nextObjective: setFact(state.nextObjective, event, `Explore ${dimension}`),
        version: state.version + 1,
      };
    }
    case "QUESTION":
    default:
      // Prospect questions drive intervention, not state mutation. A rep
      // QUESTION confirms nothing about the prospect.
      return state;
  }
}

/**
 * Applies a batch of events in order (simulation/advance path). Coalesces to
 * a single new state object.
 */
export function applyEvents(
  state: ConversationState,
  events: readonly CallEvent[]
): ConversationState {
  let next = state;
  for (const event of events) {
    next = applyEvent(next, event);
  }
  return next;
}

/** Advances the conversation stage (e.g. opening -> discovery). */
export function setStage(
  state: ConversationState,
  stage: ConversationStage
): ConversationState {
  if (state.stage === stage) return state;
  return { ...state, stage, version: state.version + 1 };
}

/**
 * Removes an evidence id from every fact WITHOUT erasing values — missing
 * evidence never erases confirmed information. Returns a new state when any
 * fact changed.
 */
export function retractEvidence(
  state: ConversationState,
  eventId: string
): ConversationState {
  let changed = false;
  const retractFact = (fact: StateFact | null): StateFact | null => {
    if (fact === null || !fact.evidenceIds.includes(eventId)) return fact;
    changed = true;
    return { ...fact, evidenceIds: fact.evidenceIds.filter((id) => id !== eventId) };
  };
  const retractList = (facts: StateFact[]): StateFact[] => {
    if (!facts.some((f) => f.evidenceIds.includes(eventId))) return facts;
    changed = true;
    return facts.map((f) => ({
      ...f,
      evidenceIds: f.evidenceIds.filter((id) => id !== eventId),
    }));
  };
  const next: ConversationState = {
    ...state,
    pain: retractFact(state.pain),
    impact: retractFact(state.impact),
    authority: retractFact(state.authority),
    budget: retractFact(state.budget),
    timeline: retractFact(state.timeline),
    currentSolution: retractFact(state.currentSolution),
    nextObjective: retractFact(state.nextObjective),
    competitors: retractList(state.competitors),
    objections: retractList(state.objections),
    buyingSignals: retractList(state.buyingSignals),
  };
  return changed ? { ...next, version: state.version + 1 } : state;
}

function toFactJson(fact: StateFact | null): StateFactJson | null {
  if (fact === null) return null;
  return {
    value: fact.value,
    evidenceIds: fact.evidenceIds,
    updatedAtMs: fact.updatedAtMs,
  };
}

/** Serializes state to the DB-shaped JSON (call_sessions.conversation_state). */
export function toJson(state: ConversationState): ConversationStateJson {
  return {
    stage: state.stage,
    interest: state.interest,
    pain: toFactJson(state.pain),
    impact: toFactJson(state.impact),
    authority: toFactJson(state.authority),
    budget: toFactJson(state.budget),
    timeline: toFactJson(state.timeline),
    currentSolution: toFactJson(state.currentSolution),
    nextObjective: toFactJson(state.nextObjective),
    competitors: state.competitors.map(toFactJson) as StateFactJson[],
    objections: state.objections.map(toFactJson) as StateFactJson[],
    buyingSignals: state.buyingSignals.map(toFactJson) as StateFactJson[],
    version: state.version,
  };
}

/** Hydrates state from stored JSON (tolerates sparse rows via normalization). */
export function fromJson(json: unknown): ConversationState {
  const parsed = normalizeConversationStateJson(json);
  return {
    stage: parsed.stage,
    interest: parsed.interest,
    pain: parsed.pain,
    impact: parsed.impact,
    authority: parsed.authority,
    budget: parsed.budget,
    timeline: parsed.timeline,
    currentSolution: parsed.currentSolution,
    nextObjective: parsed.nextObjective,
    competitors: parsed.competitors,
    objections: parsed.objections,
    buyingSignals: parsed.buyingSignals,
    version: parsed.version,
  };
}

export type { ConversationStage, ConversationState, InterestLevel, SpeakerRole };
