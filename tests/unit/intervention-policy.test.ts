import { describe, expect, it } from "vitest";
import {
  buildCandidate,
  COOLDOWN_MS,
  evaluateIntervention,
  isNearDuplicate,
  isSuggestionActive,
  tokenSimilarity,
  violatesGuardrails,
  type InterventionInput,
} from "@/domain/coaching/intervention-policy";
import { createConversationState, applyEvent } from "@/domain/conversation-state/state";
import type { SuggestionInput } from "@/domain/coaching/types";
import type { TranscriptSegment } from "@/domain/transcript/types";
import { makeEvent } from "./helpers";

function segment(
  id: string,
  speaker: TranscriptSegment["speaker"],
  text: string,
  relativeTimeMs: number
): TranscriptSegment {
  return { id, sequence: 0, speaker, text, relativeTimeMs, confidence: 0.95, isFinal: true };
}

function prev(
  id: string,
  action: SuggestionInput["action"],
  text: string,
  createdAtMs: number,
  priority = 5
): SuggestionInput {
  return { id, action, text, reason: null, priority, createdAtMs };
}

function baseInput(overrides: Partial<InterventionInput>): InterventionInput {
  return {
    event: makeEvent("PAIN_DISCOVERED", "prospect", "Callbacks are really slow."),
    state: createConversationState(),
    recentTranscript: [segment("s1", "prospect", "Callbacks are really slow.", 10_000)],
    currentSuggestion: null,
    previousSuggestions: [],
    callObjective: "Discover the impact of slow callbacks",
    guardrails: [],
    nowMs: 60_000,
    ...overrides,
  };
}

describe("intervention policy — preference order", () => {
  it("answers a timely prospect question first", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("QUESTION", "prospect", "How does onboarding work?", { relativeTimeMs: 30_000 }),
        recentTranscript: [segment("s1", "prospect", "How does onboarding work?", 30_000)],
      })
    );
    expect(decision.mode).toBe("suggestion");
    expect(decision.suggestion?.action).toBe("SAY");
    expect(decision.suggestion?.priority).toBe(10);
  });

  it("ignores rep questions (the rep is driving)", () => {
    const decision = evaluateIntervention(
      baseInput({ event: makeEvent("QUESTION", "rep", "How important is speed?") })
    );
    expect(decision.mode).toBe("listening");
    expect(decision.suggestion).toBeNull();
  });

  it("handles a price concern with a value question, never a discount", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("PRICE_DISCUSSION", "prospect", "$500 is more than expected.", {
          metadata: { isConcern: true },
        }),
      })
    );
    expect(decision.suggestion?.action).toBe("ASK");
    expect(decision.suggestion?.text.toLowerCase()).toContain("value");
    expect(decision.suggestion?.text.toLowerCase()).not.toContain("discount");
  });

  it("clarifies non-price objections", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("OBJECTION", "prospect", "We are happy with the current vendor."),
      })
    );
    expect(decision.suggestion?.action).toBe("CLARIFY");
  });

  it("asks about the missed discovery dimension", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("MISSED_DISCOVERY", "system", "Budget never explored.", {
          metadata: { dimension: "budget" },
        }),
      })
    );
    expect(decision.suggestion?.action).toBe("ASK");
    expect(decision.suggestion?.text).toContain("budget");
  });

  it("returns a buying-signal suggestion (confirm without pushing)", () => {
    const decision = evaluateIntervention(
      baseInput({ event: makeEvent("BUYING_SIGNAL", "prospect", "We want this soon.") })
    );
    expect(decision.suggestion?.action).toBe("DO_NOT_PUSH");
  });

  it("can return NO suggestion (calm listening)", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("QUESTION", "rep", "Shall we continue?"),
      })
    );
    expect(decision.mode).toBe("listening");
    expect(decision.suggestion).toBeNull();
    expect(decision.matchedEventId).toBeNull();
  });
});

