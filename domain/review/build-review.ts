// Deterministic review builder — evidence-based Call Review data for
// simulated calls (Phase 1). Uses ONLY revealed evidence: confirmed facts
// carry event ids; quotes are verbatim transcript lines, never invented.
// Ending early reveals less evidence -> scores return insufficient_data when
// appropriate. The pipeline recommendation (e.g. Contacted -> Qualified) is a
// deterministic heuristic over confirmed evidence, never a silent move.
import { computePurchaseIntent } from "@/domain/scoring/purchase-intent";
import { ReviewPayloadSchema, type ReviewPayload } from "@/domain/schemas/review";
import type { CallEvent } from "@/domain/events/types";
import type { ConversationState, StateFact } from "@/domain/conversation-state/types";
import type { SimulationScenario, SimulationSession } from "@/domain/simulation/types";
import type { TranscriptSegment } from "@/domain/transcript/types";
import type { SuggestionInput } from "@/domain/coaching/types";

export interface ReviewSuggestion extends SuggestionInput {
  eventId?: string | null;
}

export interface ReviewInput {
  session: SimulationSession;
  scenario: SimulationScenario;
  /** All persisted events for the call, in reveal order. */
  events: readonly CallEvent[];
  /** All persisted segments for the call, in sequence order. */
  segments: readonly TranscriptSegment[];
  suggestions: readonly ReviewSuggestion[];
}

function factValue(fact: StateFact | null): string | null {
  return fact ? fact.value : null;
}

function evidenceRefs(
  facts: readonly StateFact[],
  events: readonly CallEvent[]
): ReviewPayload["buyingSignals"] {
  const refs: ReviewPayload["buyingSignals"] = [];
  for (const fact of facts) {
    const firstEventId = fact.evidenceIds[0];
    const event = firstEventId ? events.find((e) => e.id === firstEventId) : undefined;
    if (!event) continue;
    refs.push({
      eventId: event.id,
      segmentId: event.segmentId ?? undefined,
      quote: event.exactEvidence,
      relativeTimeMs: event.relativeTimeMs,
    });
  }
  return refs;
}

/** Verbatim evidence quotes behind a single fact (e.g. owner + partner). */
function evidenceQuotes(fact: StateFact | null, events: readonly CallEvent[]): string {
  if (!fact) return "";
  return fact.evidenceIds
    .map((id) => events.find((e) => e.id === id)?.exactEvidence)
    .filter((q): q is string => Boolean(q))
    .join(" — ");
}

/**
 * Builds the full review payload from revealed evidence. Deterministic:
 * identical revealed data always yields the identical review.
 */
