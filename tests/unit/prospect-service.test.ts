// M8a — Prospects service: create/edit/delete, Opportunity Fit wiring (rich
// vs sparse), stage changes with activities, notes + activities, ownership
// guards. Uses the same in-memory ProspectStore pattern as the call-service
// tests (Map-backed rows + write log).
import { describe, expect, it } from "vitest";
import {
  createProspectService,
  type ProspectService,
} from "@/lib/prospects/service";
import type { ProspectStore } from "@/lib/prospects/store";
import type {
  ActivityRow,
  ProspectNoteRow,
  ProspectRow,
} from "@/lib/prospects/types";
import { ProspectServiceError } from "@/lib/prospects/types";
import type { ProspectListSpec } from "@/lib/prospects/query";

class FakeProspectStore implements ProspectStore {
  prospects = new Map<string, ProspectRow>();
  notes: ProspectNoteRow[] = [];
  activities: ActivityRow[] = [];
  idealCustomerText: string | null = null;
  writeLog: string[] = [];

  /** Reads a column off a prospect row (name-safe for the fake's sort). */
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
}

const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";

function makeService(store: FakeProspectStore, userId = USER_A): ProspectService {
  return createProspectService({ store, userId });
}

const T0 = Date.parse("2026-08-12T10:00:00Z");

describe("createProspect — Opportunity Fit wiring", () => {
  it("persists a computed fit for a rich prospect (never a fabricated score)", async () => {
    const store = new FakeProspectStore();
    store.idealCustomerText = "Roofing, 1-10 employees";
    const service = makeService(store);
    const { prospectId } = await service.createProspect(
      {
        first_name: "John",
        last_name: "Smith",
        company: "ABC Roofing",
        industry: "Roofing & Exteriors",
        size: "1-10",
        location: "Chicago, IL",
        stage: "contacted",
        next_action: "Send pricing overview",
        tags: ["inbound"],
        source: "inbound",
      },
      T0
    );
    const row = store.prospects.get(prospectId);
    expect(row).toBeDefined();
    expect(row?.opportunity_fit_score).toBe(100);
    expect(row?.opportunity_fit_label).toBe("strong");
    expect(row?.opportunity_fit_scoring_version).toBe("opportunity-fit@1");
    expect(Array.isArray(row?.opportunity_fit_reasons)).toBe(true);
    expect(row?.next_action).toBe("Send pricing overview");
    expect(row?.tags).toEqual(["inbound"]);
    expect(row?.stage).toBe("contacted");

    // One prospect_created activity, deterministic id, linked to the prospect.
    const created = store.activities.find((a) => a.type === "prospect_created");
    expect(created).toBeDefined();
    expect(created?.prospect_id).toBe(prospectId);
    expect(created?.metadata).toMatchObject({ prospectId, stage: "contacted" });
  });

  it("persists insufficient data (NULL score) for a sparse prospect — no invented score", async () => {
    const store = new FakeProspectStore();
    store.idealCustomerText = null;
    const service = makeService(store);
    const { prospectId } = await service.createProspect(
      { first_name: "Pat", company: "" },
      T0
    );
    const row = store.prospects.get(prospectId);
    expect(row?.opportunity_fit_score).toBeNull();
    expect(row?.opportunity_fit_label).toBe("insufficient_data");
    expect(Array.isArray(row?.opportunity_fit_reasons)).toBe(true);
    expect((row?.opportunity_fit_reasons ?? []).length).toBeGreaterThan(0);
    // Reasons explain WHY it's insufficient; they are never a number.
    expect(row?.opportunity_fit_reasons?.every((r) => r.score === null)).toBe(true);
    // A prospect_created activity is still recorded.
    expect(store.activities.some((a) => a.type === "prospect_created")).toBe(true);
  });

  it("rejects a form that fails validation (no name or company)", async () => {
    const store = new FakeProspectStore();
    const service = makeService(store);
    await expect(service.createProspect({ email: "x@y.com" }, T0)).rejects.toThrow();
    expect(store.writeLog).not.toContain("insertProspect");
  });
});