describe("intervention policy — LISTEN behavior", () => {
  it("says LISTEN while the prospect is sharing useful pain detail", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("PAIN_DISCOVERED", "prospect", "We miss four or five jobs a month.", {
          relativeTimeMs: 12_000,
        }),
        recentTranscript: [
          segment("s1", "prospect", "It has been like this for a while.", 8_000),
          segment("s2", "prospect", "We miss four or five jobs a month.", 12_000),
        ],
      })
    );
    expect(decision.suggestion?.action).toBe("LISTEN");
    expect(decision.suggestion?.text.toLowerCase()).toContain("listening");
  });

  it("explores impact instead of LISTEN when the prospect is not elaborating", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("PAIN_DISCOVERED", "prospect", "Callbacks are slow.", { relativeTimeMs: 20_000 }),
        recentTranscript: [segment("s1", "rep", "Tell me more about the callbacks.", 21_000)],
      })
    );
    expect(decision.suggestion?.action).toBe("ASK");
  });

  it("never LISTENs on rep-spoken pain events", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("PAIN_DISCOVERED", "rep", "So callbacks are the issue.", { relativeTimeMs: 12_000 }),
        recentTranscript: [segment("s1", "prospect", "Yes.", 12_000)],
      })
    );
    expect(decision.suggestion).toBeNull();
  });
});

describe("intervention policy — cooldown", () => {
  it("stays quiet within the cooldown window", () => {
    const decision = evaluateIntervention(
      baseInput({
        previousSuggestions: [prev("p1", "ASK", "Explore the impact of the pain.", 10_000, 7)],
        nowMs: 10_000 + COOLDOWN_MS - 1_000,
      })
    );
    expect(decision.mode).toBe("listening");
    expect(decision.reason).toContain("cooldown");
  });

  it("speaks after the cooldown window", () => {
    const decision = evaluateIntervention(
      baseInput({
        previousSuggestions: [prev("p1", "ASK", "Explore the impact of the pain.", 10_000, 7)],
        nowMs: 10_000 + COOLDOWN_MS + 1_000,
      })
    );
    expect(decision.mode).toBe("suggestion");
  });

  it("lets a timely prospect question break the cooldown", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("QUESTION", "prospect", "How does onboarding work?", { relativeTimeMs: 30_000 }),
        previousSuggestions: [prev("p1", "ASK", "Explore the impact of the pain.", 10_000, 7)],
        nowMs: 15_000, // inside cooldown
      })
    );
    expect(decision.mode).toBe("suggestion");
    expect(decision.suggestion?.action).toBe("SAY");
  });
});

describe("intervention policy — one active suggestion, supersession, expiry", () => {
  const active: SuggestionInput = {
    id: "active-1",
    action: "ASK",
    text: "Explore the impact of the pain.",
    reason: null,
    priority: 7,
    createdAtMs: 10_000,
  };

  it("keeps an equal-or-lower active suggestion", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("BUYING_SIGNAL", "prospect", "We want this soon."), // priority 6 < 7
        currentSuggestion: active,
        nowMs: 20_000,
      })
    );
    expect(decision.mode).toBe("listening");
    expect(decision.reason).toContain("active suggestion");
  });

  it("supersedes an active suggestion with a strictly higher priority (history kept)", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("QUESTION", "prospect", "How does onboarding work?", { relativeTimeMs: 30_000 }), // priority 10
        currentSuggestion: active,
        nowMs: 20_000,
      })
    );
    expect(decision.mode).toBe("suggestion");
    expect(decision.suggestion?.supersedesId).toBe("active-1");
  });

  it("treats an expired suggestion as inactive", () => {
    const expired: SuggestionInput = { ...active, expiresAtMs: 15_000 };
    const decision = evaluateIntervention(
      baseInput({
        currentSuggestion: expired,
        nowMs: 60_000, // past cooldown (active.createdAtMs = 10_000) and past expiry
      })
    );
    expect(decision.mode).toBe("suggestion");
  });

  it("isSuggestionActive respects dismissal, use, and expiry", () => {
    const base = prev("x", "ASK", "text", 0);
    expect(isSuggestionActive(base, 1_000)).toBe(true);
    expect(isSuggestionActive({ ...base, dismissedAtMs: 500 }, 1_000)).toBe(false);
    expect(isSuggestionActive({ ...base, usedAtMs: 500 }, 1_000)).toBe(false);
    expect(isSuggestionActive({ ...base, expiresAtMs: 500 }, 1_000)).toBe(false);
  });
});

