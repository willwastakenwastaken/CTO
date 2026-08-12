import { describe, expect, it } from "vitest";
import { createSimulationService, type SimulationService } from "@/lib/calls/service";
import type { CallStore } from "@/lib/calls/store";
import { CallServiceError } from "@/lib/calls/types";
import type {
  ActivityRow,
  AiSuggestionRow,
  CallEventRow,
  CallSessionRow,
  ProductEventRow,
  ProspectNoteRow,
  ProspectRow,
  TranscriptSegmentRow,
} from "@/lib/calls/types";
import { abcRoofingScenario } from "@/providers/simulation/abc-roofing";
import { uuidFromParts } from "@/domain/utils/uuid";
import { T0 } from "./simulation-helpers";

/** In-memory CallStore that mirrors Supabase upsert semantics (onConflict id,
 * ignoreDuplicates -> an existing id is a no-op) and records write order. */
class FakeStore implements CallStore {
  sessions = new Map<string, CallSessionRow>();
  prospects = new Map<string, ProspectRow>();
  segments: TranscriptSegmentRow[] = [];
  events: CallEventRow[] = [];
  suggestions: AiSuggestionRow[] = [];
  notes: ProspectNoteRow[] = [];
  activities: ActivityRow[] = [];
  productEvents: ProductEventRow[] = [];
  writeLog: string[] = [];

  async getSession(callId: string) {
    return this.sessions.get(callId) ?? null;
  }
  async listSessions() {
    return [...this.sessions.values()];
  }
  async getProspect(prospectId: string | null) {
    if (!prospectId) return null;
    return { name: "Linked Prospect", company: "Linked Co" };
  }
  async getProspectRecord(prospectId: string) {
    return this.prospects.get(prospectId) ?? null;
  }
  async updateProspect(prospectId: string, patch: { stage?: string; last_contact_at?: string | null }) {
    this.writeLog.push("updateProspect");
    const current = this.prospects.get(prospectId);
    if (!current) throw new Error(`missing prospect ${prospectId}`);
    this.prospects.set(prospectId, { ...current, ...patch });
  }
  async insertSession(row: CallSessionRow) {
    this.writeLog.push("insertSession");
    this.sessions.set(row.id, { ...row, created_at: new Date(T0).toISOString() });
  }
  async updateSession(callId: string, patch: Partial<CallSessionRow>) {
    this.writeLog.push("updateSession");
    const current = this.sessions.get(callId);
    if (!current) throw new Error(`missing session ${callId}`);
    this.sessions.set(callId, { ...current, ...patch, updated_at: new Date(T0).toISOString() });
  }
  async listSegments(callId: string) {
    return this.segments
      .filter((s) => s.call_id === callId)
      .sort((a, b) => a.sequence - b.sequence);
  }
  async upsertSegment(row: TranscriptSegmentRow) {
    this.writeLog.push("upsertSegment");
    if (!this.segments.some((s) => s.id === row.id)) this.segments.push({ ...row });
  }
  async upsertEvents(rows: CallEventRow[]) {
    this.writeLog.push("upsertEvents");
    for (const row of rows) {
      if (!this.events.some((e) => e.id === row.id)) {
        this.events.push({ ...row, created_at: new Date(T0).toISOString() });
      }
    }
  }
  async upsertSuggestion(row: AiSuggestionRow) {
    this.writeLog.push("upsertSuggestion");
    if (!this.suggestions.some((s) => s.id === row.id)) this.suggestions.push({ ...row });
  }
  async updateSuggestion(suggestionId: string, patch: Partial<AiSuggestionRow>) {
    this.writeLog.push("updateSuggestion");
    const index = this.suggestions.findIndex((s) => s.id === suggestionId);
    if (index >= 0) this.suggestions[index] = { ...this.suggestions[index], ...patch };
  }
  async markSuggestionSuperseded(suggestionId: string, supersededById: string) {
    this.writeLog.push("markSuggestionSuperseded");
    const index = this.suggestions.findIndex((s) => s.id === suggestionId);
    if (index >= 0) this.suggestions[index] = { ...this.suggestions[index], superseded_by: supersededById };
  }
  async listEvents(callId: string) {
    return this.events
      .filter((e) => e.call_id === callId)
      .sort((a, b) => a.relative_time_ms - b.relative_time_ms || a.id.localeCompare(b.id));
  }
  async listSuggestions(callId: string) {
    return this.suggestions
      .filter((s) => s.call_id === callId)
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  }
  async getNoteByCallAndType(callId: string, type: string) {
    return this.notes.find((n) => n.call_id === callId && n.type === type) ?? null;
  }
  async upsertNote(row: ProspectNoteRow) {
    this.writeLog.push("upsertNote");
    const index = this.notes.findIndex((n) => n.id === row.id);
    if (index >= 0) this.notes[index] = { ...this.notes[index], ...row };
    else this.notes.push({ ...row });
  }
  async getActivityByCallAndType(callId: string, type: string) {
    return this.activities.find((a) => a.call_id === callId && a.type === type) ?? null;
  }
  async upsertActivity(row: ActivityRow) {
    this.writeLog.push("upsertActivity");
    const index = this.activities.findIndex((a) => a.id === row.id);
    if (index >= 0) this.activities[index] = { ...this.activities[index], ...row };
    else this.activities.push({ ...row });
  }
  async getProductEventBySessionAndType(sessionId: string, type: string) {
    return this.productEvents.find((e) => e.session_id === sessionId && e.type === type) ?? null;
  }
  async upsertProductEvent(row: ProductEventRow) {
    this.writeLog.push("upsertProductEvent");
    const index = this.productEvents.findIndex((e) => e.id === row.id);
    if (index >= 0) this.productEvents[index] = { ...this.productEvents[index], ...row };
    else this.productEvents.push({ ...row });
  }
}

