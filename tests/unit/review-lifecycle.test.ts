// M7 — call review + lifecycle effects: finalize (idempotent review
// persistence + exactly-one note/activity/product event) and pipeline Apply
// with a stale-stage recheck. Uses the same in-memory CallStore pattern as
// simulation-persistence.test.ts (deterministic ids + upsert semantics).
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
import { T0 } from "./simulation-helpers";

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
    return this.segments.filter((s) => s.call_id === callId).sort((a, b) => a.sequence - b.sequence);
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
const PROSPECT_ID = "cccccccc-0000-4000-8000-000000000003";

function makeService(store: FakeStore, userId = USER_A): SimulationService {
  return createSimulationService({ store, userId });
}

/** Runs the full ABC fixture to the end of the scenario. */
async function runFullCall(service: SimulationService, store: FakeStore): Promise<string> {
  const { callId } = await service.prepareCall({ prospectId: PROSPECT_ID });
  store.prospects.set(PROSPECT_ID, {
    id: PROSPECT_ID,
    user_id: USER_A,
    first_name: "John",
    last_name: "Smith",
    company: "ABC Roofing",
    stage: "contacted",
    last_contact_at: null,
  });
  await service.startCall(callId, T0);
  for (let i = 0; i < abcRoofingScenario.turns.length; i += 1) {
    const out = await service.advanceCall(callId, { expectedCursor: i });
    if (!out.advanced) throw new Error(`expected advance at cursor ${i}`);
  }
  return callId;
}

describe("M7 finalize review — lifecycle persistence", () => {
  it("full ABC call finalizes: completed review persisted, exactly one note + activity + product event", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await runFullCall(service, store);

    const result = await service.finalizeReview(callId, T0 + 240_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);

    const row = store.sessions.get(callId)!;
    expect(row.status).toBe("completed");
    expect(row.pipeline_recommendation).toBe("qualified");
    expect(row.purchase_intent_score).toBe(65);
    expect(row.duration_seconds).toBe(240);
    expect(result.review.preCallStage).toBe("contacted");
    expect((row.review_payload as { preCallStage: string | null }).preCallStage).toBe("contacted");

    // Exactly one structured call-summary note with Situation/Pain/Impact/...
    const notes = store.notes.filter((n) => n.call_id === callId);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.type).toBe("call_summary");
    expect(note.title).toBe("Call summary — ABC Roofing practice");
    expect(note.body).toBe(result.review.summary);
    const sc = note.structured_content as Record<string, unknown>;
    expect(sc).toHaveProperty("situation");
    expect(sc).toHaveProperty("pain");
    expect(sc).toHaveProperty("impact");
    expect(sc).toHaveProperty("nextStep");
    expect(sc).toHaveProperty("evidence");

    // Exactly one call_completed activity with scores in metadata.
    const completed = store.activities.filter((a) => a.call_id === callId && a.type === "call_completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]!.summary).toBe("Practice call completed — Contacted → Qualified recommended");
    const meta = completed[0]!.metadata as { purchaseIntent: { score: number } };
    expect(meta.purchaseIntent.score).toBe(65);

    // Exactly one review_created product event.
    const created = store.productEvents.filter((e) => e.session_id === callId && e.type === "review_created");
    expect(created).toHaveLength(1);
    expect((created[0]!.metadata as { recommendation: string }).recommendation).toBe("qualified");
  });

  it("finalize is idempotent end-to-end: re-run creates nothing new and re-fetches", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await runFullCall(service, store);

    const first = await service.finalizeReview(callId, T0 + 240_000);
    if (!first.ok) throw new Error("expected ok");
    expect(first.created).toBe(true);

    store.writeLog.length = 0;
    const second = await service.finalizeReview(callId, T0 + 300_000);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.review).toEqual(first.review);
    expect(store.notes.filter((n) => n.call_id === callId)).toHaveLength(1);
    expect(store.activities.filter((a) => a.call_id === callId && a.type === "call_completed")).toHaveLength(1);
    expect(store.productEvents.filter((e) => e.session_id === callId)).toHaveLength(1);
    // Re-fetch path is read-only: no writes at all.
    expect(store.writeLog).toHaveLength(0);
  });

  it("refuses cancelled and failed calls (no review)", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const { callId } = await service.prepareCall({});
    await service.startCall(callId, T0);
    await service.cancelCall(callId, T0 + 10_000);

    const result = await service.finalizeReview(callId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe("NO_REVIEW");

    // Simulate a failed call (state machine permits processing -> failed).
    const failedCall = (await service.prepareCall({})).callId;
    await service.startCall(failedCall, T0);
    store.sessions.set(failedCall, { ...store.sessions.get(failedCall)!, status: "failed" });
    const failed = await service.finalizeReview(failedCall);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.category).toBe("NO_REVIEW");
  });

  it("refuses a prepared call (not ended) and a not-owned call (NOT_FOUND)", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const { callId } = await service.prepareCall({});

    const prepared = await service.finalizeReview(callId);
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.error.category).toBe("INVALID_STATE");

    const other = makeService(store, USER_B);
    await expect(other.finalizeReview(callId)).rejects.toBeInstanceOf(CallServiceError);
    await expect(other.finalizeReview(callId)).rejects.toMatchObject({ category: "NOT_FOUND" });
  });

  it("re-finalizing a completed call with an existing review returns it without mutation", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await runFullCall(service, store);
    const first = await service.finalizeReview(callId, T0 + 240_000);
    if (!first.ok) throw new Error("expected ok");

    const before = JSON.stringify(store.sessions.get(callId)!.review_payload);
    const again = await service.finalizeReview(callId, T0 + 500_000);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.created).toBe(false);
    expect(JSON.stringify(store.sessions.get(callId)!.review_payload)).toBe(before);
    expect(again.review).toEqual(first.review);
  });
});