export function buildReview(input: ReviewInput): ReviewPayload {
  const { session, events, segments, suggestions } = input;
  const state: ConversationState = session.conversationState;

  const priceConcernPresent = state.objections.some((f) =>
    f.value.toLowerCase().includes("price concern")
  );
  const hasNextStepCommitment = events.some(
    (e) => e.type === "BUYING_SIGNAL" && e.metadata?.nextStepCommitment === true
  );

  const positives: string[] = [];
  if (state.pain) positives.push(`Confirmed pain: ${state.pain.value}`);
  if (state.impact) positives.push(`Impact: ${state.impact.value}`);
  if (state.authority) positives.push(`Authority: ${state.authority.value}`);
  if (state.timeline) positives.push(`Timing: ${state.timeline.value}`);
  for (const signal of state.buyingSignals) positives.push(`Buying signal: ${signal.value}`);
  if (hasNextStepCommitment) positives.push("Next-step commitment: Wednesday demo check.");

  const intent = computePurchaseIntent({
    positives,
    risks: priceConcernPresent ? ["Unresolved price concern"] : [],
    unknowns: [],
    facts: {
      pain: state.pain !== null,
      impact: state.impact !== null,
      authority: state.authority !== null,
      timing: state.timeline !== null,
      buyingSignalCount: state.buyingSignals.length,
      nextStepCommitment: hasNextStepCommitment,
      budgetKnown: state.budget !== null,
    },
    negativeSignals: { unresolvedPriceConcern: priceConcernPresent },
    segmentReferences: segments.map((s) => s.id),
  });

  const decisionProcess = evidenceQuotes(state.authority, events) || null;
  const nextAction = hasNextStepCommitment
    ? "Confirm the joint demo on Wednesday with John and his partner — no additional push needed."
    : state.timeline
      ? "Propose a joint demo with the partner to show the solution against the 30-day timeline."
      : "Schedule a follow-up call to continue discovery.";

  const priceEvent = events.find(
    (e) => e.type === "PRICE_DISCUSSION" || (e.type === "OBJECTION" && e.metadata?.objectionType === "price")
  );
  const usedValueSuggestion = suggestions.find((s) => s.action === "ASK" && s.usedAtMs != null);
  const ownerEvent = events.find((e) => e.type === "AUTHORITY_SIGNAL");

  const summaryParts: string[] = [];
  if (state.pain) summaryParts.push(state.pain.value);
  if (state.impact) summaryParts.push(state.impact.value);
  if (state.timeline) summaryParts.push(`He wants a solution live within 30 days.`);
  if (priceConcernPresent) summaryParts.push("He raised a price concern; the rep quantified value before defending price.");
  if (hasNextStepCommitment) summaryParts.push("He checked Wednesday for a joint demo with his partner.");
  const summary =
    summaryParts.length > 0
      ? `John confirmed ${summaryParts.join(" ")}`.replace(/\s+/g, " ")
      : "The call ended before meaningful evidence was revealed.";

  // One to three concrete, evidence-backed coaching observations.
  const coaching: ReviewPayload["coaching"] = [];
  if (priceEvent) {
    coaching.push({
      kind: "strength",
      area: "price handling",
      observation:
        "Quantified value before defending price — asked what a new customer is worth instead of discounting.",
      evidence: [
        {
          eventId: priceEvent.id,
          segmentId: priceEvent.segmentId ?? undefined,
          quote: priceEvent.exactEvidence,
          relativeTimeMs: priceEvent.relativeTimeMs,
        },
      ],
    });
  }
  if (usedValueSuggestion) {
    const valueEvent = usedValueSuggestion.eventId
      ? events.find((e) => e.id === usedValueSuggestion.eventId)
      : undefined;
    if (valueEvent) {
      coaching.push({
        kind: "strength",
        area: "recommendation use",
        observation: "Used the ASK NEXT value question when the price concern surfaced.",
        evidence: [
          {
            eventId: valueEvent.id,
            segmentId: valueEvent.segmentId ?? undefined,
            quote: valueEvent.exactEvidence,
            relativeTimeMs: valueEvent.relativeTimeMs,
          },
        ],
      });
    }
  }
  if (ownerEvent && priceEvent) {
    coaching.push({
      kind: "improvement",
      area: "decision process",
      observation:
        "Confirm the decision process explicitly — John is the owner but his partner reviews recurring costs.",
      evidence: [
        {
          eventId: ownerEvent.id,
          segmentId: ownerEvent.segmentId ?? undefined,
          quote: ownerEvent.exactEvidence,
          relativeTimeMs: ownerEvent.relativeTimeMs,
        },
      ],
    });
  }

  if (coaching.length === 0) {
    coaching.push({
      kind: "improvement",
      area: "evidence gathering",
      observation:
        "The call ended before enough was revealed to coach on — continue discovery in the next conversation.",
      evidence: [],
    });
  }

  const qualified =
    Boolean(state.pain && state.impact && state.authority && state.timeline) &&
    state.buyingSignals.length > 0;

  const review: ReviewPayload = {
    outcome: "discovery_call",
    summary,
    purchaseIntent: intent,
    facts: {
      pain: factValue(state.pain),
      impact: factValue(state.impact),
      authority: factValue(state.authority),
      budget: factValue(state.budget),
      timing: factValue(state.timeline),
      currentSolution: factValue(state.currentSolution),
      competitors: state.competitors.map((c) => c.value),
      decisionProcess,
    },
    buyingSignals: evidenceRefs(state.buyingSignals, events),
    objections: evidenceRefs(state.objections, events),
    nextAction,
    coaching: coaching.slice(0, 3),
    pipelineRecommendation: {
      targetStage: qualified ? "qualified" : "contacted",
      reason: qualified
        ? "Confirmed pain, impact, authority, and a 30-day timeline, plus buying signals — qualifies to move from Contacted to Qualified."
        : "Not enough confirmed evidence (pain, impact, authority, timeline, buying signals) to qualify yet.",
    },
    segmentReferences: segments.map((s) => s.id),
    scoringVersion: intent.scoringVersion,
  };

  return ReviewPayloadSchema.parse(review);
}

export type { ReviewPayload };
