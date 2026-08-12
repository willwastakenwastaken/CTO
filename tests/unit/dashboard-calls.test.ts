// M9a — Calls list filter predicates + status/scenario labels. Every filter
// reads only stored call_sessions columns; each predicate is tested directly.
import { describe, expect, it } from "vitest";
import {
  applyCallsFilter,
  CALLS_FILTERS,
  callScenarioLabel,
  DEFAULT_CALLS_FILTER,
  EXPLICIT_REJECTION_RISK,
  humanizeCallStatus,
  isCallsFilterValue,
  matchCallsFilter,
  recordedRisks,
  type CallsFilterValue,
} from "@/lib/dashboard/calls";
import type { CallSessionRow } from "@/lib/calls/types";

const UUID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function makeCall(overrides: Partial<CallSessionRow>): CallSessionRow {
  return {
    id: UUID(1),
    user_id: "user-a",
    prospect_id: null,
    sales_profile_id: null,
    mode: "practice",
    scenario: "abc_roofing",
    is_simulated: true,
    status: "completed",
    objective: null,
    timing: null,
    started_at: "2026-08-12T10:00:00Z",
    duration_seconds: 480,
    outcome: "discovery_call",
    opportunity_fit_score: null,
    opportunity_fit_label: null,
    opportunity_fit_explanation: null,
    purchase_intent_score: 80,
    purchase_intent_label: "high",
    purchase_intent_explanation: null,
    evidence: { positives: [], risks: [], unknowns: [] },
    summary: null,
    next_action: "Confirm Wednesday's joint demo",
    pipeline_recommendation: "qualified",
    pipeline_recommendation_reason: "Strong fit and clear timing.",
    conversation_state: {},
    review_payload: null,
    error: null,
    ...overrides,
  };
}

describe("filter vocabulary", () => {
  it("exposes exactly the spec's filter set", () => {
    expect(CALLS_FILTERS.map((f) => f.value)).toEqual([
      "all",
      "high_intent",
      "follow_up",
      "qualified",
      "not_interested",
      "practice",
    ]);
    expect(CALLS_FILTERS.map((f) => f.label)).toEqual([
      "All",
      "High intent",
      "Follow-up",
      "Qualified",
      "Not interested",
      "Practice",
    ]);
    expect(DEFAULT_CALLS_FILTER).toBe("all");
  });

  it("validates filter values defensively", () => {
    expect(isCallsFilterValue("all")).toBe(true);
    expect(isCallsFilterValue("practice")).toBe(true);
    expect(isCallsFilterValue("won")).toBe(false);
    expect(isCallsFilterValue(undefined)).toBe(false);
    expect(isCallsFilterValue(["all"])).toBe(false);
  });
});

describe("matchCallsFilter — all", () => {
  it("matches every stored call regardless of status", () => {
    const rows = [
      makeCall({ status: "prepared" }),
      makeCall({ id: UUID(2), status: "live" }),
      makeCall({ id: UUID(3), status: "completed" }),
      makeCall({ id: UUID(4), status: "cancelled" }),
    ];
    for (const row of rows) {
      expect(matchCallsFilter("all", row)).toBe(true);
    }
  });
});

describe("matchCallsFilter — high intent", () => {
  it("matches only completed calls whose stored label is high", () => {
    expect(matchCallsFilter("high_intent", makeCall({ status: "completed", purchase_intent_label: "high" }))).toBe(true);
    // Moderate / insufficient data / missing label never match.
    expect(matchCallsFilter("high_intent", makeCall({ purchase_intent_label: "moderate" }))).toBe(false);
    expect(matchCallsFilter("high_intent", makeCall({ purchase_intent_label: "insufficient_data" }))).toBe(false);
    expect(matchCallsFilter("high_intent", makeCall({ purchase_intent_label: null }))).toBe(false);
    // An unfinished call never matches even with a label.
    expect(matchCallsFilter("high_intent", makeCall({ status: "live", purchase_intent_label: "high" }))).toBe(false);
  });
});

describe("matchCallsFilter — follow-up", () => {
  it("matches completed calls with a stored next action", () => {
    expect(matchCallsFilter("follow_up", makeCall({ status: "completed", next_action: "Book a demo" }))).toBe(true);
    expect(matchCallsFilter("follow_up", makeCall({ status: "completed", next_action: null }))).toBe(false);
    expect(matchCallsFilter("follow_up", makeCall({ status: "completed", next_action: "   " }))).toBe(false);
    // Unfinished calls never match (no review -> no follow-up step).
    expect(matchCallsFilter("follow_up", makeCall({ status: "live", next_action: "Book a demo" }))).toBe(false);
  });
});

