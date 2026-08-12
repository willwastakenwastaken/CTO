// M6 Live workspace unit tests — pure helpers only (no DB, no Next runtime).
import { describe, expect, it } from "vitest";
import {
  buildWorkspace,
  heroKickers,
  selectSignalWindow,
  MAX_SIGNALS,
  type LiveWorkspace,
  type WorkspaceEvent,
} from "@/lib/calls/workspace";
import {
  canAdvance,
  canEnd,
  canPause,
  canResume,
  canRestart,
  canStart,
  canToggleAutoPlay,
  isTerminal,
} from "@/components/live/controls-state";
import {
  AUTO_PLAY_MAX_MS,
  AUTO_PLAY_MIN_MS,
  clampAutoPlayDelay,
  shouldAutoPlayTick,
} from "@/components/live/autoplay";
import { formatCallDuration } from "@/components/live/call-timer";
import { createTestSession } from "./simulation-helpers";
import { abcRoofingScenario } from "@/providers/simulation/abc-roofing";
import type { SimulationSession } from "@/domain/simulation/types";
import type {
  AiSuggestionRow,
  CallEventRow,
  CallSessionRow,
  TranscriptSegmentRow,
} from "@/lib/calls/types";
import type { LiveSessionSnapshot } from "@/domain/simulation/snapshot";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeSessionRow(overrides: Partial<CallSessionRow> = {}): CallSessionRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "user-1",
    prospect_id: null,
    sales_profile_id: null,
    mode: "practice",
    scenario: "abc_roofing",
    is_simulated: true,
    status: "live",
    objective: abcRoofingScenario.callObjective,
    timing: null,
    started_at: "2026-01-01T00:00:00.000Z",
    duration_seconds: null,
    outcome: null,
    opportunity_fit_score: null,
    opportunity_fit_label: null,
    opportunity_fit_explanation: null,
    purchase_intent_score: null,
    purchase_intent_label: null,
    purchase_intent_explanation: null,
    evidence: [],
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

function makeEvent(overrides: Partial<CallEventRow>): CallEventRow {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    user_id: "user-1",
    call_id: "00000000-0000-4000-8000-000000000001",
    segment_id: null,
    type: "PAIN_DISCOVERED",
    category: "neutral",
    confidence: 0.9,
    speaker: "prospect",
    exact_evidence: "we're slow to get back to people",
    importance: 7,
    relative_time_ms: 15_000,
    metadata: {},
    ...overrides,
  };
}

function makeSegment(overrides: Partial<TranscriptSegmentRow>): TranscriptSegmentRow {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    user_id: "user-1",
    call_id: "00000000-0000-4000-8000-000000000001",
    sequence: 1,
    speaker: "prospect",
    text: "hello",
    relative_time_ms: 5_000,
    confidence: 1,
    is_final: true,
    ...overrides,
  };
}

function workspaceFor(
  session: SimulationSession,
  overrides: {
    row?: Partial<CallSessionRow>;
    segments?: TranscriptSegmentRow[];
    events?: CallEventRow[];
    suggestions?: AiSuggestionRow[];
  } = {}
): LiveWorkspace {
  return buildWorkspace({
    row: makeSessionRow(overrides.row),
    segments: overrides.segments ?? [],
    events: overrides.events ?? [],
    suggestions: overrides.suggestions ?? [],
    session,
    scenario: abcRoofingScenario,
    prospect: null,
  });
}

// ---------------------------------------------------------------------------
// buildWorkspace
// ---------------------------------------------------------------------------

