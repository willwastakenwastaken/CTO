import { describe, expect, it } from "vitest";
import {
  advanceSimulation,
  applySuggestionFeedback,
  cancelSimulation,
  completeSimulation,
  createSimulationSession,
  endSimulation,
  finishAdvance,
  pauseSimulation,
  resetSimulation,
  resumeSimulation,
  startSimulation,
} from "@/domain/simulation/engine";
import type { SimulationScenario } from "@/domain/simulation/types";
import { abcRoofingScenario } from "@/providers/simulation/abc-roofing";
import { nextUuid } from "./helpers";
import { runAbcFixture, T0 } from "./simulation-helpers";

function miniScenario(turns: SimulationScenario["turns"]): SimulationScenario {
  return {
    id: nextUuid(),
    label: "mini",
    simulated: true,
    prospectName: "P",
    prospectCompany: "C",
    summary: "mini",
    callObjective: "discover",
    turns,
  };
}

function freshSession() {
  return createSimulationSession({ callId: nextUuid(), scenarioId: abcRoofingScenario.id });
}

describe("simulation engine — start", () => {
  it("prepared -> live and sets started_at exactly once", () => {
    const session = freshSession();
    const first = startSimulation(session, T0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.session.status).toBe("live");
    expect(first.value.startedAtSet).toBe(true);
    expect(first.value.session.startedAtMs).toBe(T0);

    // Re-starting is an idempotent no-op; started_at is NOT overwritten.
    const second = startSimulation(first.value.session, T0 + 60_000);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.startedAtSet).toBe(false);
    expect(second.value.session.startedAtMs).toBe(T0);
  });

  it("rejects starting a call that is not prepared/live", () => {
    let session = freshSession();
    const started = startSimulation(session, T0);
    if (!started.ok) throw new Error(started.error.message);
    session = started.value.session;
    const ended = endSimulation(session, T0 + 10_000);
    if (!ended.ok) throw new Error(ended.error.message);
    const result = startSimulation(ended.value, T0 + 20_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("INVALID_STATE");
  });
});

describe("simulation engine — advance", () => {
  it("reveals the next ordered segment with a deterministic id", () => {
    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;

    const result = advanceSimulation(session, abcRoofingScenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { plan } = result.value;
    expect(plan.cursor).toBe(0);
    expect(plan.segment.sequence).toBe(0);
    expect(plan.segment.text).toBe(abcRoofingScenario.turns[0].text);
    expect(plan.segment.speaker).toBe("rep");
    expect(plan.segment.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.value.session.revealedTurnCount).toBe(1);
    expect(result.value.session.advanceInFlight).toBe(true);
  });

  it("persists the segment before deriving events: events carry the segment id and verbatim evidence", () => {
    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;

    // Turn 3 (slow-callbacks) declares a PAIN_DISCOVERED event.
    for (let i = 0; i < 3; i += 1) {
      const r = advanceSimulation(session, abcRoofingScenario);
      if (!r.ok) throw new Error(r.error.message);
      session = finishAdvance(r.value.session, r.value.plan.segment.relativeTimeMs);
    }
    const result = advanceSimulation(session, abcRoofingScenario);
    if (!result.ok) throw new Error(result.error.message);
    const { plan } = result.value;
    expect(plan.events.length).toBe(1);
    const event = plan.events[0];
    expect(event.segmentId).toBe(plan.segment.id); // derived FROM the persisted segment
    expect(event.type).toBe("PAIN_DISCOVERED");
    expect(event.exactEvidence).toBe(plan.segment.text); // verbatim quote
    expect(event.speaker).toBe("prospect");
    expect(event.relativeTimeMs).toBe(plan.segment.relativeTimeMs);
    expect(event.metadata).toEqual({ facet: "pain" });
  });

  it("updates conversation state with evidence ids", () => {
    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;
    for (let i = 0; i < 3; i += 1) {
      const r = advanceSimulation(session, abcRoofingScenario);
      if (!r.ok) throw new Error(r.error.message);
      session = finishAdvance(r.value.session, r.value.plan.segment.relativeTimeMs);
    }
    const result = advanceSimulation(session, abcRoofingScenario);
    if (!result.ok) throw new Error(result.error.message);
    const { plan } = result.value;
    expect(plan.nextState.pain).not.toBeNull();
    expect(plan.nextState.pain?.evidenceIds).toContain(plan.events[0].id);
    expect(plan.nextState.version).toBeGreaterThan(0);
  });

  it("rejects advancement while an advance is in flight (no double advancement)", () => {
    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;

    const first = advanceSimulation(session, abcRoofingScenario);
    if (!first.ok) throw new Error(first.error.message);
    const inFlight = first.value.session;
    expect(inFlight.advanceInFlight).toBe(true);

    const second = advanceSimulation(inFlight, abcRoofingScenario);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.category).toBe("ADVANCE_IN_FLIGHT");

    const finished = finishAdvance(inFlight, T0);
    expect(finished.advanceInFlight).toBe(false);
    const next = advanceSimulation(finished, abcRoofingScenario);
    expect(next.ok).toBe(true);
  });

  it("replaying an advance is deterministic: identical plan ids (upserts no-op)", () => {
    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;
    for (let i = 0; i < 3; i += 1) {
      const r = advanceSimulation(session, abcRoofingScenario);
      if (!r.ok) throw new Error(r.error.message);
      session = finishAdvance(r.value.session, r.value.plan.segment.relativeTimeMs);
    }
    // Replay: run the same advance twice from the SAME session state.
    const a = advanceSimulation(session, abcRoofingScenario);
    const b = advanceSimulation(session, abcRoofingScenario);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.value.plan.segment.id).toBe(b.value.plan.segment.id);
    expect(a.value.plan.events.map((e) => e.id)).toEqual(b.value.plan.events.map((e) => e.id));
    const sugId = (p: typeof a.value.plan) =>
      p.suggestionOp.kind === "create" ? p.suggestionOp.suggestion.id : null;
    expect(sugId(a.value.plan)).toBe(sugId(b.value.plan));
  });

  it("rejects advancement before start and while paused", () => {
    const prepared = freshSession();
    const before = advanceSimulation(prepared, abcRoofingScenario);
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.error.category).toBe("NOT_LIVE");

    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;
    const paused = pauseSimulation(session);
    if (!paused.ok) throw new Error(paused.error.message);
    const during = advanceSimulation(paused.value, abcRoofingScenario);
    expect(during.ok).toBe(false);
    if (!during.ok) expect(during.error.category).toBe("NOT_LIVE");
  });

  it("returns END_OF_SCENARIO once every turn is revealed", () => {
    const { session } = runAbcFixture();
    const result = advanceSimulation(session, abcRoofingScenario);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("END_OF_SCENARIO");
  });
});

