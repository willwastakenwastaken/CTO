// Bounded live-session snapshot + reconcile.
//
// The snapshot holds ONLY the fields the live workspace needs to re-sync:
// call id, scenario cursor, revealed turn count, conversation-state version,
// active suggestion, last save time (+ status). It is cleared on
// completion/cancellation. After a refresh the UI reconciles its snapshot
// against authoritative DB state (snapshot -> authoritative); authoritative
// always wins, so stale multi-tab cursors are rejected/absorbed.
import type { CallSessionStatus } from "@/domain/sessions/types";
import type { SimulationSession } from "@/domain/simulation/types";

export interface LiveSessionSnapshot {
  callId: string;
  scenarioId: string;
  /** Next scenario turn index to reveal (== revealedTurnCount). */
  scenarioCursor: number;
  revealedTurnCount: number;
  conversationStateVersion: number;
  activeSuggestionId: string | null;
  lastSavedAtMs: number | null;
  status: CallSessionStatus;
}

export const TERMINAL_STATUSES: readonly CallSessionStatus[] = [
  "completed",
  "cancelled",
  "failed",
];

/** Snapshot of a live session; null (cleared) once the call is terminal. */
export function snapshotFor(session: SimulationSession): LiveSessionSnapshot | null {
  if ((TERMINAL_STATUSES as readonly string[]).includes(session.status)) return null;
  return {
    callId: session.callId,
    scenarioId: session.scenarioId,
    scenarioCursor: session.revealedTurnCount,
    revealedTurnCount: session.revealedTurnCount,
    conversationStateVersion: session.conversationState.version,
    activeSuggestionId: session.activeSuggestionId,
    lastSavedAtMs: session.lastSavedAtMs,
    status: session.status,
  };
}

/** The authoritative live-state facts fetched from the database. */
export interface AuthoritativeLiveState {
  revealedTurnCount: number;
  conversationStateVersion: number;
  activeSuggestionId: string | null;
  lastSavedAtMs: number | null;
  status: CallSessionStatus;
}

/**
 * Reconciles a client snapshot with authoritative state. Authoritative values
 * always win (cursor, state version, active suggestion, last save). Returns
 * null when the call is terminal — the snapshot is cleared on
 * completion/cancellation.
 */
export function reconcileLiveSnapshot(
  snapshot: LiveSessionSnapshot,
  authoritative: AuthoritativeLiveState
): LiveSessionSnapshot | null {
  if ((TERMINAL_STATUSES as readonly string[]).includes(authoritative.status)) return null;
  return {
    ...snapshot,
    scenarioCursor: authoritative.revealedTurnCount,
    revealedTurnCount: authoritative.revealedTurnCount,
    conversationStateVersion: authoritative.conversationStateVersion,
    activeSuggestionId: authoritative.activeSuggestionId,
    lastSavedAtMs: authoritative.lastSavedAtMs,
    status: authoritative.status,
  };
}
