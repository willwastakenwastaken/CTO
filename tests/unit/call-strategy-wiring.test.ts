// M8b — Start AI-Assisted Call wiring: the prospect service creates ONE
// prepared, prospect-linked simulated practice call (default Sales Profile
// linked when one exists, objective from its call goal), ownership-guarded;
// the Call Strategy builder feeds the Command Center; and the live workspace
// surfaces the linked prospect's name/company in the header (via
// CallStore.getProspect + buildWorkspace).
import { describe, expect, it } from "vitest";
import { createProspectService, type ProspectService } from "@/lib/prospects/service";
import type { ProspectStore } from "@/lib/prospects/store";
import type { CallStore } from "@/lib/calls/store";
import type { SalesProfileRow } from "@/lib/sales-profile/types";
import type { CallSessionRow } from "@/lib/calls/types";
import type {
  ActivityRow,
  ProspectNoteRow,
  ProspectRow,
} from "@/lib/prospects/types";
import type { ProspectListSpec } from "@/lib/prospects/query";
import { createSimulationService } from "@/lib/calls/service";
import { ProspectServiceError } from "@/lib/prospects/types";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeProspectStore implements ProspectStore {
  prospects = new Map<string, ProspectRow>();
  notes: ProspectNoteRow[] = [];
  activities: ActivityRow[] = [];
  idealCustomerText: string | null = null;
  defaultSalesProfile: SalesProfileRow | null = null;
  callSessions: CallSessionRow[] = [];

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
    rows.sort((a, b) =>
      String(this.cell(a, column) ?? "").localeCompare(String(this.cell(b, column) ?? ""))
    );
    return ascending ? rows : rows.reverse();
  }
  async getProspect(prospectId: string) {
    return this.prospects.get(prospectId) ?? null;
  }
  async insertProspect(row: ProspectRow) {
    this.prospects.set(row.id, row);
  }
  async updateProspect(prospectId: string, patch: Partial<ProspectRow>) {
    const current = this.prospects.get(prospectId);
    if (!current) throw new Error(`missing prospect ${prospectId}`);
    this.prospects.set(prospectId, { ...current, ...patch });
  }
  async deleteProspect(prospectId: string) {
    this.prospects.delete(prospectId);
  }
  async listNotes(prospectId: string) {
    return this.notes.filter((n) => n.prospect_id === prospectId);
  }
  async insertNote(row: ProspectNoteRow) {
    this.notes.push(row);
  }
  async listActivities(prospectId: string) {
    return this.activities.filter((a) => a.prospect_id === prospectId);
  }
  async upsertActivity(row: ActivityRow) {
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
    this.callSessions.push(row);
  }
}

/** Minimal CallStore for getWorkspace: enough rows to rebuild the session. */
class FakeCallStore implements CallStore {
  session: CallSessionRow | null = null;
  prospectIdentity: { name: string | null; company: string | null } | null = null;
  async getSession() {
    return this.session;
  }
  async listSessions() {
    return this.session ? [this.session] : [];
  }
  async listSegments() {
    return [];
  }
  async listEvents() {
    return [];
  }
  async listSuggestions() {
    return [];
  }
  async getProspect() {
    return this.prospectIdentity;
  }
  async getProspectRecord() {
    return null;
  }
  async updateProspect(_id: string, _patch: { stage?: string; last_contact_at?: string | null }) {
    void _id;
    void _patch;
  }
  async insertSession() {
    return;
  }
  async updateSession(_id: string, _patch: Partial<CallSessionRow>) {
    void _id;
    void _patch;
  }
  async upsertSegment() {
    return;
  }
  async upsertEvents() {
    return;
  }
  async upsertSuggestion() {
    return;
  }
  async updateSuggestion(_id: string, _patch: object) {
    void _id;
    void _patch;
  }
  async markSuggestionSuperseded(_id: string, _supersededById: string) {
    void _id;
    void _supersededById;
  }
  async getNoteByCallAndType() {
    return null;
  }
  async upsertNote() {
    return;
  }
  async getActivityByCallAndType() {
    return null;
  }
  async upsertActivity() {
    return;
  }
  async getProductEventBySessionAndType() {
    return null;
  }
  async upsertProductEvent() {
    return;
  }
}

const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";
const T0 = Date.parse("2026-08-12T10:00:00Z");

const DEFAULT_PROFILE: SalesProfileRow = {
  id: "33333333-0000-4000-8000-000000000003",
  user_id: USER_A,
  name: "Roofing Practice",
  product_name: "RoofScout",
  description: null,
  pricing: null,
  ideal_customer: "Roofing companies, 1-10 employees",
  benefits: "Faster callbacks",
  problems_solved: "Inconsistent callbacks",
  differentiators: null,
  call_goal: "Confirm pain and timeline",
  preferred_cta: "a quick conversation",
  sales_process: null,
  objections: ["price"],
  guardrails: ["no unauthorized discounts"],
  is_default: true,
};

function makeService(store: FakeProspectStore, userId = USER_A): ProspectService {
  return createProspectService({ store, userId });
}

