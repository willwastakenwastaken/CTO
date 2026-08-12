// M9b — Coach: eligibility gate (insights only after >= 3 eligible calls) and
// deterministic insight aggregation over stored review data. Everything is
// derived from persisted review payloads — no invented numbers, and an empty
// input yields an empty-but-valid result (honest empty states).
import { describe, expect, it } from "vitest";
import {
  COACH_ELIGIBLE_CALLS_THRESHOLD,
  aggregateCoachingInsights,
  coachEligibility,
  isEligibleCompletedCall,
  parseReviewPayload,
  selectEligibleCalls,
} from "@/lib/coach/insights";
import type { CallSessionRow } from "@/lib/calls/types";
import type { ReviewPayload } from "@/domain/schemas/review";

const UUID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function makeReview(overrides: Partial<ReviewPayload>): ReviewPayload {
  return {
    outcome: "discovery_call",
    summary: "John confirmed a real pain and a 30-day timeline.",
    purchaseIntent: {
      score: 70,
      label: "high",
      evidenceCompleteness: 0.71,
      positives: ["Confirmed pain: slow callbacks cost jobs"],
      risks: ["Unresolved price concern"],
      unknowns: ["Budget"],
      scoringVersion: "purchase-intent@1",
    },
    facts: {
      pain: "Slow callbacks cost him jobs",
      impact: "Four or five missed jobs",
      authority: "John is the owner",
      budget: null,
      timing: "Wants a solution within 30 days",
      currentSolution: null,
      competitors: [],
      decisionProcess: "Partner reviews recurring costs",
    },
    buyingSignals: [],
    objections: [],
    nextAction: "Confirm the joint demo on Wednesday.",
    coaching: [
      {
        kind: "strength",
        area: "price handling",
        observation: "Quantified value before defending price.",
        evidence: [
          {
            eventId: UUID(10),
            segmentId: UUID(20),
            quote: "What is a new customer worth to you?",
            relativeTimeMs: 120000,
          },
        ],
      },
      {
        kind: "improvement",
        area: "decision process",
        observation: "Confirm the decision process explicitly.",
        evidence: [],
      },
    ],
    pipelineRecommendation: {
      targetStage: "qualified",
      reason: "Confirmed pain, impact, authority, and timing.",
    },
    segmentReferences: [UUID(30)],
    scoringVersion: "purchase-intent@1",
    ...overrides,
  };
}

function makeCall(
  id: string,
  overrides: Partial<CallSessionRow> = {}
): CallSessionRow {
  return {
    id,
    user_id: "user-a",
    prospect_id: null,
    sales_profile_id: null,
    mode: "practice",
    scenario: "abc_roofing",
    is_simulated: true,
    status: "completed",
    objective: null,
    timing: null,
    started_at: "2026-08-12T10:00:00Z",
    duration_seconds: 240,
    outcome: "discovery_call",
    opportunity_fit_score: null,
    opportunity_fit_label: null,
    opportunity_fit_explanation: null,
    purchase_intent_score: 70,
    purchase_intent_label: "high",
    purchase_intent_explanation: null,
    evidence: {},
    summary: null,
    next_action: "Confirm the joint demo on Wednesday.",
    pipeline_recommendation: "qualified",
    pipeline_recommendation_reason: null,
    conversation_state: {},
    review_payload: makeReview({}),
    error: null,
    created_at: "2026-08-12T11:00:00Z",
    ...overrides,
  };
}

describe("isEligibleCompletedCall", () => {
  it("accepts a completed call with a valid review payload", () => {
    expect(isEligibleCompletedCall(makeCall(UUID(1)))).toBe(true);
  });

  it("rejects non-completed calls even with a review payload present", () => {
    expect(
      isEligibleCompletedCall(makeCall(UUID(1), { status: "processing" }))
    ).toBe(false);
    expect(
      isEligibleCompletedCall(makeCall(UUID(1), { status: "cancelled" }))
    ).toBe(false);
  });

  it("rejects completed calls without a review payload", () => {
    expect(
      isEligibleCompletedCall(makeCall(UUID(1), { review_payload: null }))
    ).toBe(false);
  });

  it("rejects a completed call whose review payload is not a valid review", () => {
    expect(
      isEligibleCompletedCall(makeCall(UUID(1), { review_payload: { nope: true } }))
    ).toBe(false);
  });
});

