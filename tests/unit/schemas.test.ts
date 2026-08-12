import { describe, expect, it } from "vitest";
import {
  CallEventSchema,
  ConversationStateJsonSchema,
  EvidenceItemSchema,
  normalizeConversationStateJson,
  PipelineApplySchema,
  ProspectIdSchema,
  ReviewPayloadSchema,
  SuggestionFeedbackSchema,
  SuggestionSchema,
} from "@/domain/schemas";
import { nextUuid } from "./helpers";

const U = nextUuid;
const validEvent = {
  id: U(),
  segmentId: U(),
  type: "OBJECTION",
  category: "negative",
  confidence: 0.9,
  speaker: "prospect",
  exactEvidence: "That's more than we expected to pay.",
  importance: 8,
  relativeTimeMs: 120_000,
  metadata: {},
};

describe("CallEventSchema", () => {
  it("accepts a valid event", () => {
    expect(CallEventSchema.safeParse(validEvent).success).toBe(true);
  });
  it("rejects every unknown event type", () => {
    for (const bad of ["PRICE_OBJECTION", "SIGNAL", "objection", ""]) {
      const result = CallEventSchema.safeParse({ ...validEvent, type: bad });
      expect(result.success).toBe(false);
    }
  });
  it("rejects unknown category, speaker, and action vocabularies", () => {
    expect(CallEventSchema.safeParse({ ...validEvent, category: "very" }).success).toBe(false);
    expect(CallEventSchema.safeParse({ ...validEvent, speaker: "customer" }).success).toBe(false);
    expect(CallEventSchema.safeParse({ ...validEvent, importance: 11 }).success).toBe(false);
    expect(CallEventSchema.safeParse({ ...validEvent, importance: -1 }).success).toBe(false);
    expect(CallEventSchema.safeParse({ ...validEvent, confidence: 1.5 }).success).toBe(false);
    expect(CallEventSchema.safeParse({ ...validEvent, relativeTimeMs: -5 }).success).toBe(false);
  });
  it("rejects a malformed event id and an empty quote", () => {
    expect(CallEventSchema.safeParse({ ...validEvent, id: "not-a-uuid" }).success).toBe(false);
    expect(CallEventSchema.safeParse({ ...validEvent, exactEvidence: "" }).success).toBe(false);
  });
  it("rejects an invalid segment id but allows absent segment id", () => {
    expect(CallEventSchema.safeParse({ ...validEvent, segmentId: "nope" }).success).toBe(false);
    const { segmentId: _omit, ...noSegment } = validEvent;
    expect(CallEventSchema.safeParse(noSegment).success).toBe(true);
  });
  it("defaults metadata to {} and infers the CallEvent type", () => {
    const { metadata: _omit, ...noMeta } = validEvent;
    const parsed = CallEventSchema.safeParse(noMeta);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.metadata).toEqual({});
  });
});

describe("SuggestionSchema", () => {
  it("accepts a valid suggestion row", () => {
    const row = {
      id: U(),
      callId: U(),
      eventId: U(),
      action: "ASK",
      text: "Ask how they value speed.",
      reason: "Quantify value before defending price.",
      priority: 8,
    };
    expect(SuggestionSchema.safeParse(row).success).toBe(true);
  });
  it("rejects unknown actions and negative priority", () => {
    expect(
      SuggestionSchema.safeParse({ id: U(), action: "PUSH", text: "x", priority: 1 }).success
    ).toBe(false);
    expect(
      SuggestionSchema.safeParse({ id: U(), action: "ASK", text: "x", priority: -1 }).success
    ).toBe(false);
  });
});

describe("EvidenceItemSchema", () => {
  it("accepts a valid evidence item", () => {
    expect(
      EvidenceItemSchema.safeParse({
        id: U(),
        kind: "objection",
        summary: "Price concern of $500",
        quote: "That's more than we expected to pay.",
        eventId: U(),
        segmentId: U(),
        relativeTimeMs: 120_000,
      }).success
    ).toBe(true);
  });
  it("rejects an invented-empty quote and unknown kinds", () => {
    expect(EvidenceItemSchema.safeParse({ id: U(), kind: "pain", summary: "s", quote: "" }).success).toBe(false);
    expect(EvidenceItemSchema.safeParse({ id: U(), kind: "magic", summary: "s", quote: "q" }).success).toBe(false);
  });
});

describe("ConversationStateJsonSchema", () => {
  it("round-trips a full state JSON", () => {
    const json = {
      stage: "discovery",
      interest: "medium",
      pain: { value: "Inconsistent callbacks", evidenceIds: [U()], updatedAtMs: 50_000 },
      impact: null,
      authority: null,
      budget: null,
      timeline: null,
      currentSolution: null,
      nextObjective: null,
      competitors: [],
      objections: [],
      buyingSignals: [],
      version: 3,
    };
    expect(ConversationStateJsonSchema.safeParse(json).success).toBe(true);
  });
  it("rejects unknown stage and interest values", () => {
    const base = { stage: "discovery", interest: "medium", version: 0 };
    expect(ConversationStateJsonSchema.safeParse({ ...base, stage: "qualifying" }).success).toBe(false);
    expect(ConversationStateJsonSchema.safeParse({ ...base, interest: "very" }).success).toBe(false);
  });
  it("normalizes sparse rows (DB default '{}')", () => {
    const empty = normalizeConversationStateJson({});
    expect(empty.stage).toBe("opening");
    expect(empty.interest).toBe("unknown");
    expect(empty.competitors).toEqual([]);
    expect(empty.version).toBe(0);
    expect(normalizeConversationStateJson(null)).toEqual(empty);
  });
  it("rejects a malformed stored row loudly", () => {
    expect(() => normalizeConversationStateJson({ stage: "bogus" })).toThrow();
  });
});

