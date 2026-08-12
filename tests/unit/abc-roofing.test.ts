import { describe, expect, it } from "vitest";
import {
  advanceSimulation,
  applySuggestionFeedback,
  endSimulation,
  finishAdvance,
  startSimulation,
} from "@/domain/simulation/engine";
import { buildReview } from "@/domain/review/build-review";
import { abcRoofingScenario } from "@/providers/simulation/abc-roofing";
import type { AdvancePlan, SimulationSession } from "@/domain/simulation/types";
import { createTestSession, runAbcFixture, T0 } from "./simulation-helpers";

/** Runs the fixture and marks the joint-demo suggestion useful right before
 * the final (Wednesday) turn, so "confirm without pushing" can fire. */
function runFixtureWithFeedback(): {
  session: SimulationSession;
  plans: AdvancePlan[];
} {
  let session = createTestSession();
  const start = startSimulation(session, T0);
  if (!start.ok) throw new Error(start.error.message);
  session = start.value.session;

  const plans: AdvancePlan[] = [];
  const total = abcRoofingScenario.turns.length;
  for (let i = 0; i < total; i += 1) {
    const result = advanceSimulation(session, abcRoofingScenario);
    if (!result.ok) throw new Error(result.error.message);
    plans.push(result.value.plan);
    session = finishAdvance(result.value.session, result.value.plan.segment.relativeTimeMs);
    if (i === 21) {
      // After "check-with-partner": the rep used the joint-demo recommendation.
      const demo = session.suggestions.find((s) => s.text.toLowerCase().includes("joint demo"));
      expect(demo).toBeDefined();
      if (!demo) throw new Error("no joint-demo suggestion");
      const fb = applySuggestionFeedback(session, demo.id, "useful", T0 + 220_000);
      if (!fb.ok) throw new Error(fb.error.message);
      session = fb.value;
    }
  }
  return { session, plans };
}