async function seedProspect(
  store: FakeProspectStore,
  userId = USER_A
): Promise<string> {
  const service = makeService(store, userId);
  const { prospectId } = await service.createProspect(
    { first_name: "John", last_name: "Smith", company: "ABC Roofing" },
    T0
  );
  return prospectId;
}

describe("startAiAssistedCall — prepared, prospect-linked practice call", () => {
  it("creates ONE call with correct defaults, linking prospect + default profile", async () => {
    const store = new FakeProspectStore();
    store.defaultSalesProfile = DEFAULT_PROFILE;
    const prospectId = await seedProspect(store);
    const service = makeService(store);

    const { callId } = await service.startAiAssistedCall(prospectId, T0);
    expect(store.callSessions).toHaveLength(1);
    const row = store.callSessions[0];
    expect(row.id).toBe(callId);
    expect(row.user_id).toBe(USER_A); // derived from the session, never the browser
    expect(row.prospect_id).toBe(prospectId);
    expect(row.sales_profile_id).toBe(DEFAULT_PROFILE.id);
    expect(row.mode).toBe("practice");
    expect(row.scenario).toBe("abc_roofing");
    expect(row.is_simulated).toBe(true);
    expect(row.status).toBe("prepared");
    expect(row.objective).toBe("Confirm pain and timeline");
    expect(row.timing).toBeNull();
    expect(row.started_at).toBeNull();
    expect(row.conversation_state).toBeTruthy();
  });

  it("handles a missing Sales Profile honestly: no profile link, null objective", async () => {
    const store = new FakeProspectStore(); // defaultSalesProfile stays null
    const prospectId = await seedProspect(store);
    const service = makeService(store);

    const { callId } = await service.startAiAssistedCall(prospectId, T0);
    const row = store.callSessions[0];
    expect(row.id).toBe(callId);
    expect(row.sales_profile_id).toBeNull();
    expect(row.objective).toBeNull();
    expect(row.prospect_id).toBe(prospectId);
    expect(row.status).toBe("prepared");
  });

  it("never creates a call for another user's prospect (NOT_FOUND)", async () => {
    const store = new FakeProspectStore();
    store.defaultSalesProfile = DEFAULT_PROFILE;
    const prospectId = await seedProspect(store, USER_A);
    const serviceB = makeService(store, USER_B);

    await expect(serviceB.startAiAssistedCall(prospectId, T0)).rejects.toMatchObject({
      category: "NOT_FOUND",
    });
    expect(store.callSessions).toHaveLength(0);
  });

  it("rejects a malformed prospect id as NOT_FOUND", async () => {
    const store = new FakeProspectStore();
    const service = makeService(store);
    await expect(service.startAiAssistedCall("not-a-uuid", T0)).rejects.toMatchObject({
      category: "NOT_FOUND",
    });
    expect(store.callSessions).toHaveLength(0);
  });
});

describe("getCallStrategy — Command Center brief wiring", () => {
  it("returns a ready brief from stored data when a default profile exists", async () => {
    const store = new FakeProspectStore();
    store.defaultSalesProfile = DEFAULT_PROFILE;
    const prospectId = await seedProspect(store);
    const service = makeService(store);

    const strategy = await service.getCallStrategy(prospectId);
    expect(strategy.state).toBe("ready");
    if (strategy.state !== "ready") throw new Error("expected ready");
    expect(strategy.context.name).toBe("John Smith");
    expect(strategy.objective.text).toBe("Confirm pain and timeline");
  });

  it("returns the onboarding-required state when no Sales Profile exists", async () => {
    const store = new FakeProspectStore();
    const prospectId = await seedProspect(store);
    const service = makeService(store);

    const strategy = await service.getCallStrategy(prospectId);
    expect(strategy.state).toBe("onboarding_required");
    if (strategy.state !== "onboarding_required") throw new Error("expected state");
    expect(strategy.reason).toContain("Complete your Sales Profile");
  });

  it("is ownership-guarded (another user's prospect is NOT_FOUND)", async () => {
    const store = new FakeProspectStore();
    store.defaultSalesProfile = DEFAULT_PROFILE;
    const prospectId = await seedProspect(store, USER_A);
    const serviceB = makeService(store, USER_B);
    await expect(serviceB.getCallStrategy(prospectId)).rejects.toBeInstanceOf(
      ProspectServiceError
    );
  });
});

describe("live workspace — linked prospect context in the header", () => {
  it("surfaces the prospect's name/company from call_sessions.prospect_id", async () => {
    const store = new FakeProspectStore();
    store.defaultSalesProfile = DEFAULT_PROFILE;
    const prospectId = await seedProspect(store);
    const { callId } = await makeService(store).startAiAssistedCall(prospectId, T0);

    const callStore = new FakeCallStore();
    callStore.session = store.callSessions[0];
    callStore.prospectIdentity = { name: "John Smith", company: "ABC Roofing" };
    const sim = createSimulationService({ store: callStore, userId: USER_A });

    const workspace = await sim.getWorkspace(callId);
    expect(workspace.prospectName).toBe("John Smith");
    expect(workspace.prospectCompany).toBe("ABC Roofing");
    expect(workspace.simulated).toBe(true);
    expect(workspace.status).toBe("prepared");
  });
});
