import { describe, expect, it } from "vitest";
import {
  computePurchaseIntent,
  PURCHASE_INTENT_SCORING_VERSION,
} from "@/domain/scoring/purchase-intent";

const empty = {
  positives: [],
  facts: {
    pain: false,
    impact: false,
    authority: false,
    timing: false,
    buyingSignalCount: 0,
    nextStepCommitment: false,
    budgetKnown: false,
  },
};

describe("purchase intent — insufficient data", () => {
  it("returns insufficient_data with no revealed evidence", () => {
    const result = computePurchaseIntent({ ...empty });
    expect(result.score).toBeNull();
    expect(result.label).toBe("insufficient_data");
    expect(result.sufficient).toBe(false);
    expect(result.evidenceCompleteness).toBe(0);
    expect(result.scoringVersion).toBe(PURCHASE_INTENT_SCORING_VERSION);
  });
});

describe("purchase intent — positives, risks, unknowns", () => {
  it("scores a well-evidenced opportunity high and reports positives", () => {
    const result = computePurchaseIntent({
      positives: [
        "Confirmed pain: slow callbacks",
        "Impact: four or five missed jobs",
      ],
      facts: {
        pain: true,
        impact: true,
        authority: true,
        timing: true,
        buyingSignalCount: 3,
        nextStepCommitment: true,
        budgetKnown: true,
      },
      segmentReferences: ["seg-1", "seg-2"],
    });
    expect(result.score).toBe(100);
    expect(result.label).toBe("high");
    expect(result.positives).toHaveLength(2);
    expect(result.evidenceCompleteness).toBe(1);
    expect(result.segmentReferences).toEqual(["seg-1", "seg-2"]);
  });

  it("unknown budget is NOT negative evidence — it is an unknown", () => {
    const withBudget = computePurchaseIntent({
      ...empty,
      facts: { ...empty.facts, pain: true },
    });
    const withoutBudget = computePurchaseIntent({
      ...empty,
      facts: { ...empty.facts, pain: true, budgetKnown: false },
    });
    // same score — unknown budget adds nothing negative
    expect(withoutBudget.score).toBe(withBudget.score);
    expect(withoutBudget.risks).not.toContain("budget");
    expect(withoutBudget.unknowns).toContain("budget");
  });

  it("known budget is a small positive and never a risk", () => {
    const result = computePurchaseIntent({
      ...empty,
      facts: { ...empty.facts, pain: true, budgetKnown: true },
    });
    expect(result.score).toBe(30); // pain 20 + budget 10
    expect(result.risks).not.toContain("budget");
    expect(result.unknowns).not.toContain("budget");
  });

  it("explicit rejection reduces the heuristic substantially", () => {
    const base = {
      ...empty,
      facts: { ...empty.facts, pain: true, impact: true, authority: true, timing: true, buyingSignalCount: 3, budgetKnown: true },
    };
    const positive = computePurchaseIntent(base);
    const rejected = computePurchaseIntent({ ...base, negativeSignals: { explicitRejection: true } });
    expect(positive.score).toBe(90);
    expect(rejected.score).toBe(60);
    expect(rejected.risks).toContain("Explicit rejection");
    expect(rejected.label).toBe("moderate");
  });

  it("all penalties floor at zero and are surfaced as risks", () => {
    const result = computePurchaseIntent({
      ...empty,
      facts: { ...empty.facts, pain: true },
      negativeSignals: {
        explicitRejection: true,
        badFit: true,
        unresolvedPriceConcern: true,
        blockedAuthority: true,
        incumbentSatisfaction: true,
      },
    });
    expect(result.score).toBe(0);
    expect(result.risks).toEqual(
      expect.arrayContaining([
        "Explicit rejection",
        "Bad fit for the offering",
        "Unresolved price concern",
        "Decision blocked by higher authority",
        "Satisfied with the current solution",
      ])
    );
  });

  it("caps buying-signal credit at three signals", () => {
    const three = computePurchaseIntent({
      ...empty,
      facts: { ...empty.facts, buyingSignalCount: 3 },
    });
    const ten = computePurchaseIntent({
      ...empty,
      facts: { ...empty.facts, buyingSignalCount: 10 },
    });
    expect(three.score).toBe(15);
    expect(ten.score).toBe(15);
  });

  it("labels and completeness reflect partial evidence", () => {
    const result = computePurchaseIntent({
      ...empty,
      facts: { ...empty.facts, pain: true, authority: true, timing: true },
    });
    expect(result.score).toBe(50); // 20 + 15 + 15
    expect(result.label).toBe("moderate");
    expect(result.evidenceCompleteness).toBeCloseTo(3 / 7);
    expect(result.unknowns).toEqual(
      expect.arrayContaining(["budget", "next-step commitment"])
    );
  });

  it("dedupes caller risks against derived risks", () => {
    const result = computePurchaseIntent({
      ...empty,
      risks: ["Explicit rejection"],
      negativeSignals: { explicitRejection: true },
      facts: { ...empty.facts, pain: true },
    });
    expect(result.risks.filter((r) => r === "Explicit rejection")).toHaveLength(1);
  });
});