const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";

function makeService(store: FakeStore, userId = USER_A): SimulationService {
  return createSimulationService({ store, userId });
}

async function prepareAndStart(service: SimulationService) {
  const { callId } = await service.prepareCall({});
  await service.startCall(callId, T0);
  return callId;
}

/** Advances exactly N turns via the service (cursor-driven). */
async function advanceN(service: SimulationService, callId: string, n: number) {
  for (let i = 0; i < n; i += 1) {
    const out = await service.advanceCall(callId, { expectedCursor: i });
    if (!out.advanced) throw new Error(`expected advance at cursor ${i}`);
  }
}

describe("simulation persistence — lifecycle", () => {
  it("prepare creates a clearly labeled simulated call (prepared)", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const { callId, snapshot } = await service.prepareCall({});
    const row = store.sessions.get(callId)!;
    expect(row.status).toBe("prepared");
    expect(row.is_simulated).toBe(true);
    expect(row.mode).toBe("practice");
    expect(row.scenario).toBe(abcRoofingScenario.id);
    expect(row.user_id).toBe(USER_A); // derived from the session, never the browser
    expect(snapshot.status).toBe("prepared");
    expect(snapshot.revealedTurnCount).toBe(0);
  });

  it("start sets started_at exactly once (idempotent re-start)", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const { callId } = await service.prepareCall({});
    await service.startCall(callId, T0);
    const row = store.sessions.get(callId)!;
    expect(row.status).toBe("live");
    expect(row.started_at).toBe(new Date(T0).toISOString());
    const again = await service.startCall(callId, T0 + 60_000);
    const row2 = store.sessions.get(callId)!;
    expect(row2.started_at).toBe(new Date(T0).toISOString()); // unchanged
    expect(again.status).toBe("live");
  });

  it("advance persists the segment BEFORE events and session state", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, 7); // up to ask-permission
    store.writeLog.length = 0;
    // Cursor 7 is elaborate-pain -> PAIN_DISCOVERED -> LISTEN suggestion.
    const out = await service.advanceCall(callId, { expectedCursor: 7 });
    expect(out.advanced).toBe(true);
    const order = store.writeLog;
    expect(order.indexOf("upsertSegment")).toBeLessThan(order.indexOf("upsertEvents"));
    expect(order.indexOf("upsertEvents")).toBeLessThan(order.indexOf("upsertSuggestion"));
    expect(order.indexOf("upsertSuggestion")).toBeLessThan(order.indexOf("updateSession"));
    expect(store.segments.length).toBe(8);
    expect(store.events.length).toBeGreaterThan(0);
    // Suggestion row links its event and carries the sim-relative expiry.
    const sug = store.suggestions[store.suggestions.length - 1];
    expect(sug.action).toBe("LISTEN");
    expect(sug.event_id).toBeTruthy();
    expect(sug.user_id).toBe(USER_A);
    expect(sug.expires_at).toBe(new Date(T0 + 45_000 + 90_000).toISOString());
  });

  it("superseded suggestions are marked, never deleted", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, 10); // through price-concern (supersedes LISTEN)
    const listen = store.suggestions.find((s) => s.action === "LISTEN")!;
    const ask = store.suggestions.find((s) => s.text.includes("one new customer"))!;
    expect(listen).toBeDefined();
    expect(ask).toBeDefined();
    expect(listen.superseded_by).toBe(ask.id);
    expect(store.suggestions.length).toBe(2); // history kept
    expect(store.writeLog).toContain("markSuggestionSuperseded");
  });

  it("replaying an advance (same cursor) reconciles without duplicating rows", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, 4); // slow-callbacks has a PAIN event
    expect(store.segments.length).toBe(4);
    expect(store.events.length).toBe(1);
    store.writeLog.length = 0;

    // Replay cursor 3: already persisted -> reconcile, no writes.
    const out = await service.advanceCall(callId, { expectedCursor: 3 });
    expect(out.advanced).toBe(false);
    expect(out.snapshot.revealedTurnCount).toBe(4);
    expect(store.writeLog.length).toBe(0);
    expect(store.segments.length).toBe(4);
    expect(store.events.length).toBe(1);
  });

  it("repairs an interrupted advance (segment persisted, events lost) without duplicating", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, 3); // through opening-question
    // Simulate the crash: turn 3's segment was written but its events never were.
    const turn3 = abcRoofingScenario.turns[3];
    const deterministicSegmentId = uuidFromParts(callId, "segment", turn3.key);
    await store.upsertSegment({
      id: deterministicSegmentId,
      user_id: USER_A,
      call_id: callId,
      sequence: 3,
      speaker: "prospect",
      text: turn3.text,
      relative_time_ms: turn3.relativeTimeMs,
      confidence: 0.95,
      is_final: true,
    });
    store.writeLog.length = 0;
    const out = await service.advanceCall(callId, { expectedCursor: 3 });
    expect(out.advanced).toBe(true);
    expect(out.repaired).toBe(true);
    // The deterministic segment id means the upsert no-ops: no duplication.
    expect(store.segments.length).toBe(4);
    expect(store.events.some((e) => e.segment_id === store.segments[3].id)).toBe(true);
  });

  it("rejects a stale client cursor that is AHEAD of the database", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, 2);
    await expect(service.advanceCall(callId, { expectedCursor: 5 })).rejects.toMatchObject({
      category: "STALE_CURSOR",
    });
  });

  it("a user can never touch another user's call", async () => {
    const store = new FakeStore();
    const serviceA = makeService(store, USER_A);
    const callId = await prepareAndStart(serviceA);
    const serviceB = makeService(store, USER_B);
    await expect(serviceB.advanceCall(callId, {})).rejects.toBeInstanceOf(CallServiceError);
    await expect(serviceB.endCall(callId)).rejects.toMatchObject({ category: "NOT_FOUND" });
  });

  it("end -> processing -> completed with a persisted review; retry is idempotent", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, 5); // early end: pain + competitor revealed
    const out = await service.endCall(callId, T0 + 30_000);
    const row = store.sessions.get(callId)!;
    expect(row.status).toBe("completed");
    expect(row.duration_seconds).toBe(30);
    expect(row.pipeline_recommendation).toBe("contacted"); // not enough evidence to qualify
    expect(row.purchase_intent_score).toBe(20); // confirmed pain only
    expect(row.purchase_intent_label).toBe("low");
    expect(row.review_payload).toEqual(out.review);
    expect(row.summary).toBeTruthy();

    store.writeLog.length = 0;
    const retry = await service.endCall(callId, T0 + 40_000);
    expect(retry.review).toEqual(out.review); // identical saved data
    expect(store.writeLog.length).toBe(0); // no duplicate generation writes
  });

  it("full fixture run ends with Contacted -> Qualified + a completed review", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, abcRoofingScenario.turns.length);
    const out = await service.endCall(callId, T0 + 240_000);
    expect(out.review.pipelineRecommendation.targetStage).toBe("qualified");
    expect(out.review.purchaseIntent.score).toBe(65);
    const row = store.sessions.get(callId)!;
    expect(row.pipeline_recommendation).toBe("qualified");
    expect(row.purchase_intent_score).toBe(65);
    expect(row.conversation_state).toBeTruthy();
    expect(store.segments.length).toBe(abcRoofingScenario.turns.length);
  });

  it("restart is deliberate: new call id, fresh prepared state, old rows intact", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, 6);
    const { newCallId, snapshot } = await service.restartCall(callId);
    expect(newCallId).not.toBe(callId);
    expect(snapshot.status).toBe("prepared");
    expect(snapshot.revealedTurnCount).toBe(0);
    const oldRow = store.sessions.get(callId)!;
    expect(oldRow.status).toBe("live");
    expect(store.segments.filter((s) => s.call_id === callId).length).toBe(6);
    expect(store.segments.filter((s) => s.call_id === newCallId).length).toBe(0);
  });

  it("records feedback: dismissal is not negative feedback; useful sets used_at", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, 8); // elaborate-pain -> LISTEN suggestion
    const listen = store.suggestions[0];
    expect(listen.action).toBe("LISTEN");

    await service.saveSuggestionFeedback(callId, listen.id, "dismiss", T0 + 50_000);
    const afterDismiss = store.suggestions.find((s) => s.id === listen.id)!;
    expect(afterDismiss.dismissed_at).toBe(new Date(T0 + 50_000).toISOString());
    expect(afterDismiss.feedback).toBeNull(); // dismissal is NOT negative feedback

    // Re-record on the same suggestion: useful sets used_at + feedback.
    await service.saveSuggestionFeedback(callId, listen.id, "useful", T0 + 55_000);
    const afterUse = store.suggestions.find((s) => s.id === listen.id)!;
    expect(afterUse.used_at).toBe(new Date(T0 + 55_000).toISOString());
    expect(afterUse.feedback).toBe("useful");
  });

  it("advancing past the end of the scenario errors with END_OF_SCENARIO", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, abcRoofingScenario.turns.length);
    await expect(service.advanceCall(callId, {})).rejects.toMatchObject({
      category: "END_OF_SCENARIO",
    });
  });
});