describe("coachEligibility — the 3-call gate", () => {
  it("does not unlock at 2 eligible calls (spec: never fabricate a trend)", () => {
    const sessions = [makeCall(UUID(1)), makeCall(UUID(2))];
    const eligibility = coachEligibility(sessions);
    expect(eligibility.eligibleCount).toBe(2);
    expect(eligibility.unlocked).toBe(false);
    expect(eligibility.remaining).toBe(1);
  });

  it("unlocks at exactly 3 eligible calls", () => {
    const sessions = [makeCall(UUID(1)), makeCall(UUID(2)), makeCall(UUID(3))];
    const eligibility = coachEligibility(sessions);
    expect(eligibility.unlocked).toBe(true);
    expect(eligibility.remaining).toBe(0);
    expect(eligibility.threshold).toBe(COACH_ELIGIBLE_CALLS_THRESHOLD);
  });

  it("counts only eligible calls — completed-without-review never counts", () => {
    const sessions = [
      makeCall(UUID(1)),
      makeCall(UUID(2), { review_payload: null }),
      makeCall(UUID(3), { status: "prepared" }),
    ];
    const eligibility = coachEligibility(sessions);
    expect(eligibility.eligibleCount).toBe(1);
    expect(eligibility.unlocked).toBe(false);
  });

  it("selectEligibleCalls returns only the eligible subset", () => {
    const sessions = [
      makeCall(UUID(1)),
      makeCall(UUID(2), { review_payload: null }),
      makeCall(UUID(3)),
    ];
    expect(selectEligibleCalls(sessions).map((s) => s.id)).toEqual([UUID(1), UUID(3)]);
  });
});

describe("parseReviewPayload", () => {
  it("parses a stored review payload (extra preCallStage key is tolerated)", () => {
    const row = makeCall(UUID(1), {
      review_payload: { ...makeReview({}), preCallStage: "contacted" },
    });
    const review = parseReviewPayload(row);
    expect(review).not.toBeNull();
    expect(review?.pipelineRecommendation.targetStage).toBe("qualified");
  });

  it("returns null for garbage payloads", () => {
    const row = makeCall(UUID(1), { review_payload: "not-a-review" });
    expect(parseReviewPayload(row)).toBeNull();
  });
});

