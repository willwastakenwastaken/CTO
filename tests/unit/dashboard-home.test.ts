// M9a — Home dashboard aggregations: upcoming-action sorting (incl. overdue),
// recent-call selection, pipeline stage counts, and activity formatting.
// Pure functions over stored rows — no fake metrics.
import { describe, expect, it } from "vitest";
import {
  activityTypeLabel,
  callRowLabel,
  countStages,
  datePart,
  formatActivitySummary,
  HOME_RECENT_CALLS_LIMIT,
  selectRecentCalls,
  selectUpcomingActions,
} from "@/lib/dashboard/home";
import type { ActivityRow, ProspectRow } from "@/lib/prospects/types";
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

function makeCall(overrides: Partial<CallSessionRow>): CallSessionRow {
  return {
    id: UUID(1),
    user_id: "user-a",
    prospect_id: null,
    sales_profile_id: null,
    mode: "practice",
    scenario: "abc_roofing",
    is_simulated: true,
    status: "prepared",
    objective: null,
    timing: null,
    started_at: null,
    duration_seconds: null,
    outcome: null,
    opportunity_fit_score: null,
    opportunity_fit_label: null,
    opportunity_fit_explanation: null,
    purchase_intent_score: null,
    purchase_intent_label: null,
    purchase_intent_explanation: null,
    evidence: {},
    summary: null,
    next_action: null,
    pipeline_recommendation: null,
    pipeline_recommendation_reason: null,
    conversation_state: {},
    review_payload: null,
    error: null,
    ...overrides,
  };
}

describe("datePart", () => {
  it("normalizes ISO timestamps and date-only strings to the day key", () => {
    expect(datePart("2026-08-12T15:30:00Z")).toBe("2026-08-12");
    expect(datePart("2026-08-12")).toBe("2026-08-12");
    expect(datePart(null)).toBeNull();
    expect(datePart("")).toBeNull();
    expect(datePart("soon")).toBeNull();
  });
});

describe("selectUpcomingActions", () => {
  it("includes only prospects with a stored next action", () => {
    const prospects = [
      makeProspect({ id: UUID(1), first_name: "A", next_action: "Call back", next_action_due_date: "2026-08-20" }),
      makeProspect({ id: UUID(2), first_name: "B", next_action: null, next_action_due_date: "2026-08-10" }),
      makeProspect({ id: UUID(3), first_name: "C", next_action: "", next_action_due_date: "2026-08-10" }),
    ];
    const actions = selectUpcomingActions(prospects, "2026-08-12");
    expect(actions).toHaveLength(1);
    expect(actions[0].prospect.id).toBe(UUID(1));
  });

  it("sorts due-soon first and flags overdue honestly", () => {
    const prospects = [
      makeProspect({ id: UUID(1), first_name: "Late", next_action: "Overdue task", next_action_due_date: "2026-08-01" }),
      makeProspect({ id: UUID(2), first_name: "Soon", next_action: "Soon task", next_action_due_date: "2026-08-13" }),
      makeProspect({ id: UUID(3), first_name: "Today", next_action: "Today task", next_action_due_date: "2026-08-12" }),
      makeProspect({ id: UUID(4), first_name: "No date", next_action: "No date task", next_action_due_date: null }),
    ];
    const actions = selectUpcomingActions(prospects, "2026-08-12");
    // Overdue first, then due-soon (today then tomorrow), then no-date.
    expect(actions.map((a) => a.prospect.id)).toEqual([UUID(1), UUID(3), UUID(2), UUID(4)]);
    expect(actions[0].overdue).toBe(true);
    expect(actions[0].dueToday).toBe(false);
    expect(actions[1].overdue).toBe(false);
    expect(actions[1].dueToday).toBe(true);
    expect(actions[2].overdue).toBe(false);
    expect(actions[2].dueDate).toBe("2026-08-13");
    expect(actions[3].dueDate).toBeNull();
    expect(actions[3].overdue).toBe(false);
  });

  it("respects the limit and never fabricates dates", () => {
    const prospects = [
      makeProspect({ id: UUID(1), first_name: "A", next_action: "a", next_action_due_date: "2026-08-13" }),
      makeProspect({ id: UUID(2), first_name: "B", next_action: "b", next_action_due_date: "2026-08-14" }),
      makeProspect({ id: UUID(3), first_name: "C", next_action: "c", next_action_due_date: "2026-08-15" }),
    ];
    const actions = selectUpcomingActions(prospects, "2026-08-12", 2);
    expect(actions).toHaveLength(2);
    expect(actions[0].prospect.id).toBe(UUID(1));
    expect(actions[1].prospect.id).toBe(UUID(2));
  });

  it("is stable when two actions share a due date (name tiebreak)", () => {
    const prospects = [
      makeProspect({ id: UUID(2), first_name: "Zeta", next_action: "z", next_action_due_date: "2026-08-13" }),
      makeProspect({ id: UUID(1), first_name: "Alpha", next_action: "a", next_action_due_date: "2026-08-13" }),
    ];
    const actions = selectUpcomingActions(prospects, "2026-08-12");
    expect(actions.map((a) => a.prospect.id)).toEqual([UUID(1), UUID(2)]);
  });
});