describe("simulation persistence — bounded snapshot + reconcile", () => {
  it("snapshot is bounded and reflects the authoritative state", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const { callId, snapshot } = await service.prepareCall({});
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "callId",
        "scenarioId",
        "scenarioCursor",
        "revealedTurnCount",
        "conversationStateVersion",
        "activeSuggestionId",
        "lastSavedAtMs",
        "status",
      ].sort()
    );
    await service.startCall(callId, T0);
    const live = await service.getLiveSnapshot(callId);
    expect(live?.status).toBe("live");
    expect(live?.revealedTurnCount).toBe(0);
  });

  it("reconcile adopts authoritative values (stale cursors are corrected)", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, 4);
    // A stale client snapshot from before the advances:
    const stale = await service.getLiveSnapshot(callId);
    const reconciled = await service.reconcileCallSnapshot(callId, {
      ...stale!,
      revealedTurnCount: 2,
      scenarioCursor: 2,
      conversationStateVersion: 1,
      activeSuggestionId: null,
    });
    expect(reconciled?.revealedTurnCount).toBe(4);
    expect(reconciled?.scenarioCursor).toBe(4);
    expect(reconciled?.conversationStateVersion).toBeGreaterThan(1);
  });

  it("snapshot is cleared on completion", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, 2);
    await service.endCall(callId, T0 + 10_000);
    expect(await service.getLiveSnapshot(callId)).toBeNull();
    const live = await service.getLiveSnapshot(callId);
    const reconciled = await service.reconcileCallSnapshot(callId, {
      callId,
      scenarioId: abcRoofingScenario.id,
      scenarioCursor: 2,
      revealedTurnCount: 2,
      conversationStateVersion: 1,
      activeSuggestionId: null,
      lastSavedAtMs: null,
      status: "live",
    });
    expect(reconciled).toBeNull(); // cleared on completion
    expect(live).toBeNull();
  });

  it("cancelling a call clears the snapshot and keeps the transcript", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await prepareAndStart(service);
    await advanceN(service, callId, 3);
    const { snapshot } = await service.cancelCall(callId, T0 + 10_000);
    expect(snapshot).toBeNull();
    const row = store.sessions.get(callId)!;
    expect(row.status).toBe("cancelled");
    expect(store.segments.filter((s) => s.call_id === callId).length).toBe(3);
  });
});