describe("simulation engine — controls", () => {
  it("pause/resume only while live", () => {
    const prepared = freshSession();
    const p1 = pauseSimulation(prepared);
    expect(p1.ok).toBe(false);

    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;

    const paused = pauseSimulation(session);
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.value.paused).toBe(true);

    const doublePause = pauseSimulation(paused.value);
    expect(doublePause.ok).toBe(false);

    const resumed = resumeSimulation(paused.value);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.paused).toBe(false);

    const doubleResume = resumeSimulation(resumed.value);
    expect(doubleResume.ok).toBe(false);
  });

  it("end -> processing -> completed; ended_at set once", () => {
    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;

    const ended = endSimulation(session, T0 + 30_000);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.value.status).toBe("processing");
    expect(ended.value.endedAtMs).toBe(T0 + 30_000);

    const complete = completeSimulation(ended.value, T0 + 31_000);
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    expect(complete.value.status).toBe("completed");
    expect(complete.value.endedAtMs).toBe(T0 + 30_000); // unchanged
  });

  it("rejects ending while an advance is in flight", () => {
    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;
    const advancing = advanceSimulation(session, abcRoofingScenario);
    if (!advancing.ok) throw new Error(advancing.error.message);
    const ended = endSimulation(advancing.value.session, T0 + 5_000);
    expect(ended.ok).toBe(false);
    if (!ended.ok) expect(ended.error.category).toBe("ADVANCE_IN_FLIGHT");
  });

  it("cancels from prepared or live", () => {
    const prepared = cancelSimulation(freshSession(), T0);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.status).toBe("cancelled");

    const session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    const cancelled = cancelSimulation(start.value.session, T0 + 5_000);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.value.status).toBe("cancelled");
  });

  it("restart is a deliberate reset: fresh prepared session under a new call id", () => {
    const { session } = runAbcFixture();
    const newCallId = nextUuid();
    const fresh = resetSimulation(session, newCallId);
    expect(fresh.callId).toBe(newCallId);
    expect(fresh.status).toBe("prepared");
    expect(fresh.revealedTurnCount).toBe(0);
    expect(fresh.startedAtMs).toBeNull();
    expect(fresh.paused).toBe(false);
    expect(fresh.advanceInFlight).toBe(false);
    expect(fresh.suggestions).toEqual([]);
    expect(fresh.activeSuggestionId).toBeNull();
    expect(fresh.conversationState.version).toBe(0);
    // The old session is untouched (history preserved).
    expect(session.status).toBe("live");
    expect(session.revealedTurnCount).toBe(abcRoofingScenario.turns.length);
  });
});