describe("buildWorkspace", () => {
  it("maps rows into the serializable workspace payload", () => {
    const session = createTestSession();
    session.activeSuggestionId = "sug-1";
    session.suggestions = [
      {
        id: "sug-1",
        action: "ASK",
        text: "About how much is one new customer worth?",
        reason: "Quantify value before defending price.",
        priority: 8,
        eventId: null,
        createdAtMs: 75_000,
        expiresAtMs: 150_000,
        dismissedAtMs: null,
        usedAtMs: null,
        feedback: null,
        supersedesId: null,
        supersededBy: null,
      },
    ];
    const w = workspaceFor(session, {
      segments: [makeSegment({ sequence: 1, text: "hello", speaker: "rep" })],
      events: [makeEvent({ type: "PRICE_DISCUSSION", relative_time_ms: 75_000, metadata: { isConcern: true } })],
    });

    expect(w.callId).toBe(session.callId);
    expect(w.status).toBe("live");
    expect(w.simulated).toBe(true);
    expect(w.scenarioTurnCount).toBe(abcRoofingScenario.turns.length);
    expect(w.segments).toHaveLength(1);
    expect(w.segments[0].text).toBe("hello");
    expect(w.events[0].metadata).toEqual({ isConcern: true });
    expect(w.activeSuggestion?.text).toContain("one new customer worth");
    expect(w.activeSuggestion?.action).toBe("ASK");
    expect(w.snapshot?.activeSuggestionId).toBe("sug-1");
    expect(w.snapshot?.revealedTurnCount).toBe(0);
  });

  it("falls back to the scenario prospect when no prospect row is linked", () => {
    const w = workspaceFor(createTestSession());
    expect(w.prospectName).toBe(abcRoofingScenario.prospectName);
    expect(w.prospectCompany).toBe(abcRoofingScenario.prospectCompany);
  });

  it("prefers the linked prospect identity for the header", () => {
    const session = createTestSession();
    const w = buildWorkspace({
      row: makeSessionRow({ prospect_id: "00000000-0000-4000-8000-000000000099" }),
      segments: [],
      events: [],
      suggestions: [],
      session,
      scenario: abcRoofingScenario,
      prospect: { name: "Linked Prospect", company: "Linked Co" },
    });
    expect(w.prospectName).toBe("Linked Prospect");
    expect(w.prospectCompany).toBe("Linked Co");
  });

  it("clears the snapshot when the call is terminal", () => {
    const session = createTestSession();
    session.status = "completed";
    const w = workspaceFor(session, { row: { status: "completed" } });
    expect(w.status).toBe("completed");
    expect(w.snapshot).toBeNull();
  });

  it("exposes dismissed/used suggestions in history but not as active", () => {
    const session = createTestSession();
    session.activeSuggestionId = null;
    session.suggestions = [
      {
        id: "sug-1",
        action: "ASK",
        text: "old",
        reason: null,
        priority: 8,
        eventId: null,
        createdAtMs: 75_000,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
        dismissedAtMs: 80_000,
        usedAtMs: null,
        feedback: null,
        supersedesId: null,
        supersededBy: null,
      },
    ];
    const w = workspaceFor(session);
    expect(w.suggestions).toHaveLength(1);
    expect(w.suggestions[0].dismissedAtMs).toBe(80_000);
    expect(w.activeSuggestion).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// selectSignalWindow — "only three to five recent meaningful signals"
// ---------------------------------------------------------------------------

describe("selectSignalWindow", () => {
  function ev(id: string, type: WorkspaceEvent["type"], t: number): WorkspaceEvent {
    return { id, type, category: "neutral", speaker: "prospect", exactEvidence: `q-${id}`, importance: 5, relativeTimeMs: t, metadata: {} };
  }

  it("excludes prospect questions (handled by the hero, not the signal feed)", () => {
    const events = [ev("a", "QUESTION", 1000), ev("b", "PAIN_DISCOVERED", 2000)];
    const window = selectSignalWindow(events);
    expect(window.map((e) => e.id)).toEqual(["b"]);
  });

  it("returns at most MAX_SIGNALS, most recent first", () => {
    const events = [
      ev("a", "PAIN_DISCOVERED", 1000),
      ev("b", "COMPETITOR_MENTION", 2000),
      ev("c", "PAIN_DISCOVERED", 3000),
      ev("d", "PRICE_DISCUSSION", 4000),
      ev("e", "TIMELINE_SIGNAL", 5000),
      ev("f", "AUTHORITY_SIGNAL", 6000),
      ev("g", "BUYING_SIGNAL", 7000),
    ];
    const window = selectSignalWindow(events);
    expect(window).toHaveLength(MAX_SIGNALS);
    expect(window.map((e) => e.id)).toEqual(["g", "f", "e", "d", "c"]);
  });

  it("is deterministic under ties (stable by event id)", () => {
    const events = [ev("b", "OBJECTION", 1000), ev("a", "OBJECTION", 1000)];
    const first = selectSignalWindow(events);
    const second = selectSignalWindow([...events].reverse());
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
  });

  it("returns an empty window when nothing meaningful has happened", () => {
    expect(selectSignalWindow([])).toEqual([]);
    expect(selectSignalWindow([ev("a", "QUESTION", 1000)])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// heroKickers — "PRICE CONCERN / ASK NEXT"
// ---------------------------------------------------------------------------

describe("heroKickers", () => {
  const events: WorkspaceEvent[] = [
    {
      id: "ev-price",
      type: "PRICE_DISCUSSION",
      category: "negative",
      speaker: "prospect",
      exactEvidence: "five hundred a month is more than I was expecting",
      importance: 8,
      relativeTimeMs: 75_000,
      metadata: { isConcern: true },
    },
    {
      id: "ev-plain-price",
      type: "PRICE_DISCUSSION",
      category: "neutral",
      speaker: "prospect",
      exactEvidence: "how do you price that?",
      importance: 5,
      relativeTimeMs: 80_000,
      metadata: {},
    },
  ];

  it("labels a price concern + ASK as Price concern / Ask next", () => {
    const kickers = heroKickers({ action: "ASK", eventId: "ev-price" }, events);
    expect(kickers.eventLabel).toBe("Price concern");
    expect(kickers.actionLabel).toBe("Ask next");
  });

  it("reads a plain price discussion as Price discussion (not concern)", () => {
    const kickers = heroKickers({ action: "SAY", eventId: "ev-plain-price" }, events);
    expect(kickers.eventLabel).toBe("Price discussion");
    expect(kickers.actionLabel).toBe("Say this");
  });

  it("shows both kickers when they read differently (LISTEN after a concern)", () => {
    const kickers = heroKickers({ action: "LISTEN", eventId: "ev-price" }, events);
    expect(kickers.eventLabel).toBe("Price concern");
    expect(kickers.actionLabel).toBe("Listen");
  });

  it("falls back to the action label when there is no trigger event", () => {
    const kickers = heroKickers({ action: "CLOSE", eventId: null }, events);
    expect(kickers.eventLabel).toBeNull();
    expect(kickers.actionLabel).toBe("Close");
  });
});

// ---------------------------------------------------------------------------
// Control state machine
// ---------------------------------------------------------------------------

describe("control state machine", () => {
  it("start is only available on a prepared call", () => {
    expect(canStart("prepared")).toBe(true);
    expect(canStart("live")).toBe(false);
    expect(canStart("completed")).toBe(false);
  });

  it("pause/resume are mutually exclusive live view controls", () => {
    expect(canPause("live", false)).toBe(true);
    expect(canPause("live", true)).toBe(false);
    expect(canPause("prepared", false)).toBe(false);
    expect(canResume("live", true)).toBe(true);
    expect(canResume("live", false)).toBe(false);
    expect(canResume("completed", true)).toBe(false);
  });

  it("advance is blocked while paused, in flight, or past the end of scenario", () => {
    expect(canAdvance("live", false, false, false)).toBe(true);
    expect(canAdvance("live", true, false, false)).toBe(false);
    expect(canAdvance("live", false, true, false)).toBe(false);
    expect(canAdvance("live", false, false, true)).toBe(false);
    expect(canAdvance("prepared", false, false, false)).toBe(false);
  });

  it("auto-play and end/restart follow the same lifecycle", () => {
    expect(canToggleAutoPlay("live", false)).toBe(true);
    expect(canToggleAutoPlay("live", true)).toBe(false);
    expect(canToggleAutoPlay("completed", false)).toBe(false);
    expect(canEnd("prepared")).toBe(true);
    expect(canEnd("live")).toBe(true);
    expect(canEnd("processing")).toBe(false);
    expect(canRestart("live")).toBe(true);
    expect(canRestart("completed")).toBe(false);
  });

  it("detects terminal statuses", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("live")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Auto-play scheduling bounds
// ---------------------------------------------------------------------------

describe("auto-play scheduling", () => {
  it("clamps delays into the modest 2–4s band", () => {
    expect(clampAutoPlayDelay(0)).toBe(AUTO_PLAY_MIN_MS);
    expect(clampAutoPlayDelay(-5)).toBe(AUTO_PLAY_MIN_MS);
    expect(clampAutoPlayDelay(2_500)).toBe(2_500);
    expect(clampAutoPlayDelay(60_000)).toBe(AUTO_PLAY_MAX_MS);
    expect(clampAutoPlayDelay(Number.NaN)).toBe(2_500);
    expect(clampAutoPlayDelay(Number.POSITIVE_INFINITY)).toBe(2_500);
  });

  it("the default interval sits inside the allowed band", () => {
    expect(clampAutoPlayDelay(2_500)).toBe(2_500);
    expect(AUTO_PLAY_MIN_MS).toBeLessThanOrEqual(2_500);
    expect(2_500).toBeLessThanOrEqual(AUTO_PLAY_MAX_MS);
  });

  it("only ticks when auto-play is on and an advance is allowed", () => {
    expect(shouldAutoPlayTick({ autoPlay: true, canAdvance: true })).toBe(true);
    expect(shouldAutoPlayTick({ autoPlay: true, canAdvance: false })).toBe(false);
    expect(shouldAutoPlayTick({ autoPlay: false, canAdvance: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Elapsed timer formatting
// ---------------------------------------------------------------------------

describe("formatCallDuration", () => {
  it("formats minutes:seconds with zero padding", () => {
    expect(formatCallDuration(0)).toBe("00:00");
    expect(formatCallDuration(5_000)).toBe("00:05");
    expect(formatCallDuration(65_000)).toBe("01:05");
    expect(formatCallDuration(600_000)).toBe("10:00");
  });

  it("never renders negative time", () => {
    expect(formatCallDuration(-1_000)).toBe("00:00");
  });
});

// Keep the snapshot type referenced so the file compiles against the service
// contract (reconcile clears the snapshot on terminal calls).
export type _SnapshotContract = LiveSessionSnapshot | null;