describe("aggregateCoachingInsights — deterministic, evidence-based", () => {
  it("aggregates strengths/improvements by area with honest counts", () => {
    const calls = [
      makeCall(UUID(1), {
        review_payload: makeReview({
          coaching: [
            { kind: "strength", area: "price handling", observation: "Quantified value.", evidence: [] },
            { kind: "improvement", area: "decision process", observation: "Confirm process.", evidence: [] },
          ],
        }),
      }),
      makeCall(UUID(2), {
        review_payload: makeReview({
          coaching: [
            { kind: "strength", area: "price handling", observation: "Quantified value.", evidence: [] },
          ],
        }),
      }),
      makeCall(UUID(3), {
        review_payload: makeReview({
          coaching: [
            { kind: "improvement", area: "decision process", observation: "Confirm process.", evidence: [] },
            { kind: "improvement", area: "evidence gathering", observation: "Ask more discovery questions.", evidence: [] },
          ],
        }),
      }),
    ];
    const insights = aggregateCoachingInsights(calls);
    expect(insights.eligibleCount).toBe(3);
    expect(insights.strengths).toHaveLength(1);
    expect(insights.strengths[0].area).toBe("price handling");
    expect(insights.strengths[0].count).toBe(2); // appeared in 2 of 3 calls
    expect(insights.strengths[0].observations).toEqual(["Quantified value."]);
    // Sorted most frequent first, then alphabetically.
    expect(insights.improvements.map((a) => a.area)).toEqual([
      "decision process",
      "evidence gathering",
    ]);
    expect(insights.improvements[0].count).toBe(2);
    expect(insights.improvements[1].count).toBe(1);
  });

  it("carries verbatim evidence quotes with their call's review link", () => {
    const calls = [
      makeCall(UUID(1), {
        review_payload: makeReview({
          coaching: [
            {
              kind: "strength",
              area: "price handling",
              observation: "Quantified value.",
              evidence: [
                { eventId: UUID(10), quote: "What is a new customer worth?", relativeTimeMs: 1000 },
              ],
            },
          ],
        }),
      }),
      makeCall(UUID(2), {
        review_payload: makeReview({
          coaching: [{ kind: "improvement", area: "decision process", observation: "Confirm process.", evidence: [] }],
        }),
      }),
      makeCall(UUID(3), {
        review_payload: makeReview({
          coaching: [{ kind: "improvement", area: "evidence gathering", observation: "Ask more.", evidence: [] }],
        }),
      }),
    ];
    const insights = aggregateCoachingInsights(calls);
    expect(insights.strengths[0].examples).toEqual([
      { callId: UUID(1), quote: "What is a new customer worth?" },
    ]);
  });

  it("aggregates purchase intent labels and pipeline recommendations as counts", () => {
    const calls = [
      makeCall(UUID(1), {
        purchase_intent_label: "high",
        review_payload: makeReview({ purchaseIntent: { ...makeReview({}).purchaseIntent, label: "high" } }),
      }),
      makeCall(UUID(2), {
        purchase_intent_label: "moderate",
        review_payload: makeReview({
          purchaseIntent: {
            ...makeReview({}).purchaseIntent,
            score: 55,
            label: "moderate",
          },
          pipelineRecommendation: { targetStage: "contacted", reason: "Not enough evidence." },
        }),
        pipeline_recommendation: "contacted",
      }),
      makeCall(UUID(3), {
        purchase_intent_label: "high",
        review_payload: makeReview({
          purchaseIntent: { ...makeReview({}).purchaseIntent, label: "high" },
        }),
      }),
    ];
    const insights = aggregateCoachingInsights(calls);
    expect(insights.purchaseIntentLabels).toEqual([
      { label: "high", count: 2 },
      { label: "moderate", count: 1 },
    ]);
    expect(insights.pipelineRecommendations).toEqual([
      { targetStage: "contacted", count: 1 },
      { targetStage: "qualified", count: 2 },
    ]);
  });

  it("returns recent coaching moments for the latest eligible calls (bounded)", () => {
    const calls = [
      makeCall(UUID(4), { created_at: "2026-08-13T11:00:00Z" }),
      makeCall(UUID(3), { created_at: "2026-08-12T11:00:00Z" }),
      makeCall(UUID(2), { created_at: "2026-08-11T11:00:00Z" }),
      makeCall(UUID(1), { created_at: "2026-08-10T11:00:00Z" }),
    ];
    const insights = aggregateCoachingInsights(calls);
    // Callers pass newest-first rows; moments take the latest up to the limit.
    expect(insights.recentMoments.map((m) => m.callId)).toEqual([UUID(4), UUID(3), UUID(2)]);
    expect(insights.recentMoments[0].observations.length).toBeGreaterThan(0);
  });

  it("produces an empty-but-valid result when there is no data (honest empty)", () => {
    const insights = aggregateCoachingInsights([]);
    expect(insights.eligibleCount).toBe(0);
    expect(insights.strengths).toEqual([]);
    expect(insights.improvements).toEqual([]);
    expect(insights.purchaseIntentLabels).toEqual([]);
    expect(insights.pipelineRecommendations).toEqual([]);
    expect(insights.recentMoments).toEqual([]);
  });

  it("ignores calls whose stored review is invalid", () => {
    const calls = [
      makeCall(UUID(1)),
      makeCall(UUID(2), { review_payload: { broken: true } }),
      makeCall(UUID(3)),
    ];
    const insights = aggregateCoachingInsights(calls);
    expect(insights.eligibleCount).toBe(3); // caller already filtered; still, only valid reviews contribute
    // Strengths come only from the two valid reviews (each has 1 strength).
    expect(insights.strengths[0].count).toBe(2);
  });

  it("aggregation is deterministic for identical input", () => {
    const calls = [makeCall(UUID(1)), makeCall(UUID(2)), makeCall(UUID(3))];
    const a = aggregateCoachingInsights(calls);
    const b = aggregateCoachingInsights(calls);
    expect(a).toEqual(b);
  });
});