describe("simulation engine — feedback", () => {
  it("records useful/not_useful feedback with usedAt; dismiss is not feedback", () => {
    const scenario = miniScenario([
      {
        key: "q",
        speaker: "prospect",
        text: "How does it work?",
        relativeTimeMs: 5_000,
        events: [{ type: "QUESTION" }],
      },
    ]);
    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;
    const result = advanceSimulation(session, scenario, 5_000);
    if (!result.ok) throw new Error(result.error.message);
    session = finishAdvance(result.value.session, 5_000);
    const suggestion = result.value.plan.suggestionOp;
    if (suggestion.kind !== "create") throw new Error("expected suggestion");

    const used = applySuggestionFeedback(session, suggestion.suggestion.id, "useful", T0 + 5_000);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const record = used.value.suggestions.find((s) => s.id === suggestion.suggestion.id);
    expect(record?.usedAtMs).toBe(T0 + 5_000);
    expect(record?.feedback).toBe("useful");
    expect(used.value.activeSuggestionId).toBeNull();

    const dismissed = applySuggestionFeedback(
      used.value,
      suggestion.suggestion.id,
      "dismiss",
      T0 + 6_000
    );
    // Re-applying feedback after use is still ok; dismiss records dismissedAt.
    if (!dismissed.ok) throw new Error(dismissed.error.message);
    const dismissedRecord = dismissed.value.suggestions.find(
      (s) => s.id === suggestion.suggestion.id
    );
    expect(dismissedRecord?.dismissedAtMs).toBe(T0 + 6_000);
    expect(dismissedRecord?.feedback).toBe("useful"); // dismissal never erases feedback
  });
});

describe("simulation engine — suggestion expiry & supersession", () => {
  it("a strictly higher priority suggestion supersedes the active one (history kept)", () => {
    const scenario = miniScenario([
      {
        key: "price",
        speaker: "prospect",
        text: "$500 is more than I expected.",
        relativeTimeMs: 45_000,
        events: [{ type: "PRICE_DISCUSSION", metadata: { isConcern: true } }],
      },
      {
        key: "question",
        speaker: "prospect",
        text: "How does onboarding work?",
        relativeTimeMs: 75_000,
        events: [{ type: "QUESTION" }],
      },
    ]);
    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;

    const first = advanceSimulation(session, scenario, 45_000);
    if (!first.ok) throw new Error(first.error.message);
    const ask = first.value.plan.suggestionOp;
    expect(ask.kind).toBe("create");
    if (ask.kind !== "create") return;
    expect(ask.suggestion.action).toBe("ASK");
    session = finishAdvance(first.value.session, 45_000);

    const second = advanceSimulation(session, scenario, 75_000);
    if (!second.ok) throw new Error(second.error.message);
    const say = second.value.plan.suggestionOp;
    expect(say.kind).toBe("create");
    if (say.kind !== "create") return;
    expect(say.suggestion.action).toBe("SAY");
    expect(say.suggestion.supersedesId).toBe(ask.suggestion.id);

    // History preserved: both rows remain; the old one is marked superseded.
    const inFlight = second.value.session;
    const askRecord = inFlight.suggestions.find((s) => s.id === ask.suggestion.id);
    expect(askRecord?.supersededBy).toBe(say.suggestion.id);
    expect(inFlight.suggestions.length).toBe(2);
    expect(inFlight.activeSuggestionId).toBe(say.suggestion.id);
  });

  it("an expired suggestion stops being active but stays in history", () => {
    const scenario = miniScenario([
      {
        key: "question",
        speaker: "prospect",
        text: "How does onboarding work?",
        relativeTimeMs: 5_000,
        events: [{ type: "QUESTION" }],
      },
      {
        key: "signal",
        speaker: "prospect",
        text: "This would help us a lot.",
        relativeTimeMs: 100_000,
        events: [{ type: "BUYING_SIGNAL" }],
      },
    ]);
    let session = freshSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;

    const first = advanceSimulation(session, scenario, 5_000);
    if (!first.ok) throw new Error(first.error.message);
    const say = first.value.plan.suggestionOp;
    expect(say.kind).toBe("create");
    if (say.kind !== "create") return;
    expect(say.suggestion.expiresAtMs).toBe(5_000 + 90_000); // 90s TTL
    session = finishAdvance(first.value.session, 5_000);

    // At 100s the SAY (expires 95s) has expired -> the buying signal fires.
    const second = advanceSimulation(session, scenario, 100_000);
    if (!second.ok) throw new Error(second.error.message);
    const signal = second.value.plan.suggestionOp;
    expect(signal.kind).toBe("create");
    if (signal.kind !== "create") return;
    expect(signal.suggestion.action).toBe("DO_NOT_PUSH");
    const inFlight = second.value.session;
    expect(inFlight.suggestions.length).toBe(2); // expired one NOT deleted
    expect(inFlight.activeSuggestionId).toBe(signal.suggestion.id);
  });
});
