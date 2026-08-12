// M9b — Pipeline board: grouping cards by stage, keyboard moves, and the
// stage-move wiring that routes every board move through the SAME
// service.changeStage path as the Command Center (with rollback on failure).
// Pure helpers are tested directly; the wiring test injects the real service
// backed by an in-memory ProspectStore (same pattern as prospect-service.test).
import { describe, expect, it } from "vitest";
import {
  emptyColumns,
  findCardStage,
  groupProspectsByStage,
  insertCardIntoColumns,
  isLegalTarget,
  moveCard,
  nextReachableStage,
  reachableTargets,
  removeCardFromColumns,
  type PipelineColumns,
  type StageMoveFn,
} from "@/lib/pipeline/board";
import { PIPELINE_STAGES, type PipelineStage } from "@/domain/pipeline/types";
import type { ProspectRow } from "@/lib/prospects/types";
import {
  createProspectService,
  type ProspectService,
} from "@/lib/prospects/service";
import type { ProspectStore } from "@/lib/prospects/store";
import type {
  ActivityRow,
  ProspectNoteRow,
} from "@/lib/prospects/types";
import { ProspectServiceError } from "@/lib/prospects/types";
import type { ProspectListSpec } from "@/lib/prospects/query";
import type { SalesProfileRow } from "@/lib/sales-profile/types";
import type { CallSessionRow } from "@/lib/calls/types";

const UUID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function makeProspect(overrides: Partial<ProspectRow>): ProspectRow {
  return {
    id: UUID(1),
    user_id: "user-a",
    first_name: null,
    last_name: null,
    title: null,
    email: null,
    phone: null,
    company: null,
    website: null,
    industry: null,
    size: null,
    location: null,
    stage: "new",
    opportunity_fit_score: null,
    opportunity_fit_label: null,
    opportunity_fit_reasons: null,
    opportunity_fit_scoring_version: null,
    next_action: null,
    next_action_due_date: null,
    last_contact_at: null,
    tags: [],
    source: null,
    ...overrides,
  };
}

describe("groupProspectsByStage", () => {
  it("returns all 9 stages in canonical enum order, including empty columns", () => {
    const columns = groupProspectsByStage([makeProspect({ id: UUID(1), stage: "qualified" })]);
    expect(Object.keys(columns)).toEqual(PIPELINE_STAGES);
    for (const stage of PIPELINE_STAGES) {
      expect(Array.isArray(columns[stage])).toBe(true);
    }
    expect(columns.qualified).toHaveLength(1);
    expect(columns.new).toHaveLength(0);
  });

  it("places each card in its own stage column", () => {
    const columns = groupProspectsByStage([
      makeProspect({ id: UUID(1), stage: "new" }),
      makeProspect({ id: UUID(2), stage: "contacted" }),
      makeProspect({ id: UUID(3), stage: "closed_won" }),
    ]);
    expect(columns.new.map((p) => p.id)).toEqual([UUID(1)]);
    expect(columns.contacted.map((p) => p.id)).toEqual([UUID(2)]);
    expect(columns.closed_won.map((p) => p.id)).toEqual([UUID(3)]);
  });

  it("sorts each column newest-first (created_at desc, deterministic id tiebreak)", () => {
    const columns = groupProspectsByStage([
      makeProspect({ id: UUID(2), stage: "new", created_at: "2026-08-10T10:00:00Z" }),
      makeProspect({ id: UUID(1), stage: "new", created_at: "2026-08-12T10:00:00Z" }),
      makeProspect({ id: UUID(3), stage: "new", created_at: null }),
      // Same timestamp -> id tiebreak (lower id first).
      makeProspect({ id: UUID(5), stage: "new", created_at: "2026-08-11T10:00:00Z" }),
      makeProspect({ id: UUID(4), stage: "new", created_at: "2026-08-11T10:00:00Z" }),
    ]);
    expect(columns.new.map((p) => p.id)).toEqual([UUID(1), UUID(4), UUID(5), UUID(2), UUID(3)]);
  });

  it("counts prospects per stage honestly (zero is a real count)", () => {
    const columns = groupProspectsByStage([
      makeProspect({ id: UUID(1), stage: "new" }),
      makeProspect({ id: UUID(2), stage: "new" }),
    ]);
    expect(columns.new).toHaveLength(2);
    expect(columns.qualified).toHaveLength(0);
  });
});

