// Shared test helpers for simulation unit tests (not part of the product).
import { advanceSimulation, finishAdvance, startSimulation } from "@/domain/simulation/engine";
import { abcRoofingScenario } from "@/providers/simulation/abc-roofing";
import type { AdvancePlan, SimulationSession } from "@/domain/simulation/types";
import { nextUuid } from "./helpers";

export const T0 = 1_700_000_000_000;

/** A fresh prepared engine session for the ABC Roofing scenario. */
export function createTestSession(): SimulationSession {
  return {
    callId: nextUuid(),
    scenarioId: abcRoofingScenario.id,
    status: "prepared",
    paused: false,
    advanceInFlight: false,
    revealedTurnCount: 0,
    conversationState: {
      stage: "opening",
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
    },
    suggestions: [],
    activeSuggestionId: null,
    recentTranscript: [],
    startedAtMs: null,
    endedAtMs: null,
    lastSavedAtMs: null,
  };
}

/** Advances the ABC fixture through every turn, returning plans + session. */
export function runAbcFixture(): {
  session: SimulationSession;
  plans: AdvancePlan[];
} {
  let session = createTestSession();
  const start = startSimulation(session, T0);
  if (!start.ok) throw new Error(start.error.message);
  session = start.value.session;
  const plans: AdvancePlan[] = [];
  for (let i = 0; i < abcRoofingScenario.turns.length; i += 1) {
    const result = advanceSimulation(session, abcRoofingScenario);
    if (!result.ok) throw new Error(result.error.message);
    plans.push(result.value.plan);
    session = finishAdvance(result.value.session, result.value.plan.segment.relativeTimeMs);
  }
  return { session, plans };
}
