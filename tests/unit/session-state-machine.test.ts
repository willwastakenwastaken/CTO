import { describe, expect, it } from "vitest";
import {
  applyTransition,
  canTransition,
  isTerminalSessionStatus,
  nextSessionStatuses,
  notFoundError,
  SESSION_STATUSES,
  TRANSITION_TABLE,
  type SessionErrorCategory,
} from "@/domain/sessions/state-machine";

describe("session state machine — transition table", () => {
  it("enforces the spec lifecycle", () => {
    expect(TRANSITION_TABLE.prepared).toEqual(["live", "cancelled"]);
    expect(TRANSITION_TABLE.live).toEqual(["processing", "cancelled"]);
    expect(TRANSITION_TABLE.processing).toEqual(["completed", "failed"]);
    expect(TRANSITION_TABLE.completed).toEqual([]);
    expect(TRANSITION_TABLE.cancelled).toEqual([]);
    expect(TRANSITION_TABLE.failed).toEqual([]);
  });

  it("accepts every legal transition", () => {
    const legal: Array<[string, string]> = [
      ["prepared", "live"],
      ["prepared", "cancelled"],
      ["live", "processing"],
      ["live", "cancelled"],
      ["processing", "completed"],
      ["processing", "failed"],
    ];
    for (const [from, to] of legal) {
      expect(canTransition(from as never, to as never)).toBe(true);
      expect(applyTransition({ currentStatus: from as never, targetStatus: to as never }).ok).toBe(true);
    }
  });

  it("rejects every illegal transition with INVALID_TRANSITION", () => {
    const illegal: Array<[string, string]> = [
      ["prepared", "processing"],
      ["prepared", "completed"],
      ["prepared", "failed"],
      ["live", "completed"],
      ["live", "failed"],
      ["live", "prepared"],
      ["processing", "live"],
      ["processing", "cancelled"],
      ["processing", "prepared"],
      ["completed", "live"],
      ["completed", "processing"],
      ["cancelled", "live"],
      ["cancelled", "prepared"],
      ["failed", "processing"],
      ["failed", "completed"],
      ["completed", "cancelled"],
    ];
    for (const [from, to] of illegal) {
      if (!from || !to) continue;
      const result = applyTransition({ currentStatus: from as never, targetStatus: to as never });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.category).toBe("INVALID_TRANSITION" satisfies SessionErrorCategory);
      }
    }
  });

  it("marks completed/cancelled/failed as terminal", () => {
    for (const status of ["completed", "cancelled", "failed"]) {
      expect(isTerminalSessionStatus(status as never)).toBe(true);
    }
    for (const status of ["prepared", "live", "processing"]) {
      expect(isTerminalSessionStatus(status as never)).toBe(false);
    }
  });

  it("exposes all six statuses", () => {
    expect(SESSION_STATUSES).toHaveLength(6);
    expect(nextSessionStatuses("prepared")).toEqual(["live", "cancelled"]);
    expect(notFoundError().category).toBe("NOT_FOUND");
  });
});

describe("session state machine — started_at set exactly once", () => {
  it("sets started_at on prepared -> live", () => {
    const result = applyTransition({
      currentStatus: "prepared",
      targetStatus: "live",
      startedAt: null,
      now: "2026-08-12T10:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.startedAtSet).toBe(true);
      expect(result.startedAt).toBe("2026-08-12T10:00:00.000Z");
      expect(result.nextStatus).toBe("live");
    }
  });

  it("never overwrites an existing started_at", () => {
    const result = applyTransition({
      currentStatus: "prepared",
      targetStatus: "live",
      startedAt: "2026-08-12T09:00:00.000Z",
      now: "2026-08-12T10:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.startedAtSet).toBe(false);
      expect(result.startedAt).toBe("2026-08-12T09:00:00.000Z");
    }
  });

  it("does not set started_at for non-live transitions", () => {
    const result = applyTransition({
      currentStatus: "live",
      targetStatus: "cancelled",
      startedAt: "2026-08-12T09:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.startedAtSet).toBe(false);
      expect(result.startedAt).toBe("2026-08-12T09:00:00.000Z");
    }
  });
});

describe("session state machine — idempotency", () => {
  it("re-applying the same transition is an idempotent no-op", () => {
    const first = applyTransition({ currentStatus: "prepared", targetStatus: "live", startedAt: null, now: "T1" });
    expect(first.ok).toBe(true);
    const second = applyTransition({ currentStatus: "live", targetStatus: "live", startedAt: first.ok ? first.startedAt : null });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.idempotent).toBe(true);
      expect(second.startedAtSet).toBe(false);
    }
  });

  it("full lifecycle double-application is safe (strict-mode / retry)", () => {
    const t1 = applyTransition({ currentStatus: "prepared", targetStatus: "live", startedAt: null });
    expect(t1.ok).toBe(true);
    const startedAt = t1.ok ? t1.startedAt : null;

    const t2 = applyTransition({ currentStatus: "live", targetStatus: "live", startedAt });
    expect(t2.ok && t2.idempotent).toBe(true);

    const t3 = applyTransition({ currentStatus: "live", targetStatus: "processing", startedAt });
    expect(t3.ok).toBe(true);

    // review retry: processing -> processing then -> completed
    const retry = applyTransition({ currentStatus: "processing", targetStatus: "processing", startedAt });
    expect(retry.ok && retry.idempotent).toBe(true);

    const t4 = applyTransition({ currentStatus: "processing", targetStatus: "completed", startedAt });
    expect(t4.ok).toBe(true);
    if (t4.ok) expect(t4.nextStatus).toBe("completed");
  });
});

describe("session state machine — stale cursors", () => {
  it("rejects a transition when expectedStatus no longer matches", () => {
    const result = applyTransition({
      currentStatus: "completed",
      targetStatus: "processing",
      expectedStatus: "live",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("STALE_CURSOR" satisfies SessionErrorCategory);
    }
  });

  it("accepts a transition when expectedStatus matches", () => {
    const result = applyTransition({
      currentStatus: "live",
      targetStatus: "processing",
      expectedStatus: "live",
    });
    expect(result.ok).toBe(true);
  });
});