describe("matchCallsFilter — qualified", () => {
  it("matches completed calls whose review recommended qualified", () => {
    expect(matchCallsFilter("qualified", makeCall({ status: "completed", pipeline_recommendation: "qualified" }))).toBe(true);
    expect(matchCallsFilter("qualified", makeCall({ status: "completed", pipeline_recommendation: "contacted" }))).toBe(false);
    expect(matchCallsFilter("qualified", makeCall({ status: "completed", pipeline_recommendation: null }))).toBe(false);
    expect(matchCallsFilter("qualified", makeCall({ status: "prepared", pipeline_recommendation: "qualified" }))).toBe(false);
  });
});

describe("matchCallsFilter — not interested", () => {
  it("matches completed calls whose recorded risks include an explicit rejection", () => {
    const rejected = makeCall({
      status: "completed",
      evidence: { risks: ["Explicit rejection", "Unresolved price concern"] },
    });
    expect(matchCallsFilter("not_interested", rejected)).toBe(true);
    const priceOnly = makeCall({
      status: "completed",
      evidence: { risks: ["Unresolved price concern"] },
    });
    expect(matchCallsFilter("not_interested", priceOnly)).toBe(false);
    // Missing/malformed evidence is never treated as rejection.
    expect(matchCallsFilter("not_interested", makeCall({ evidence: {} }))).toBe(false);
    expect(matchCallsFilter("not_interested", makeCall({ evidence: null }))).toBe(false);
    expect(matchCallsFilter("not_interested", makeCall({ status: "live", evidence: { risks: [EXPLICIT_REJECTION_RISK] } }))).toBe(false);
  });

  it("recordedRisks reads only the stored evidence array", () => {
    expect(recordedRisks(makeCall({ evidence: { risks: ["a", "b"] } }))).toEqual(["a", "b"]);
    expect(recordedRisks(makeCall({ evidence: {} }))).toEqual([]);
    expect(recordedRisks(makeCall({ evidence: null }))).toEqual([]);
    expect(recordedRisks(makeCall({ evidence: { risks: [1, "ok"] } }))).toEqual(["ok"]);
  });
});

describe("matchCallsFilter — practice", () => {
  it("matches standalone practice calls (no linked prospect)", () => {
    expect(matchCallsFilter("practice", makeCall({ prospect_id: null }))).toBe(true);
    expect(matchCallsFilter("practice", makeCall({ prospect_id: UUID(9) }))).toBe(false);
    // Every status qualifies — the filter is about practice-vs-prospect.
    expect(matchCallsFilter("practice", makeCall({ prospect_id: null, status: "completed" }))).toBe(true);
  });
});

describe("applyCallsFilter", () => {
  it("filters a mixed list without mutating it", () => {
    const rows = [
      makeCall({ id: UUID(1), status: "completed", purchase_intent_label: "high" }),
      makeCall({ id: UUID(2), status: "completed", purchase_intent_label: "moderate" }),
      makeCall({ id: UUID(3), status: "live", prospect_id: UUID(9) }),
      makeCall({ id: UUID(4), status: "completed", prospect_id: null, purchase_intent_label: "moderate" }),
    ];
    expect(applyCallsFilter(rows, "high_intent").map((r) => r.id)).toEqual([UUID(1)]);
    expect(applyCallsFilter(rows, "practice").map((r) => r.id)).toEqual([UUID(1), UUID(2), UUID(4)]);
    expect(applyCallsFilter(rows, "all")).toHaveLength(4);
    expect(rows).toHaveLength(4); // input untouched
  });
});

describe("humanizeCallStatus", () => {
  it("renders every call status human-readably", () => {
    expect(humanizeCallStatus("prepared")).toBe("Prepared");
    expect(humanizeCallStatus("live")).toBe("Live");
    expect(humanizeCallStatus("processing")).toBe("Processing");
    expect(humanizeCallStatus("completed")).toBe("Completed");
    expect(humanizeCallStatus("cancelled")).toBe("Cancelled");
    expect(humanizeCallStatus("failed")).toBe("Failed");
    expect(humanizeCallStatus(null)).toBe("—");
    expect(humanizeCallStatus(undefined)).toBe("—");
  });
});

describe("callScenarioLabel", () => {
  it("resolves known scenario slugs and falls back honestly", () => {
    expect(callScenarioLabel("abc_roofing")).toBe("ABC Roofing — practice call");
    expect(callScenarioLabel(null)).toBe("Practice call");
    expect(callScenarioLabel("")).toBe("Practice call");
    expect(callScenarioLabel("some_future_scenario")).toBe("Some Future Scenario");
  });
});

/** Exhaustive sweep: every filter accepts every filter value (no dead codes). */
describe("filter exhaustiveness", () => {
  it("all six filter values are handled by matchCallsFilter", () => {
    const values: CallsFilterValue[] = ["all", "high_intent", "follow_up", "qualified", "not_interested", "practice"];
    const row = makeCall({});
    for (const value of values) {
      expect(typeof matchCallsFilter(value, row)).toBe("boolean");
    }
  });
});
