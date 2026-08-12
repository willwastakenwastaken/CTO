// Simulation provider boundary — the Phase 1 deterministic scenario engine
// (placeholder). The ABC Roofing fixture drives the whole product experience
// and is always clearly labeled simulated.

export interface SimulationProvider {
  readonly id: string;
  startScenario(scenarioId: string): Promise<unknown>;
  advanceTurn(input: unknown): Promise<unknown>;
  // TODO(Phase 1): deterministic turn engine, ordered segments/events/state,
  // suggestion timing, pause/resume/manual-next controls, restart, and
  // idempotent persistence hooks.
}