describe("ReviewPayloadSchema", () => {
  it("accepts a valid review payload", () => {
    const payload = {
      outcome: "discovery_call",
      summary: "John confirmed slow callbacks and missed jobs. He wants a solution within 30 days.",
      purchaseIntent: {
        score: 62,
        label: "moderate",
        evidenceCompleteness: 0.71,
        positives: ["Confirmed pain: slow callbacks", "Timeline: within 30 days"],
        risks: ["Unresolved price concern"],
        unknowns: ["budget"],
        scoringVersion: "purchase-intent@1",
      },
      facts: {
        pain: "Inconsistent callbacks",
        impact: "Four or five missed jobs",
        authority: "Owner",
        budget: null,
        timing: "Within 30 days",
        currentSolution: null,
        competitors: [],
        decisionProcess: "Partner reviews recurring costs",
      },
      buyingSignals: [
        { eventId: U(), quote: "I want a solution within 30 days", relativeTimeMs: 300_000 },
      ],
      objections: [
        { eventId: U(), quote: "That's $500 more than expected", relativeTimeMs: 150_000 },
      ],
      nextAction: "Book a joint demo with the partner.",
      coaching: [
        { kind: "strength", area: "discovery", observation: "Quantified value before price.", evidence: [] },
        { kind: "improvement", area: "price handling", observation: "Surface budget earlier.", evidence: [] },
      ],
      pipelineRecommendation: { targetStage: "qualified", reason: "Pain, impact, authority, and timing confirmed." },
      segmentReferences: [U()],
      scoringVersion: "purchase-intent@1",
    };
    expect(ReviewPayloadSchema.safeParse(payload).success).toBe(true);
  });
  it("rejects missing summary, invalid scores, and >3 coaching items", () => {
    const base = {
      outcome: "x",
      summary: "s",
      purchaseIntent: {
        score: 50,
        label: "moderate",
        evidenceCompleteness: 0.5,
        positives: [],
        risks: [],
        unknowns: [],
        scoringVersion: "v",
      },
      facts: { pain: null, impact: null, authority: null, budget: null, timing: null, currentSolution: null, competitors: [], decisionProcess: null },
      buyingSignals: [],
      objections: [],
      nextAction: "n",
      coaching: [{ kind: "strength", area: "a", observation: "o", evidence: [] }],
      pipelineRecommendation: { targetStage: "qualified", reason: "r" },
      segmentReferences: [],
      scoringVersion: "v",
    };
    expect(ReviewPayloadSchema.safeParse({ ...base, summary: "" }).success).toBe(false);
    expect(
      ReviewPayloadSchema.safeParse({ ...base, purchaseIntent: { ...base.purchaseIntent, score: 101 } }).success
    ).toBe(false);
    expect(
      ReviewPayloadSchema.safeParse({ ...base, purchaseIntent: { ...base.purchaseIntent, evidenceCompleteness: 2 } }).success
    ).toBe(false);
    const many = { ...base, coaching: Array.from({ length: 4 }, () => ({ kind: "strength", area: "a", observation: "o", evidence: [] })) };
    expect(ReviewPayloadSchema.safeParse(many).success).toBe(false);
    expect(ReviewPayloadSchema.safeParse({ ...base, coaching: [] }).success).toBe(false);
    expect(
      ReviewPayloadSchema.safeParse({ ...base, pipelineRecommendation: { targetStage: "bogus", reason: "r" } }).success
    ).toBe(false);
  });
});

describe("Route input schemas", () => {
  it("accepts only UUID prospect/call ids", () => {
    expect(ProspectIdSchema.safeParse(U()).success).toBe(true);
    expect(ProspectIdSchema.safeParse("123").success).toBe(false);
    expect(ProspectIdSchema.safeParse(null).success).toBe(false);
  });
  it("validates feedback input", () => {
    expect(SuggestionFeedbackSchema.safeParse({ callId: U(), suggestionId: U(), feedback: "useful" }).success).toBe(true);
    expect(SuggestionFeedbackSchema.safeParse({ callId: U(), suggestionId: U(), feedback: "meh" }).success).toBe(false);
  });
  it("validates pipeline apply input (stages + confirmation flag)", () => {
    expect(
      PipelineApplySchema.safeParse({ prospectId: U(), expectedStage: "contacted", targetStage: "qualified", confirmed: false }).success
    ).toBe(true);
    expect(
      PipelineApplySchema.safeParse({ prospectId: U(), expectedStage: "contacted", targetStage: "nope", confirmed: false }).success
    ).toBe(false);
  });
});
