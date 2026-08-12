import { describe, expect, it } from "vitest";
import {
  applyEvent,
  applyEvents,
  createConversationState,
  fromJson,
  retractEvidence,
  setStage,
  toJson,
} from "@/domain/conversation-state/state";
import { makeEvent } from "./helpers";

describe("conversation state — evidence-linked facts", () => {
  it("records pain with its evidence id", () => {
    const state = createConversationState();
    const event = makeEvent("PAIN_DISCOVERED", "prospect", "We keep missing callbacks.");
    const next = applyEvent(state, event);
    expect(next.pain?.value).toBe("We keep missing callbacks.");
    expect(next.pain?.evidenceIds).toEqual([event.id]);
    expect(next.version).toBeGreaterThan(state.version);
  });

  it("accumulates evidence ids when the same fact is reinforced", () => {
    let state = createConversationState();
    const e1 = makeEvent("PAIN_DISCOVERED", "prospect", "Callbacks are slow.");
    const e2 = makeEvent("PAIN_DISCOVERED", "prospect", "Callbacks are slow.", { relativeTimeMs: 30_000 });
    state = applyEvent(state, e1);
    state = applyEvent(state, e2);
    expect(state.pain?.evidenceIds).toEqual([e1.id, e2.id]);
  });
});

describe("conversation state — corrections outrank earlier statements", () => {
  it("replaces the value but preserves evidence history", () => {
    let state = createConversationState();
    const e1 = makeEvent("AUTHORITY_SIGNAL", "prospect", "My manager decides.", { relativeTimeMs: 10_000 });
    const e2 = makeEvent("AUTHORITY_SIGNAL", "prospect", "Actually I am the owner.", { relativeTimeMs: 60_000 });
    state = applyEvent(state, e1);
    state = applyEvent(state, e2);
    expect(state.authority?.value).toBe("Actually I am the owner.");
    expect(state.authority?.evidenceIds).toEqual([e1.id, e2.id]);
    expect(state.authority?.updatedAtMs).toBe(60_000);
  });
});

describe("conversation state — rep statements can NEVER confirm prospect facts", () => {
  it("ignores prospect-fact events spoken by the rep", () => {
    let state = createConversationState();
    const repPain = makeEvent("PAIN_DISCOVERED", "rep", "It sounds like callbacks are slow.");
    const repBuying = makeEvent("BUYING_SIGNAL", "rep", "They seem very interested.");
    const repObjection = makeEvent("OBJECTION", "rep", "The price concern is $500.");
    state = applyEvent(state, repPain);
    state = applyEvent(state, repBuying);
    state = applyEvent(state, repObjection);
    expect(state.pain).toBeNull();
    expect(state.buyingSignals).toEqual([]);
    expect(state.objections).toEqual([]);
    expect(state.version).toBe(0);
  });

  it("treats a rep QUESTION as a no-op", () => {
    const state = applyEvent(
      createConversationState(),
      makeEvent("QUESTION", "rep", "How important is speed?")
    );
    expect(state.version).toBe(0);
  });
});