describe("updateProspect — only what is submitted is overwritten", () => {
  it("recomputes fit on a full edit and logs a stage change", async () => {
    const store = new FakeProspectStore();
    store.idealCustomerText = "Roofing, 1-10 employees";
    const service = makeService(store);
    const { prospectId } = await service.createProspect(
      { first_name: "John", company: "ABC Roofing" },
      T0
    );
    store.idealCustomerText = "Roofing, 1-10 employees";
    await service.updateProspect(
      prospectId,
      {
        first_name: "John",
        company: "ABC Roofing",
        industry: "Roofing & Exteriors",
        size: "1-10",
        stage: "contacted",
        next_action: "",
        next_action_due_date: "",
        tags: [],
        source: "",
      },
      T0 + 1000
    );
    const row = store.prospects.get(prospectId);
    expect(row?.opportunity_fit_score).toBe(100);
    expect(row?.stage).toBe("contacted");
    expect(row?.next_action).toBeNull(); // blank submitted -> unknown
    const changed = store.activities.filter((a) => a.type === "stage_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].metadata).toMatchObject({
      fromStage: "new",
      toStage: "contacted",
      source: "edit_form",
    });
  });

  it("inline next-action edit touches ONLY next_action + due date", async () => {
    const store = new FakeProspectStore();
    const service = makeService(store);
    const { prospectId } = await service.createProspect(
      {
        first_name: "John",
        company: "ABC Roofing",
        industry: "Roofing & Exteriors",
        size: "1-10",
        source: "inbound",
      },
      T0
    );
    const before = store.prospects.get(prospectId);
    await service.updateNextAction(prospectId, {
      next_action: "Book a demo",
      next_action_due_date: "2026-09-01",
    });
    const after = store.prospects.get(prospectId);
    expect(after?.next_action).toBe("Book a demo");
    expect(after?.next_action_due_date).toBe("2026-09-01");
    // Everything else is preserved exactly.
    expect(after?.first_name).toBe(before?.first_name);
    expect(after?.company).toBe(before?.company);
    expect(after?.industry).toBe(before?.industry);
    expect(after?.size).toBe(before?.size);
    expect(after?.source).toBe(before?.source);
    expect(after?.opportunity_fit_score).toBe(before?.opportunity_fit_score);
    // Clearing both fields = no next action.
    await service.updateNextAction(prospectId, { next_action: "", next_action_due_date: "" });
    expect(store.prospects.get(prospectId)?.next_action).toBeNull();
    expect(store.prospects.get(prospectId)?.next_action_due_date).toBeNull();
  });
});

