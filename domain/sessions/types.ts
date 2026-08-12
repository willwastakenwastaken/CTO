// Call session domain types — placeholder for the Phase 1 session engine.
// IDs are UUID strings everywhere — never Number(id), parseInt(id), or
// timestamps as record identity.

export type CallSessionStatus =
  | "prepared"
  | "live"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed";

export interface CallSession {
  id: string; // UUID string
  status: CallSessionStatus;
  // TODO(Phase 1): full schema — prospect, sales profile, mode, scenario,
  // simulated flag, objective, timing, duration, outcome, both scores and
  // explanations, summary, next action, pipeline recommendation/reason,
  // conversation state, review payload, error.
}