describe("board card helpers", () => {
  it("findCardStage locates a card; returns null when absent", () => {
    const columns = groupProspectsByStage([makeProspect({ id: UUID(1), stage: "contacted" })]);
    expect(findCardStage(columns, UUID(1))).toBe("contacted");
    expect(findCardStage(columns, UUID(9))).toBeNull();
  });

  it("removeCardFromColumns removes from exactly one column", () => {
    const columns = groupProspectsByStage([makeProspect({ id: UUID(1), stage: "contacted" })]);
    const { columns: next, removed } = removeCardFromColumns(columns, UUID(1));
    expect(removed?.id).toBe(UUID(1));
    expect(findCardStage(next, UUID(1))).toBeNull();
  });

  it("insertCardIntoColumns re-sorts the target column", () => {
    const columns = groupProspectsByStage([makeProspect({ id: UUID(1), stage: "new" })]);
    const next = insertCardIntoColumns(columns, "new", {
      ...makeProspect({ id: UUID(2), stage: "new" }),
      created_at: "2026-08-13T10:00:00Z",
    });
    expect(next.new.map((p) => p.id)).toEqual([UUID(2), UUID(1)]);
  });
});

describe("reachable targets and keyboard moves", () => {
  it("reachableTargets lists the card's legal moves in pipeline order", () => {
    expect(reachableTargets("contacted")).toEqual(["qualified", "ready_to_contact", "closed_lost"]);
    // Terminal stages never move.
    expect(reachableTargets("closed_won")).toEqual([]);
    expect(reachableTargets("closed_lost")).toEqual([]);
  });

  it("isLegalTarget honors the pipeline rules", () => {
    expect(isLegalTarget("contacted", "qualified")).toBe(true);
    expect(isLegalTarget("contacted", "new")).toBe(false);
    expect(isLegalTarget("closed_won", "new")).toBe(false);
  });

  it("nextReachableStage moves to the nearest legal stage in that direction", () => {
    // contacted (index 3): legal targets qualified(4), ready_to_contact(2), closed_lost(8).
    expect(nextReachableStage("contacted", "next")).toBe("qualified");
    expect(nextReachableStage("contacted", "prev")).toBe("ready_to_contact");
    // new (index 0): nothing before it.
    expect(nextReachableStage("new", "prev")).toBeNull();
    // proposal (index 6): closed_won(7) forward, meeting_booked(5) backward.
    expect(nextReachableStage("proposal", "next")).toBe("closed_won");
    expect(nextReachableStage("proposal", "prev")).toBe("meeting_booked");
    // Terminal stages never move.
    expect(nextReachableStage("closed_won", "next")).toBeNull();
    expect(nextReachableStage("closed_lost", "prev")).toBeNull();
  });
});