describe("ABC Roofing fixture — deterministic beats", () => {
  it("is clearly labeled simulated and ordered", () => {
    expect(abcRoofingScenario.simulated).toBe(true);
    expect(abcRoofingScenario.prospectName).toBe("John Smith");
    expect(abcRoofingScenario.prospectCompany).toBe("ABC Roofing");
    const { plans } = runAbcFixture();
    expect(plans.length).toBe(abcRoofingScenario.turns.length);
    plans.forEach((plan, i) => {
      expect(plan.cursor).toBe(i);
      expect(plan.segment.sequence).toBe(i);
      expect(plan.segment.text).toBe(abcRoofingScenario.turns[i].text);
    });
  });

  it("covers the opening: John is busy but takes the call", () => {
    const { plans } = runAbcFixture();
    const busy = plans.find((p) => p.segment.text.includes("about twenty minutes"));
    expect(busy).toBeDefined();
    expect(busy?.segment.speaker).toBe("prospect");
    expect(plans[0].segment.speaker).toBe("rep"); // greeting first
  });

  it("price objection -> ASK NEXT value question, never a discount", () => {
    const { plans } = runAbcFixture();
    const pricePlan = plans.find((p) => p.events.some((e) => e.type === "PRICE_DISCUSSION"));
    expect(pricePlan).toBeDefined();
    expect(pricePlan?.events[0].metadata).toMatchObject({ isConcern: true });
    const op = pricePlan?.suggestionOp;
    expect(op?.kind).toBe("create");
    if (op?.kind !== "create") return;
    expect(op.suggestion.action).toBe("ASK");
    expect(op.suggestion.text).toBe("About how much is one new customer worth to the business?");
    expect(op.suggestion.reason).toBe("Quantify value before defending price.");

    // NOT a discount anywhere in the whole fixture (guardrails hold).
    for (const plan of plans) {
      if (plan.suggestionOp.kind === "create") {
        expect(plan.suggestionOp.suggestion.text.toLowerCase()).not.toContain("discount");
      }
    }
    // The value question is the recommendation tied to the price event.
    expect(op.suggestion.eventId).toBe(pricePlan!.events[0].id);
  });

  it("has a LISTEN period while pain is explained", () => {
    const { plans } = runAbcFixture();
    const listen = plans.find(
      (p) => p.suggestionOp.kind === "create" && p.suggestionOp.suggestion.action === "LISTEN"
    );
    expect(listen).toBeDefined();
    if (!listen || listen.suggestionOp.kind !== "create") return;
    expect(listen.suggestionOp.suggestion.text.toLowerCase()).toContain("listening");
  });

  it("has at least one genuine no-intervention period", () => {
    const { plans } = runAbcFixture();
    const quiet = plans.filter((p) => p.suggestionOp.kind === "none" && p.mode === "listening");
    expect(quiet.length).toBeGreaterThan(0);
    // The opening pain turns fall inside the initial suggestion cooldown.
    expect(plans[3].suggestionOp.kind).toBe("none"); // slow-callbacks
  });

  it("buying signals lead to a joint demo recommendation, then confirm without pushing", () => {
    const { plans, session } = runFixtureWithFeedback();
    const signals = plans.flatMap((p) => p.events).filter((e) => e.type === "BUYING_SIGNAL");
    expect(signals.length).toBe(2);

    const demo = plans.find(
      (p) =>
        p.suggestionOp.kind === "create" &&
        p.suggestionOp.suggestion.text.toLowerCase().includes("joint demo")
    );
    expect(demo).toBeDefined();
    if (!demo || demo.suggestionOp.kind !== "create") return;
    expect(demo.suggestionOp.suggestion.action).toBe("DO_NOT_PUSH");

    const wednesday = plans.find(
      (p) =>
        p.suggestionOp.kind === "create" &&
        p.suggestionOp.suggestion.text.toLowerCase().includes("wednesday")
    );
    expect(wednesday).toBeDefined();
    if (!wednesday || wednesday.suggestionOp.kind !== "create") return;
    expect(wednesday.suggestionOp.suggestion.action).toBe("DO_NOT_PUSH");
    expect(wednesday.suggestionOp.suggestion.text.toLowerCase()).toContain("without pushing");
    expect(session.suggestions.length).toBe(5); // full history kept
  });

  it("records recommendation feedback (useful) without losing history", () => {
    const { session } = runFixtureWithFeedback();
    const demo = session.suggestions.find((s) => s.text.toLowerCase().includes("joint demo"));
    expect(demo?.feedback).toBe("useful");
    expect(demo?.usedAtMs).not.toBeNull();
    expect(session.suggestions.length).toBe(5);
  });

  it("supersedes the LISTEN suggestion when the price concern arrives (history kept)", () => {
    const { plans } = runAbcFixture();
    const listenPlan = plans.find(
      (p) => p.suggestionOp.kind === "create" && p.suggestionOp.suggestion.action === "LISTEN"
    );
    const pricePlan = plans.find((p) => p.events.some((e) => e.type === "PRICE_DISCUSSION"));
    expect(listenPlan?.suggestionOp.kind).toBe("create");
    expect(pricePlan?.suggestionOp.kind).toBe("create");
    if (listenPlan?.suggestionOp.kind !== "create" || pricePlan?.suggestionOp.kind !== "create") {
      return;
    }
    expect(pricePlan.suggestionOp.suggestion.supersedesId).toBe(
      listenPlan.suggestionOp.suggestion.id
    );
  });

  it("review-time data: Contacted -> Qualified recommendation + evidence-based Purchase Intent", () => {
    const { plans, session } = runFixtureWithFeedback();
    const ended = endSimulation(session, T0 + 240_000);
    if (!ended.ok) throw new Error(ended.error.message);
    const review = buildReview({
      session: ended.value,
      scenario: abcRoofingScenario,
      events: plans.flatMap((p) => p.events),
      segments: plans.map((p) => p.segment),
      suggestions: session.suggestions,
    });

    expect(review.pipelineRecommendation.targetStage).toBe("qualified");
    expect(review.pipelineRecommendation.reason).toContain("Contacted");
    expect(review.purchaseIntent.score).toBe(65); // pain20+impact15+authority15+timing15+signals10+nextStep10 - price20
    expect(review.purchaseIntent.label).toBe("moderate");
    expect(review.purchaseIntent.evidenceCompleteness).toBeCloseTo(6 / 7, 5);
    expect(review.buyingSignals.length).toBe(2);
    expect(review.objections.length).toBe(1);
    expect(review.objections[0].quote).toContain("five hundred a month");
    // Evidence quotes are verbatim transcript lines, never invented.
    for (const ref of [...review.buyingSignals, ...review.objections]) {
      expect(ref.quote.length).toBeGreaterThan(0);
      expect(plans.some((p) => p.segment.text === ref.quote)).toBe(true);
    }
    expect(review.coaching.length).toBeGreaterThanOrEqual(1);
    expect(review.coaching.length).toBeLessThanOrEqual(3);
    expect(review.summary).toContain("Wednesday");
  });

  it("an early end reveals only what happened: insufficient data + contacted recommendation", () => {
    let session = createTestSession();
    const start = startSimulation(session, T0);
    if (!start.ok) throw new Error(start.error.message);
    session = start.value.session;
    const plans: AdvancePlan[] = [];
    for (let i = 0; i < 2; i += 1) {
      const result = advanceSimulation(session, abcRoofingScenario);
      if (!result.ok) throw new Error(result.error.message);
      plans.push(result.value.plan);
      session = finishAdvance(result.value.session, result.value.plan.segment.relativeTimeMs);
    }
    const ended = endSimulation(session, T0 + 10_000);
    if (!ended.ok) throw new Error(ended.error.message);
    const review = buildReview({
      session: ended.value,
      scenario: abcRoofingScenario,
      events: plans.flatMap((p) => p.events),
      segments: plans.map((p) => p.segment),
      suggestions: session.suggestions,
    });
    expect(review.purchaseIntent.score).toBeNull();
    expect(review.purchaseIntent.label).toBe("insufficient_data");
    expect(review.pipelineRecommendation.targetStage).toBe("contacted");
    expect(review.coaching.length).toBeGreaterThanOrEqual(1);
  });
});
