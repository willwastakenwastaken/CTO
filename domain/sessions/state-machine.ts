// Call session state machine.
// Enforced lifecycle (spec): prepared -> live -> processing -> completed
// (or -> failed); prepared/live -> cancelled. started_at is set exactly once.
// Transition application is idempotent; stale cursors are rejected.
import { SESSION_STATUSES, type CallSessionStatus } from "@/domain/sessions/types";

export type SessionErrorCategory =
  | "INVALID_TRANSITION"
  | "STALE_CURSOR"
  | "NOT_FOUND";

export interface SessionError {
  category: SessionErrorCategory;
  message: string;
}

/** Legal direct transitions, keyed by current status. */
export const TRANSITION_TABLE: Record<
  CallSessionStatus,
  readonly CallSessionStatus[]
> = {
  prepared: ["live", "cancelled"],
  live: ["processing", "cancelled"],
  processing: ["completed", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
};

export const TERMINAL_SESSION_STATUSES: readonly CallSessionStatus[] = [
  "completed",
  "cancelled",
  "failed",
];

export function isTerminalSessionStatus(
  status: CallSessionStatus
): boolean {
  return (TERMINAL_SESSION_STATUSES as readonly string[]).includes(status);
}

/** True when `from -> to` is legal, or when from === to (idempotent no-op). */
export function canTransition(
  from: CallSessionStatus,
  to: CallSessionStatus
): boolean {
  if (from === to) return true;
  return TRANSITION_TABLE[from].includes(to);
}

export function nextSessionStatuses(
  from: CallSessionStatus
): readonly CallSessionStatus[] {
  return TRANSITION_TABLE[from];
}

export function notFoundError(
  message = "Call session not found."
): SessionError {
  return { category: "NOT_FOUND", message };
}

export interface ApplyTransitionInput {
  currentStatus: CallSessionStatus;
  targetStatus: CallSessionStatus;
  /**
   * Stale-cursor guard for multi-tab workflows: when provided and it does not
   * match `currentStatus`, the transition is rejected as STALE_CURSOR.
   */
  expectedStatus?: CallSessionStatus;
  /** Existing started_at (ISO string) — never overwritten once set. */
  startedAt?: string | null;
  /** Timestamp to use when this transition sets started_at (defaults to now). */
  now?: string;
}

export type ApplyTransitionResult =
  | {
      ok: true;
      nextStatus: CallSessionStatus;
      startedAt: string | null;
      /** True when this application actually set started_at for the first time. */
      startedAtSet: boolean;
      /** True when the call was a same-status no-op (idempotent re-apply). */
      idempotent: boolean;
    }
  | { ok: false; error: SessionError };

/**
 * Applies a transition with guards:
 *  1. STALE_CURSOR when expectedStatus is given and mismatches current.
 *  2. Same-status application is an idempotent no-op (start/end/retry can be
 *     called twice safely — review retry, Strict Mode double effects).
 *  3. INVALID_TRANSITION when the pair is not in TRANSITION_TABLE.
 *  4. started_at is set exactly once: only on prepared -> live, only when it
 *     is not already set.
 */
export function applyTransition(
  input: ApplyTransitionInput
): ApplyTransitionResult {
  const { currentStatus, targetStatus, expectedStatus, startedAt, now } = input;
  const timestamp = now ?? new Date().toISOString();

  if (expectedStatus !== undefined && currentStatus !== expectedStatus) {
    return {
      ok: false,
      error: {
        category: "STALE_CURSOR",
        message: `Stale session cursor: expected status "${expectedStatus}" but the session is "${currentStatus}".`,
      },
    };
  }

  if (currentStatus === targetStatus) {
    return {
      ok: true,
      nextStatus: currentStatus,
      startedAt: startedAt ?? null,
      startedAtSet: false,
      idempotent: true,
    };
  }

  if (!TRANSITION_TABLE[currentStatus].includes(targetStatus)) {
    return {
      ok: false,
      error: {
        category: "INVALID_TRANSITION",
        message: `Invalid session transition: ${currentStatus} -> ${targetStatus}.`,
      },
    };
  }

  let nextStartedAt = startedAt ?? null;
  let startedAtSet = false;
  if (targetStatus === "live" && nextStartedAt === null) {
    nextStartedAt = timestamp;
    startedAtSet = true;
  }

  return {
    ok: true,
    nextStatus: targetStatus,
    startedAt: nextStartedAt,
    startedAtSet,
    idempotent: false,
  };
}

export { SESSION_STATUSES };
export type { CallSessionStatus };