describe("moveCard — optimistic move, rollback, terminal confirmation", () => {
  const okApply: StageMoveFn = async () => ({ ok: true, data: {} });

  it("applies a legal move optimistically through the injected path", async () => {
    const columns = groupProspectsByStage([makeProspect({ id: UUID(1), stage: "contacted" })]);
    const calls: Array<{ prospectId: string; input: unknown }> = [];
    const apply: StageMoveFn = async (prospectId, input) => {
      calls.push({ prospectId, input });
      return { ok: true, data: {} };
    };
    const result = await moveCard(columns, UUID(1), "qualified", false, apply);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findCardStage(result.columns, UUID(1))).toBe("qualified");
    // The SAME input shape the Command Center sends: expectedStage = the
    // client's belief (stale-cursor recheck), confirmed flag passed through.
    expect(calls).toEqual([
      {
        prospectId: UUID(1),
        input: { targetStage: "qualified", expectedStage: "contacted", confirmed: false },
      },
    ]);
  });

  it("is a no-op when the card is already in the target stage (no apply call)", async () => {
    const columns = groupProspectsByStage([makeProspect({ id: UUID(1), stage: "qualified" })]);
    let called = false;
    const result = await moveCard(columns, UUID(1), "qualified", false, async () => {
      called = true;
      return { ok: true, data: {} };
    });
    expect(result.ok).toBe(true);
    expect(called).toBe(false);
  });

  it("rolls back the optimistic state and surfaces the error when the service fails", async () => {
    const columns = groupProspectsByStage([makeProspect({ id: UUID(1), stage: "contacted" })]);
    const result = await moveCard(columns, UUID(1), "qualified", false, async () => ({
      ok: false as const,
      error: {
        category: "STALE_CURSOR",
        message: "Stale pipeline update: prospect is \"new\", not \"contacted\".",
      },
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe("STALE_CURSOR");
    // Rollback: the card returns to its ORIGINAL column, untouched.
    expect(findCardStage(result.columns, UUID(1))).toBe("contacted");
    expect(result.columns.qualified).toHaveLength(0);
  });

  it("rejects an invalid transition pair without calling the service", async () => {
    const columns = groupProspectsByStage([makeProspect({ id: UUID(1), stage: "contacted" })]);
    let called = false;
    const result = await moveCard(columns, UUID(1), "new", false, async () => {
      called = true;
      return { ok: true, data: {} };
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe("INVALID_TRANSITION");
    expect(called).toBe(false);
    expect(findCardStage(result.columns, UUID(1))).toBe("contacted");
  });

  it("requires explicit confirmation for terminal targets (no service call)", async () => {
    const columns = groupProspectsByStage([makeProspect({ id: UUID(1), stage: "contacted" })]);
    let called = false;
    const result = await moveCard(columns, UUID(1), "closed_lost", false, async () => {
      called = true;
      return { ok: true, data: {} };
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe("TERMINAL_CONFIRMATION_REQUIRED");
    expect(called).toBe(false);
    // With confirmation it goes through the service path.
    const confirmed = await moveCard(columns, UUID(1), "closed_lost", true, okApply);
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(findCardStage(confirmed.columns, UUID(1))).toBe("closed_lost");
  });

  it("locks terminal-stage cards from any move", async () => {
    const columns = groupProspectsByStage([makeProspect({ id: UUID(1), stage: "closed_won" })]);
    const result = await moveCard(columns, UUID(1), "new", true, okApply);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe("TERMINAL_LOCKED");
  });

  it("reports a NOT_FOUND error for a card that isn't on the board", async () => {
    const columns = emptyColumns();
    const result = await moveCard(columns, UUID(1), "qualified", false, okApply);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe("NOT_FOUND");
  });
});

// ---- Wiring: the board's move path IS service.changeStage (same path as the
// Command Center), with rollback when the service rejects the move. ----

class FakeProspectStore implements ProspectStore {
  prospects = new Map<string, ProspectRow>();
  notes: ProspectNoteRow[] = [];
  activities: ActivityRow[] = [];
  idealCustomerText: string | null = null;
  defaultSalesProfile: SalesProfileRow | null = null;
  callSessions: CallSessionRow[] = [];
  writeLog: string[] = [];

  private cell(row: ProspectRow, column: string): unknown {
    return (row as unknown as Record<string, unknown>)[column];
  }

  async listProspects(userId: string, spec: ProspectListSpec) {
    let rows = [...this.prospects.values()].filter((p) => p.user_id === userId);
    for (const { column, pattern } of spec.ilike) {
      const needle = pattern.slice(1, -1).toLowerCase();
      rows = rows.filter((p) =>
        String(this.cell(p, column) ?? "").toLowerCase().includes(needle)
      );
    }
    for (const { column, value } of spec.eq) {
      rows = rows.filter((p) => this.cell(p, column) === value);
    }
    const { column, ascending } = spec.order;
    rows.sort((a, b) => {
      const cmp = String(this.cell(a, column) ?? "").localeCompare(
        String(this.cell(b, column) ?? "")
      );
      return ascending ? cmp : -cmp;
    });
    return rows;
  }
  async getProspect(prospectId: string) {
    return this.prospects.get(prospectId) ?? null;
  }
  async insertProspect(row: ProspectRow) {
    this.writeLog.push("insertProspect");
    this.prospects.set(row.id, row);
  }
  async updateProspect(prospectId: string, patch: Partial<ProspectRow>) {
    this.writeLog.push("updateProspect");
    const current = this.prospects.get(prospectId);
    if (!current) throw new Error(`missing prospect ${prospectId}`);
    this.prospects.set(prospectId, { ...current, ...patch });
  }
  async deleteProspect(prospectId: string) {
    this.writeLog.push("deleteProspect");
    this.prospects.delete(prospectId);
  }
  async listNotes(prospectId: string) {
    return this.notes
      .filter((n) => n.prospect_id === prospectId)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }
  async insertNote(row: ProspectNoteRow) {
    this.writeLog.push("insertNote");
    this.notes.push(row);
  }
  async listActivities(prospectId: string) {
    return this.activities
      .filter((a) => a.prospect_id === prospectId)
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }
  async upsertActivity(row: ActivityRow) {
    this.writeLog.push("upsertActivity");
    const index = this.activities.findIndex((a) => a.id === row.id);
    if (index >= 0) this.activities[index] = row;
    else this.activities.push(row);
  }
  async getIdealCustomerText() {
    return this.idealCustomerText;
  }
  async getDefaultSalesProfile() {
    return this.defaultSalesProfile;
  }
  async insertCallSession(row: CallSessionRow) {
    this.writeLog.push("insertCallSession");
    this.callSessions.push(row);
  }
}

const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const T0 = Date.parse("2026-08-12T10:00:00Z");

describe("wiring — board moves through service.changeStage", () => {
  /** Builds the board's injected apply from the REAL prospect service. */
  function serviceApply(service: ProspectService): StageMoveFn {
    return async (prospectId, input) => {
      try {
        const data = await service.changeStage(prospectId, input, T0 + 500, "pipeline_board");
        return { ok: true as const, data };
      } catch (error) {
        return {
          ok: false as const,
          error: {
            category: error instanceof ProspectServiceError ? error.category : "UNKNOWN",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    };
  }

  async function seedService(stage: PipelineStage): Promise<{
    store: FakeProspectStore;
    service: ProspectService;
    prospectId: string;
  }> {
    const store = new FakeProspectStore();
    const service = createProspectService({ store, userId: USER_A });
    const { prospectId } = await service.createProspect(
      { first_name: "John", company: "ABC Roofing", stage },
      T0
    );
    return { store, service, prospectId };
  }

  it("persists the move through service.changeStage and logs a board activity", async () => {
    const { store, service, prospectId } = await seedService("contacted");
    const columns = groupProspectsByStage(
      await service.listProspects({
        ilike: [],
        eq: [],
        order: { column: "created_at", ascending: false },
      })
    );
    const result = await moveCard(columns, prospectId, "qualified", false, serviceApply(service));
    expect(result.ok).toBe(true);
    // The board's optimistic columns match what the service persisted.
    expect(store.prospects.get(prospectId)?.stage).toBe("qualified");
    if (result.ok) expect(findCardStage(result.columns, prospectId)).toBe("qualified");
    // Exactly one stage_changed activity, sourced from the pipeline board.
    const changed = store.activities.filter((a) => a.type === "stage_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].metadata).toMatchObject({
      fromStage: "contacted",
      toStage: "qualified",
      source: "pipeline_board",
    });
  });

  it("rolls back when the service rejects a stale move (multi-tab)", async () => {
    const { store, service, prospectId } = await seedService("contacted");
    const columns = groupProspectsByStage(
      await service.listProspects({
        ilike: [],
        eq: [],
        order: { column: "created_at", ascending: false },
      })
    );
    // Another tab moves the prospect first; the board still believes
    // "contacted", so the service's stale-cursor recheck must reject it.
    store.prospects.set(prospectId, { ...store.prospects.get(prospectId)!, stage: "new" });

    const result = await moveCard(columns, prospectId, "qualified", false, serviceApply(service));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe("STALE_CURSOR");
    // Rollback: the board card is back in its original column...
    expect(findCardStage(result.columns, prospectId)).toBe("contacted");
    // ...and the server truth ("new") is untouched by the failed move.
    expect(store.prospects.get(prospectId)?.stage).toBe("new");
    expect(store.activities.filter((a) => a.type === "stage_changed")).toHaveLength(0);
  });

  it("routes a confirmed terminal move through the same path with confirmed: true", async () => {
    const { store, service, prospectId } = await seedService("contacted");
    const columns = groupProspectsByStage(
      await service.listProspects({
        ilike: [],
        eq: [],
        order: { column: "created_at", ascending: false },
      })
    );
    const result = await moveCard(columns, prospectId, "closed_lost", true, serviceApply(service));
    expect(result.ok).toBe(true);
    expect(store.prospects.get(prospectId)?.stage).toBe("closed_lost");
    if (result.ok) expect(findCardStage(result.columns, prospectId)).toBe("closed_lost");
  });
});
