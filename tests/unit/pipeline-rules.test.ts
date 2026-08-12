import { describe, expect, it } from "vitest";
import {
  applyStageTransition,
  canTransitionStage,
  isTerminalStage,
  nextStages,
  PIPELINE_TRANSITIONS,
  type PipelineErrorCategory,
} from "@/domain/pipeline/rules";
import { nextUuid } from "./helpers";

const U = nextUuid;

function apply(currentStage: string, targetStage: string, overrides: Partial<Parameters<typeof applyStageTransition>[0]> = {}) {
  return applyStageTransition({
    prospectId: U(),
    currentStage: currentStage as never,
    expectedStage: currentStage as never,
    targetStage: targetStage as never,
    confirmed: false,
    ...overrides,
  });
}

describe("pipeline rules — allowed transitions", () => {
  it("follows the linear pipeline with sensible skips", () => {
    expect(canTransitionStage("new", "researching")).toBe(true);
    expect(canTransitionStage("new", "ready_to_contact")).toBe(true); // skip
    expect(canTransitionStage("new", "contacted")).toBe(true); // skip
    expect(canTransitionStage("contacted", "qualified")).toBe(true);
    expect(canTransitionStage("qualified", "meeting_booked")).toBe(true);
    expect(canTransitionStage("meeting_booked", "proposal")).toBe(true);
    expect(canTransitionStage("proposal", "closed_won")).toBe(true);
    expect(canTransitionStage("proposal", "closed_lost")).toBe(true);
  });

  it("rejects illegal skips and backwards jumps", () => {
    expect(canTransitionStage("new", "proposal")).toBe(false);
    expect(canTransitionStage("new", "meeting_booked")).toBe(false);
    expect(canTransitionStage("new", "qualified")).toBe(false);
    expect(canTransitionStage("contacted", "meeting_booked")).toBe(false);
    expect(canTransitionStage("qualified", "closed_won")).toBe(false); // needs proposal/meeting first
    expect(canTransitionStage("ready_to_contact", "proposal")).toBe(false);
  });

  it("allows a limited set of re-qualification backwards moves", () => {
    expect(canTransitionStage("qualified", "contacted")).toBe(true);
    expect(canTransitionStage("proposal", "meeting_booked")).toBe(true);
    expect(canTransitionStage("meeting_booked", "qualified")).toBe(true);
  });

  it("locks terminal stages", () => {
    expect(canTransitionStage("closed_won", "closed_lost")).toBe(false);
    expect(canTransitionStage("closed_lost", "proposal")).toBe(false);
    expect(isTerminalStage("closed_won")).toBe(true);
    expect(isTerminalStage("closed_lost")).toBe(true);
    expect(isTerminalStage("qualified")).toBe(false);
    expect(nextStages("contacted")).toEqual(["qualified", "ready_to_contact", "closed_lost"]);
  });

  it("applies a legal transition", () => {
    const result = applyStageTransition({
      prospectId: U(),
      currentStage: "contacted",
      expectedStage: "contacted",
      targetStage: "qualified",
      confirmed: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.nextStage).toBe("qualified");
  });
});

describe("pipeline rules — terminal confirmation", () => {
  it("requires explicit confirmation for terminal stages", () => {
    const result = apply("proposal", "closed_won");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe(
        "TERMINAL_CONFIRMATION_REQUIRED" satisfies PipelineErrorCategory
      );
    }
  });

  it("applies terminal transitions when confirmed", () => {
    const result = apply("proposal", "closed_won", { confirmed: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.nextStage).toBe("closed_won");
  });

  it("does not require confirmation for non-terminal stages", () => {
    const result = apply("contacted", "qualified");
    expect(result.ok).toBe(true);
  });
});

describe("pipeline rules — stale rejection", () => {
  it("rejects when the current stage no longer matches the expected stage", () => {
    const result = applyStageTransition({
      prospectId: U(),
      currentStage: "qualified", // someone else already moved it
      expectedStage: "contacted", // this client's stale view
      targetStage: "meeting_booked",
      confirmed: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("STALE_CURSOR" satisfies PipelineErrorCategory);
      expect(result.error.message).toContain("qualified");
    }
  });
});

describe("pipeline rules — guards and errors", () => {
  it("rejects malformed prospect ids with NOT_FOUND", () => {
    const result = applyStageTransition({
      prospectId: "12345",
      currentStage: "contacted",
      expectedStage: "contacted",
      targetStage: "qualified",
      confirmed: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("NOT_FOUND" satisfies PipelineErrorCategory);
      expect(result.error.message).toContain("UUID");
    }
  });

  it("rejects a transition out of a terminal stage with TERMINAL_LOCKED", () => {
    const result = apply("closed_won", "proposal");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("TERMINAL_LOCKED" satisfies PipelineErrorCategory);
    }
  });

  it("rejects an illegal pair with INVALID_TRANSITION", () => {
    const result = apply("new", "proposal");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("INVALID_TRANSITION" satisfies PipelineErrorCategory);
    }
  });

  it("exposes every stage in PIPELINE_TRANSITIONS", () => {
    expect(Object.keys(PIPELINE_TRANSITIONS)).toHaveLength(9);
    for (const [from, tos] of Object.entries(PIPELINE_TRANSITIONS)) {
      expect(tos).not.toContain(from); // no self-loops
    }
  });
});