describe("selectRecentCalls", () => {
  it("orders newest first by created_at and caps at the limit", () => {
    const sessions = [
      makeCall({ id: UUID(1), created_at: "2026-08-01T10:00:00Z" }),
      makeCall({ id: UUID(2), created_at: "2026-08-03T10:00:00Z" }),
      makeCall({ id: UUID(3), created_at: "2026-08-02T10:00:00Z" }),
      makeCall({ id: UUID(4), created_at: "2026-08-04T10:00:00Z" }),
      makeCall({ id: UUID(5), created_at: "2026-08-05T10:00:00Z" }),
      makeCall({ id: UUID(6), created_at: "2026-08-06T10:00:00Z" }),
    ];
    const recent = selectRecentCalls(sessions, 5);
    expect(recent.map((c) => c.id)).toEqual([UUID(6), UUID(5), UUID(4), UUID(2), UUID(3)]);
    expect(recent).toHaveLength(HOME_RECENT_CALLS_LIMIT);
  });

  it("falls back to started_at when created_at is missing and never errors", () => {
    const sessions = [
      makeCall({ id: UUID(1), created_at: null, started_at: "2026-08-01T10:00:00Z" }),
      makeCall({ id: UUID(2), created_at: null, started_at: "2026-08-05T10:00:00Z" }),
      makeCall({ id: UUID(3), created_at: null, started_at: null }),
    ];
    const recent = selectRecentCalls(sessions);
    expect(recent.map((c) => c.id)).toEqual([UUID(2), UUID(1), UUID(3)]);
  });

  it("does not mutate the input list", () => {
    const sessions = [
      makeCall({ id: UUID(1), created_at: "2026-08-01T10:00:00Z" }),
      makeCall({ id: UUID(2), created_at: "2026-08-03T10:00:00Z" }),
    ];
    const original = [sessions[0], sessions[1]];
    selectRecentCalls(sessions);
    expect(sessions).toEqual(original);
  });
});

describe("countStages", () => {
  it("counts stored prospects per stage in canonical pipeline order", () => {
    const prospects = [
      makeProspect({ stage: "qualified" }),
      makeProspect({ stage: "new" }),
      makeProspect({ stage: "qualified" }),
      makeProspect({ stage: "closed_lost" }),
    ];
    const stages = countStages(prospects);
    expect(stages.find((s) => s.stage === "new")?.count).toBe(1);
    expect(stages.find((s) => s.stage === "qualified")?.count).toBe(2);
    expect(stages.find((s) => s.stage === "closed_lost")?.count).toBe(1);
    expect(stages.find((s) => s.stage === "meeting_booked")?.count).toBe(0);
    // Canonical order: new, researching, ready_to_contact, contacted, qualified...
    expect(stages.map((s) => s.stage)).toEqual([
      "new", "researching", "ready_to_contact", "contacted", "qualified",
      "meeting_booked", "proposal", "closed_won", "closed_lost",
    ]);
  });

  it("returns all zeros for no prospects (honest, not fake data)", () => {
    const stages = countStages([]);
    expect(stages).toHaveLength(9);
    expect(stages.every((s) => s.count === 0)).toBe(true);
  });
});

describe("activity formatting", () => {
  it("prefers the stored summary verbatim", () => {
    const activity: Pick<ActivityRow, "type" | "summary" | "metadata"> = {
      type: "stage_changed",
      summary: "Pipeline stage changed — Contacted → Qualified.",
      metadata: { fromStage: "contacted", toStage: "qualified" },
    };
    expect(formatActivitySummary(activity)).toBe("Pipeline stage changed — Contacted → Qualified.");
  });

  it("falls back to a type label + metadata prospect name when no summary", () => {
    const activity: Pick<ActivityRow, "type" | "summary" | "metadata"> = {
      type: "prospect_created",
      summary: null,
      metadata: { prospectName: "ABC Roofing" },
    };
    expect(formatActivitySummary(activity)).toBe("Prospect created — ABC Roofing");
  });

  it("falls back to a humanized type label when nothing else is stored", () => {
    const activity: Pick<ActivityRow, "type" | "summary" | "metadata"> = {
      type: "call_completed",
      summary: null,
      metadata: {},
    };
    expect(formatActivitySummary(activity)).toBe("Call completed");
    expect(activityTypeLabel("something_new")).toBe("Something New");
    expect(activityTypeLabel("call_completed")).toBe("Call completed");
  });
});

describe("callRowLabel", () => {
  it("uses the prospect name, then company, then an honest Practice call label", () => {
    expect(callRowLabel({ prospectName: "John Smith", prospectCompany: "ABC Roofing" })).toBe("John Smith");
    expect(callRowLabel({ prospectName: null, prospectCompany: "ABC Roofing" })).toBe("ABC Roofing");
    expect(callRowLabel({ prospectName: "", prospectCompany: "  " })).toBe("Practice call");
  });
});
