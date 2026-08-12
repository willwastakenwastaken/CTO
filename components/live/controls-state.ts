// Pure live-workspace control state machine + auto-play scheduling bounds.
// Kept free of React/Next imports so Vitest can unit-test them directly.
import type { CallSessionStatus } from "@/domain/sessions/types";

/** The control surface is derived from the call status + client view flags:
 *  - prepared  -> Start (the workspace can be deep-linked / arrived via restart)
 *  - live      -> Pause/Resume, Next turn, Auto-play, End, Restart
 *  - terminal  -> no controls (ended state routes to the review)
 */
export function canStart(status: CallSessionStatus): boolean {
  return status === "prepared";
}

export function canPause(status: CallSessionStatus, paused: boolean): boolean {
  return status === "live" && !paused;
}

export function canResume(status: CallSessionStatus, paused: boolean): boolean {
  return status === "live" && paused;
}

/** Manual/auto advance is allowed only while live, unpaused, with a turn left
 * and no advance in flight (prevents rapid double advancement — the server
 * also rejects stale cursors). */
export function canAdvance(
  status: CallSessionStatus,
  paused: boolean,
  inFlight: boolean,
  endOfScenario: boolean
): boolean {
  return status === "live" && !paused && !inFlight && !endOfScenario;
}

export function canToggleAutoPlay(status: CallSessionStatus, endOfScenario: boolean): boolean {
  return status === "live" && !endOfScenario;
}

export function canEnd(status: CallSessionStatus): boolean {
  return status === "prepared" || status === "live";
}

export function canRestart(status: CallSessionStatus): boolean {
  return status === "prepared" || status === "live";
}

export function isTerminal(status: CallSessionStatus): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}