describe("conversation state — event type mutations", () => {
  it("adds objections, buying signals, and competitors to their lists", () => {
    let state = createConversationState();
    state = applyEvent(state, makeEvent("OBJECTION", "prospect", "Too expensive."));
    state = applyEvent(state, makeEvent("BUYING_SIGNAL", "prospect", "We want this by next month."));
    state = applyEvent(state, makeEvent("COMPETITOR_MENTION", "prospect", "We already use CompetitorCo."));
    expect(state.objections.map((o) => o.value)).toEqual(["Too expensive."]);
    expect(state.buyingSignals.map((b) => b.value)).toEqual(["We want this by next month."]);
    expect(state.competitors.map((c) => c.value)).toEqual(["We already use CompetitorCo."]);
  });

  it("maps a price discussion to an objection entry when it is a concern", () => {
    let state = createConversationState();
    state = applyEvent(
      state,
      makeEvent("PRICE_DISCUSSION", "prospect", "$500 is more than expected.", {
        metadata: { isConcern: true },
      })
    );
    expect(state.objections[0]?.value).toBe("Price concern: $500 is more than expected.");
  });

  it("ignores a neutral price mention (not a concern)", () => {
    const state = applyEvent(
      createConversationState(),
      makeEvent("PRICE_DISCUSSION", "prospect", "We have a budget line for this.", {
        metadata: { isConcern: false },
      })
    );
    expect(state.objections).toEqual([]);
  });

  it("tracks impact separately when the facet says impact", () => {
    const state = applyEvent(
      createConversationState(),
      makeEvent("PAIN_DISCOVERED", "prospect", "We miss four or five jobs.", {
        metadata: { facet: "impact" },
      })
    );
    expect(state.impact?.value).toBe("We miss four or five jobs.");
    expect(state.pain).toBeNull();
  });

  it("sets authority, timeline, and next objective", () => {
    let state = createConversationState();
    state = applyEvent(state, makeEvent("AUTHORITY_SIGNAL", "prospect", "I am the owner."));
    state = applyEvent(state, makeEvent("TIMELINE_SIGNAL", "prospect", "We need this in 30 days."));
    state = applyEvent(
      state,
      makeEvent("MISSED_DISCOVERY", "system", "Rep did not explore budget.", {
        metadata: { dimension: "budget" },
      })
    );
    expect(state.authority?.value).toBe("I am the owner.");
    expect(state.timeline?.value).toBe("We need this in 30 days.");
    expect(state.nextObjective?.value).toBe("Explore budget");
  });

  it("bumps interest from buying signals and pain, never from rep events", () => {
    let state = createConversationState();
    expect(state.interest).toBe("unknown");
    state = applyEvent(state, makeEvent("PAIN_DISCOVERED", "prospect", "It hurts."));
    expect(state.interest).toBe("medium");
    state = applyEvent(state, makeEvent("BUYING_SIGNAL", "prospect", "Let us move fast."));
    expect(state.interest).toBe("high");
    const again = applyEvent(state, makeEvent("BUYING_SIGNAL", "prospect", "We are ready."));
    expect(again.interest).toBe("high");
  });
});

describe("conversation state — missing evidence never erases facts", () => {
  it("retractEvidence removes the id but keeps the value", () => {
    let state = createConversationState();
    const e1 = makeEvent("PAIN_DISCOVERED", "prospect", "Callbacks are slow.");
    state = applyEvent(state, e1);
    expect(state.pain?.value).toBe("Callbacks are slow.");
    state = retractEvidence(state, e1.id);
    expect(state.pain?.value).toBe("Callbacks are slow.");
    expect(state.pain?.evidenceIds).toEqual([]);
  });

  it("leaves the state untouched when nothing references the id", () => {
    const state = createConversationState();
    const next = retractEvidence(state, "11111111-1111-4111-8111-111111111111");
    expect(next).toBe(state);
  });
});

describe("conversation state — batching, stage, JSON round-trip", () => {
  it("applyEvents applies in order", () => {
    const events = [
      makeEvent("PAIN_DISCOVERED", "prospect", "Pain A."),
      makeEvent("OBJECTION", "prospect", "Price."),
      makeEvent("BUYING_SIGNAL", "prospect", "Signal."),
    ];
    const state = applyEvents(createConversationState(), events);
    expect(state.pain?.value).toBe("Pain A.");
    expect(state.objections).toHaveLength(1);
    expect(state.buyingSignals).toHaveLength(1);
    // pain, interest bump (medium), objection, buying signal, interest bump (high)
    expect(state.version).toBe(5);
  });

  it("setStage advances and is a no-op when unchanged", () => {
    const state = createConversationState();
    const next = setStage(state, "discovery");
    expect(next.stage).toBe("discovery");
    expect(setStage(next, "discovery")).toBe(next);
  });

  it("toJson/fromJson round-trips fully", () => {
    let state = createConversationState();
    state = applyEvent(state, makeEvent("PAIN_DISCOVERED", "prospect", "Pain."));
    state = applyEvent(state, makeEvent("BUYING_SIGNAL", "prospect", "Signal."));
    state = setStage(state, "discovery");
    const json = toJson(state);
    expect(json.stage).toBe("discovery");
    expect(json.pain?.evidenceIds).toHaveLength(1);
    const hydrated = fromJson(json);
    expect(hydrated.pain?.value).toBe("Pain.");
    expect(hydrated.buyingSignals).toHaveLength(1);
    expect(hydrated.version).toBe(state.version);
  });

  it("fromJson tolerates an empty stored object", () => {
    const state = fromJson({});
    expect(state.stage).toBe("opening");
    expect(state.interest).toBe("unknown");
    expect(state.version).toBe(0);
  });
});
