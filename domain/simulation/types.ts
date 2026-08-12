// Simulation domain types (placeholder).
// Phase 1 ships a deterministic, clearly labeled simulated scenario
// (ABC Roofing). No real audio, no production AI, no Twilio.

export interface SimulationScenario {
  id: string; // UUID string
  label: string;
  simulated: true;
  // TODO(Phase 1): deterministic turn script, ordered events, state updates,
  // suggestions (incl. at least one no-intervention / Listening period),
  // and the price-objection -> ASK NEXT -> LISTEN -> buying-signal flow.
}