describe("changeStage — Command Center stage control", () => {
  async function seedContacted(store: FakeProspectStore, userId = USER_A): Promise<string> {
    const service = makeService(store, userId);
    const { prospectId } = await service.createProspect(
      { first_name: "John", company: "ABC Roofing", stage: "contacted" },
      T0
    );
    return prospectId;
  }

  it("writes the stage and one stage_changed activity with from/to metadata", async () => {
    const store = new FakeProspectStore();
    const prospectId = await seedContacted(store);
    const service = makeService(store);
    const outcome = await service.changeStage(
      prospectId,
      { targetStage: "qualified", expectedStage: "contacted", confirmed: false },
      T0 + 500
    );
    expect(outcome).toEqual({ prospectId, fromStage: "contacted", toStage: "qualified" });
    expect(store.prospects.get(prospectId)?.stage).toBe("qualified");
    const changed = store.activities.filter((a) => a.type === "stage_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].summary).toContain("Contacted");
    expect(changed[0].summary).toContain("Qualified");
    expect(changed[0].metadata).toMatchObject({
      fromStage: "contacted",
      toStage: "qualified",
      source: "command_center",
    });
  });

  it("rejects a stale expected stage (multi-tab guard)", async () => {
    const store = new FakeProspectStore();
    const prospectId = await seedContacted(store);
    const service = makeService(store);
    await expect(
      service.changeStage(
        prospectId,
        { targetStage: "qualified", expectedStage: "new", confirmed: false },
        T0 + 500
      )
    ).rejects.toMatchObject({ category: "STALE_CURSOR" });
    expect(store.prospects.get(prospectId)?.stage).toBe("contacted");
  });

  it("requires explicit confirmation for a terminal stage", async () => {
    const store = new FakeProspectStore();
    const prospectId = await seedContacted(store);
    const service = makeService(store);
    await expect(
      service.changeStage(
        prospectId,
        { targetStage: "closed_lost", expectedStage: "contacted", confirmed: false },
        T0 + 500
      )
    ).rejects.toMatchObject({ category: "TERMINAL_CONFIRMATION_REQUIRED" });
    // With confirmation it goes through.
    await service.changeStage(
      prospectId,
      { targetStage: "closed_lost", expectedStage: "contacted", confirmed: true },
      T0 + 600
    );
    expect(store.prospects.get(prospectId)?.stage).toBe("closed_lost");
    // A terminal prospect is locked.
    await expect(
      service.changeStage(
        prospectId,
        { targetStage: "new", expectedStage: "closed_lost", confirmed: true },
        T0 + 700
      )
    ).rejects.toMatchObject({ category: "TERMINAL_LOCKED" });
  });

  it("rejects an invalid transition pair", async () => {
    const store = new FakeProspectStore();
    const prospectId = await seedContacted(store);
    const service = makeService(store);
    await expect(
      service.changeStage(
        prospectId,
        { targetStage: "new", expectedStage: "contacted", confirmed: false },
        T0 + 500
      )
    ).rejects.toMatchObject({ category: "INVALID_TRANSITION" });
  });

  it("rejects an invalid target stage (enum validated)", async () => {
    const store = new FakeProspectStore();
    const prospectId = await seedContacted(store);
    const service = makeService(store);
    await expect(
      service.changeStage(
        prospectId,
        { targetStage: "won", expectedStage: "contacted" },
        T0 + 500
      )
    ).rejects.toThrow();
    expect(store.prospects.get(prospectId)?.stage).toBe("contacted");
  });
});

describe("notes and activity wiring", () => {
  it("adds a general note + one note_added activity", async () => {
    const store = new FakeProspectStore();
    const service = makeService(store);
    const { prospectId } = await service.createProspect(
      { first_name: "John", company: "ABC Roofing" },
      T0
    );
    const { noteId } = await service.addNote(
      prospectId,
      { title: "Prefers email", body: "Wants a written recap." },
      T0 + 1000
    );
    const note = store.notes.find((n) => n.id === noteId);
    expect(note).toBeDefined();
    expect(note?.type).toBe("general");
    expect(note?.prospect_id).toBe(prospectId);
    const activity = store.activities.find((a) => a.type === "note_added");
    expect(activity).toBeDefined();
    expect(activity?.metadata).toMatchObject({ prospectId, noteId });
    expect(activity?.summary).toContain("Prefers email");
  });
});

describe("ownership guards", () => {
  it("treats another user's prospect as NOT_FOUND (never revealed)", async () => {
    const store = new FakeProspectStore();
    const serviceA = makeService(store, USER_A);
    const { prospectId } = await serviceA.createProspect(
      { first_name: "John", company: "ABC Roofing" },
      T0
    );
    const serviceB = makeService(store, USER_B);
    await expect(serviceB.getDetail(prospectId)).rejects.toMatchObject({
      category: "NOT_FOUND",
    });
    await expect(serviceB.deleteProspect(prospectId)).rejects.toMatchObject({
      category: "NOT_FOUND",
    });
    await expect(
      serviceB.addNote(prospectId, { title: "Snooping" }, T0)
    ).rejects.toMatchObject({ category: "NOT_FOUND" });
    await expect(
      serviceB.changeStage(
        prospectId,
        { targetStage: "qualified", expectedStage: "new" },
        T0
      )
    ).rejects.toMatchObject({ category: "NOT_FOUND" });
    // Nothing was written by user B.
    expect(store.prospects.get(prospectId)?.stage).toBe("new");
    expect(store.notes).toHaveLength(0);
  });

  it("rejects a malformed prospect id as NOT_FOUND", async () => {
    const store = new FakeProspectStore();
    const service = makeService(store);
    await expect(service.getDetail("not-a-uuid")).rejects.toMatchObject({
      category: "NOT_FOUND",
    });
    await expect(service.deleteProspect("not-a-uuid")).rejects.toMatchObject({
      category: "NOT_FOUND",
    });
  });
});

describe("getDetail and listProspects", () => {
  it("returns the prospect with its notes and activities (newest first)", async () => {
    const store = new FakeProspectStore();
    const service = makeService(store);
    const { prospectId } = await service.createProspect(
      { first_name: "John", company: "ABC Roofing", stage: "contacted" },
      T0
    );
    await service.addNote(prospectId, { title: "Note one" }, T0 + 1000);
    await service.changeStage(
      prospectId,
      { targetStage: "qualified", expectedStage: "contacted" },
      T0 + 2000
    );
    const detail = await service.getDetail(prospectId);
    expect(detail.prospect.id).toBe(prospectId);
    expect(detail.notes).toHaveLength(1);
    expect(detail.activities.map((a) => a.type)).toEqual([
      "stage_changed",
      "note_added",
      "prospect_created",
    ]);
  });

  it("lists only the current user's prospects", async () => {
    const store = new FakeProspectStore();
    const serviceA = makeService(store, USER_A);
    const serviceB = makeService(store, USER_B);
    await serviceA.createProspect({ first_name: "Alice", company: "A Co" }, T0);
    await serviceB.createProspect({ first_name: "Bob", company: "B Co" }, T0);
    const rowsA = await serviceA.listProspects({
      ilike: [],
      eq: [],
      order: { column: "created_at", ascending: false },
    });
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].company).toBe("A Co");
  });

  it("deletes a prospect the user owns", async () => {
    const store = new FakeProspectStore();
    const service = makeService(store);
    const { prospectId } = await service.createProspect(
      { first_name: "John", company: "ABC Roofing" },
      T0
    );
    await service.deleteProspect(prospectId);
    expect(store.prospects.has(prospectId)).toBe(false);
    await expect(service.getDetail(prospectId)).rejects.toBeInstanceOf(ProspectServiceError);
  });
});
