// Deterministic scenario registry. Phase 1 ships exactly one clearly labeled
// simulated scenario (ABC Roofing). Future scenarios join this map.
import { abcRoofingScenario, ABC_ROOFING_SCENARIO_ID } from "@/providers/simulation/abc-roofing";
import type { SimulationScenario } from "@/domain/simulation/types";

export const SCENARIOS: Record<string, SimulationScenario> = {
  [ABC_ROOFING_SCENARIO_ID]: abcRoofingScenario,
  abc_roofing: abcRoofingScenario, // stable slug alias for the DB `scenario` column
};

export function getScenario(scenarioIdOrSlug: string | null | undefined): SimulationScenario {
  const scenario = scenarioIdOrSlug ? SCENARIOS[scenarioIdOrSlug] : undefined;
  if (!scenario) {
    throw new Error(`Unknown simulation scenario "${scenarioIdOrSlug ?? "(none)"}".`);
  }
  return scenario;
}