describe("intervention policy — repetition suppression", () => {
  it("suppresses a near-duplicate of a recent suggestion", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("PRICE_DISCUSSION", "prospect", "$500 is more than expected.", {
          metadata: { isConcern: true },
        }),
        previousSuggestions: [
          prev("p1", "ASK", "Ask how they value speed — quantify value before discussing price.", 5_000, 8),
        ],
        nowMs: 60_000,
      })
    );
    // price concern again -> same value-question advice -> suppressed
    expect(decision.mode).toBe("listening");
    expect(decision.reason).toContain("Near-duplicate");
  });

  it("tokenSimilarity and isNearDuplicate behave deterministically", () => {
    expect(tokenSimilarity("ask about value", "ask about value")).toBe(1);
    expect(tokenSimilarity("ask about value", "ask about budget")).toBe(0.5);
    expect(tokenSimilarity("discuss price", "explore timeline")).toBe(0);
    const cand = {
      action: "ASK" as const,
      text: "Ask how they value speed.",
      reason: "Quantify value before defending price.",
      priority: 8,
      eventId: "e1",
      expiresAtMs: 90_000,
    };
    expect(
      isNearDuplicate(cand, [prev("p1", "ASK", "Ask how they value speed. Quantify value before defending price.", 0)])
    ).toBe(true);
    expect(isNearDuplicate(cand, [prev("p1", "CLARIFY", "Clarify the concern.", 0)])).toBe(false);
  });

  it("does not suppress advice that is genuinely different", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("OBJECTION", "prospect", "We are happy with the current vendor."),
        previousSuggestions: [prev("p1", "ASK", "Ask how they value speed.", 5_000, 8)],
        nowMs: 60_000,
      })
    );
    expect(decision.mode).toBe("suggestion");
    expect(decision.suggestion?.action).toBe("CLARIFY");
  });
});

describe("intervention policy — guardrails", () => {
  it("never emits a suggestion that violates a guardrail", () => {
    const bad = {
      action: "SAY" as const,
      text: "We can offer a 10% discount today.",
      reason: "Close the deal.",
      priority: 9,
      eventId: "e1",
      expiresAtMs: 90_000,
    };
    expect(violatesGuardrails(bad, ["no unauthorized discounts"])).toBe(true);
    expect(violatesGuardrails(bad, ["no ROI guarantees"])).toBe(false);
    expect(
      violatesGuardrails(
        { ...bad, text: "Ask how they value speed." },
        ["no unauthorized discounts"]
      )
    ).toBe(false);
  });

  it("price handling stays a value question even with discount guardrails", () => {
    const decision = evaluateIntervention(
      baseInput({
        event: makeEvent("PRICE_DISCUSSION", "prospect", "$500 is more than expected.", {
          metadata: { isConcern: true },
        }),
        guardrails: ["no unauthorized discounts", "no ROI guarantees"],
      })
    );
    expect(decision.mode).toBe("suggestion");
    expect(decision.suggestion?.text.toLowerCase()).not.toContain("discount");
    expect(decision.suggestion?.text.toLowerCase()).not.toContain("roi");
  });
});

describe("intervention policy — state integration", () => {
  it("emits a suggestion from the event AND the conversation state agrees", () => {
    let state = createConversationState();
    const event = makeEvent("BUYING_SIGNAL", "prospect", "We want this by next month.");
    state = applyEvent(state, event);
    const decision = evaluateIntervention(baseInput({ event, state }));
    expect(decision.suggestion?.action).toBe("DO_NOT_PUSH");
    expect(state.buyingSignals).toHaveLength(1);
    expect(state.interest).toBe("high");
  });

  it("buildCandidate exposes deterministic drafts for every event type", () => {
    const types = ["OBJECTION", "QUESTION", "BUYING_SIGNAL", "PRICE_DISCUSSION", "COMPETITOR_MENTION", "PAIN_DISCOVERED", "AUTHORITY_SIGNAL", "TIMELINE_SIGNAL", "MISSED_DISCOVERY"] as const;
    const ctx = { state: createConversationState(), recentTranscript: [] as TranscriptSegment[], callObjective: null };
    for (const type of types) {
      const event = makeEvent(type, "prospect", `evidence for ${type}`);
      const candidate = buildCandidate(event, ctx);
      expect(candidate === null || typeof candidate.text === "string").toBe(true);
      expect(candidate === null || candidate.priority > 0).toBe(true);
    }
  });
});