describe("M7 apply recommendation — stale-stage recheck + idempotency", () => {
  it("applies when the stage is unchanged, recording one stage_changed activity", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await runFullCall(service, store);
    await service.finalizeReview(callId, T0 + 240_000);

    const result = await service.applyReviewRecommendation(callId, { nowMs: T0 + 300_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toStage).toBe("qualified");
    expect(result.applied).toBe(true);
    expect(result.changed).toBe(true);

    const prospect = store.prospects.get(PROSPECT_ID)!;
    expect(prospect.stage).toBe("qualified");
    expect(prospect.last_contact_at).toBe(new Date(T0 + 300_000).toISOString());
    const stageChanged = store.activities.filter((a) => a.type === "stage_changed");
    expect(stageChanged).toHaveLength(1);
    expect(store.productEvents.some((e) => e.type === "review_applied")).toBe(true);
  });

  it("blocks with STALE_STAGE when the prospect moved since the call; applies after explicit confirm", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await runFullCall(service, store);
    await service.finalizeReview(callId, T0 + 240_000);

    // The prospect moved while the review sat unapplied.
    store.prospects.set(PROSPECT_ID, { ...store.prospects.get(PROSPECT_ID)!, stage: "meeting_booked" });

    const blocked = await service.applyReviewRecommendation(callId, { confirmed: false, nowMs: T0 + 300_000 });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    if (blocked.error.category !== "STALE_STAGE") throw new Error("expected STALE_STAGE");
    expect(blocked.error.currentStage).toBe("meeting_booked");
    expect(blocked.error.expectedStage).toBe("contacted");
    expect(store.prospects.get(PROSPECT_ID)!.stage).toBe("meeting_booked"); // not moved
    expect(store.activities.filter((a) => a.type === "stage_changed")).toHaveLength(0);

    const confirmed = await service.applyReviewRecommendation(callId, { confirmed: true, nowMs: T0 + 310_000 });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.toStage).toBe("qualified");
    expect(store.prospects.get(PROSPECT_ID)!.stage).toBe("qualified");
    expect(store.activities.filter((a) => a.type === "stage_changed")).toHaveLength(1);
  });

  it("applying twice is a no-op: one stage_changed activity, stage unchanged", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const callId = await runFullCall(service, store);
    await service.finalizeReview(callId, T0 + 240_000);

    const first = await service.applyReviewRecommendation(callId, { nowMs: T0 + 300_000 });
    expect(first.ok && first.applied).toBe(true);
    const second = await service.applyReviewRecommendation(callId, { nowMs: T0 + 400_000 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.applied).toBe(false);
    expect(second.changed).toBe(false);
    expect(store.prospects.get(PROSPECT_ID)!.stage).toBe("qualified");
    expect(store.activities.filter((a) => a.type === "stage_changed")).toHaveLength(1);
    expect(store.productEvents.filter((e) => e.type === "review_applied")).toHaveLength(1);
  });

  it("refuses to apply for an unlinked call and a call with no review", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const { callId } = await service.prepareCall({});
    await service.startCall(callId, T0);

    const noReview = await service.applyReviewRecommendation(callId, {});
    expect(noReview.ok).toBe(false);
    if (noReview.ok) return;
    expect(noReview.error.category).toBe("NO_REVIEW");

    const linked = await runFullCall(service, store);
    await service.finalizeReview(linked, T0 + 240_000);
    store.sessions.set(linked, { ...store.sessions.get(linked)!, prospect_id: null });
    const noProspect = await service.applyReviewRecommendation(linked, {});
    expect(noProspect.ok).toBe(false);
    if (!noProspect.ok) expect(noProspect.error.category).toBe("NO_PROSPECT");
  });
});
