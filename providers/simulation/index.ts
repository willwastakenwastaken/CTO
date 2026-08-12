// Simulation provider boundary — the Phase 1 deterministic scenario engine.
// The ABC Roofing fixture (providers/simulation/abc-roofing.ts) drives the
// whole product experience and is always clearly labeled simulated. The
// domain engine (domain/simulation/engine.ts) is pure and unit-testable; the
// persistence layer (lib/calls/) executes its plans.

export interface SimulationProvider {
  readonly id: string;
  startScenario(scenarioId: string): Promise<unknown>;
  advanceTurn(input: unknown): Promise<unknown>;
}

export { abcRoofingScenario, ABC_ROOFING_SCENARIO_ID } from "./abc-roofing";
export { SCENARIOS, getScenario } from "./registry";
