// Purchase Intent heuristic — POST-EVIDENCE ONLY (after a call, from what was
// actually revealed). Explainable 0-100 heuristic, NOT a probability.
//
// Positive weights (max 100):
//   confirmed pain            20
//   confirmed impact          15
//   authority confirmed       15
//   timing confirmed          15
//   buying signals             5 each (cap 15, i.e. 3)
//   next-step commitment      10
//   budget known              10
//
// Penalties (subtracted, floor 0):
//   explicit rejection        30
//   bad fit                   25
//   unresolved price concern  20
//   blocked authority         15
//   incumbent satisfaction    10
//
// Unknown budget is NEVER negative evidence — it only adds to unknowns.
// With no evidence at all the result is INSUFFICIENT_DATA.

export const PURCHASE_INTENT_SCORING_VERSION = "purchase-intent@1";

export const PURCHASE_INTENT_WEIGHTS = {
  confirmedPain: 20,
  confirmedImpact: 15,
  authority: 15,
  timing: 15,
  buyingSignal: { perSignal: 5, cap: 15 },
  nextStepCommitment: 10,
  budgetKnown: 10,
} as const;

export const PURCHASE_INTENT_PENALTIES = {
  explicitRejection: 30,
  badFit: 25,
  unresolvedPriceConcern: 20,
  blockedAuthority: 15,
  incumbentSatisfaction: 10,
} as const;

export const PURCHASE_INTENT_LABELS = {
  high: "high",
  moderate: "moderate",
  low: "low",
  insufficientData: "insufficient_data",
} as const;
export type PurchaseIntentLabel =
  (typeof PURCHASE_INTENT_LABELS)[keyof typeof PURCHASE_INTENT_LABELS];

/** The seven evidence dimensions used for completeness. */
export const PURCHASE_INTENT_DIMENSIONS = [
  "pain",
  "impact",
  "authority",
  "timing",
  "buying signals",
  "next-step commitment",
  "budget",
] as const;

export interface PurchaseIntentFacts {
  pain: boolean;
  impact: boolean;
  authority: boolean;
  timing: boolean;
  /** Number of buying-signal events (>= 0). */
  buyingSignalCount: number;
  nextStepCommitment: boolean;
  budgetKnown: boolean;
}

export interface PurchaseIntentNegativeSignals {
  explicitRejection?: boolean;
  badFit?: boolean;
  unresolvedPriceConcern?: boolean;
  blockedAuthority?: boolean;
  incumbentSatisfaction?: boolean;
}

export interface PurchaseIntentInput {
  /** Evidence-backed positive statements (display; never invented). */
  positives: string[];
  /** Evidence-backed risk statements provided by the caller. */
  risks?: string[];
  /** Known-unknown dimensions provided by the caller. */
  unknowns?: string[];
  facts: PurchaseIntentFacts;
  negativeSignals?: PurchaseIntentNegativeSignals;
  /** Segment UUIDs the evidence came from. */
  segmentReferences?: string[];
}

export interface PurchaseIntentResult {
  /** null => insufficient data (no evidence revealed). */
  score: number | null;
  label: PurchaseIntentLabel;
  positives: string[];
  risks: string[];
  unknowns: string[];
  /** 0..1 — fraction of the seven evidence dimensions that are known. */
  evidenceCompleteness: number;
  scoringVersion: string;
  segmentReferences: string[];
  sufficient: boolean;
}

const RISK_LABELS: Record<keyof PurchaseIntentNegativeSignals, string> = {
  explicitRejection: "Explicit rejection",
  badFit: "Bad fit for the offering",
  unresolvedPriceConcern: "Unresolved price concern",
  blockedAuthority: "Decision blocked by higher authority",
  incumbentSatisfaction: "Satisfied with the current solution",
};

export function purchaseIntentLabelFor(score: number): PurchaseIntentLabel {
  if (score >= 70) return PURCHASE_INTENT_LABELS.high;
  if (score >= 40) return PURCHASE_INTENT_LABELS.moderate;
  return PURCHASE_INTENT_LABELS.low;
}

function unique(strings: string[]): string[] {
  return [...new Set(strings.map((s) => s.trim()).filter((s) => s.length > 0))];
}

/** Computes Purchase Intent from revealed call evidence only. */
export function computePurchaseIntent(
  input: PurchaseIntentInput
): PurchaseIntentResult {
  const facts = input.facts;
  const negative = input.negativeSignals ?? {};

  const positives = unique(input.positives);
  const risks = unique([
    ...(input.risks ?? []),
    ...(Object.entries(negative) as [keyof PurchaseIntentNegativeSignals, boolean][])
      .filter(([, value]) => value === true)
      .map(([key]) => RISK_LABELS[key]),
  ]);
  const unknowns = unique([
    ...(input.unknowns ?? []),
    ...(!facts.budgetKnown ? ["budget"] : []), // unknown budget is an unknown, NOT a risk
    ...(!facts.authority ? ["authority"] : []),
    ...(!facts.timing ? ["timing"] : []),
    ...(!facts.nextStepCommitment ? ["next-step commitment"] : []),
  ]);

  const hasAnyEvidence =
    positives.length > 0 ||
    risks.length > 0 ||
    facts.pain ||
    facts.impact ||
    facts.authority ||
    facts.timing ||
    facts.buyingSignalCount > 0 ||
    facts.nextStepCommitment ||
    facts.budgetKnown;

  if (!hasAnyEvidence) {
    return {
      score: null,
      label: PURCHASE_INTENT_LABELS.insufficientData,
      positives: [],
      risks: [],
      unknowns,
      evidenceCompleteness: 0,
      scoringVersion: PURCHASE_INTENT_SCORING_VERSION,
      segmentReferences: input.segmentReferences ?? [],
      sufficient: false,
    };
  }

  const positiveSum =
    (facts.pain ? PURCHASE_INTENT_WEIGHTS.confirmedPain : 0) +
    (facts.impact ? PURCHASE_INTENT_WEIGHTS.confirmedImpact : 0) +
    (facts.authority ? PURCHASE_INTENT_WEIGHTS.authority : 0) +
    (facts.timing ? PURCHASE_INTENT_WEIGHTS.timing : 0) +
    Math.min(
      facts.buyingSignalCount * PURCHASE_INTENT_WEIGHTS.buyingSignal.perSignal,
      PURCHASE_INTENT_WEIGHTS.buyingSignal.cap
    ) +
    (facts.nextStepCommitment ? PURCHASE_INTENT_WEIGHTS.nextStepCommitment : 0) +
    (facts.budgetKnown ? PURCHASE_INTENT_WEIGHTS.budgetKnown : 0);

  const penaltySum =
    (negative.explicitRejection === true ? PURCHASE_INTENT_PENALTIES.explicitRejection : 0) +
    (negative.badFit === true ? PURCHASE_INTENT_PENALTIES.badFit : 0) +
    (negative.unresolvedPriceConcern === true
      ? PURCHASE_INTENT_PENALTIES.unresolvedPriceConcern
      : 0) +
    (negative.blockedAuthority === true ? PURCHASE_INTENT_PENALTIES.blockedAuthority : 0) +
    (negative.incumbentSatisfaction === true
      ? PURCHASE_INTENT_PENALTIES.incumbentSatisfaction
      : 0);

  const score = Math.max(0, Math.min(100, positiveSum - penaltySum));

  const knownDimensions = [
    facts.pain,
    facts.impact,
    facts.authority,
    facts.timing,
    facts.buyingSignalCount > 0,
    facts.nextStepCommitment,
    facts.budgetKnown,
  ].filter(Boolean).length;
  const evidenceCompleteness = knownDimensions / PURCHASE_INTENT_DIMENSIONS.length;

  return {
    score,
    label: purchaseIntentLabelFor(score),
    positives,
    risks,
    unknowns,
    evidenceCompleteness,
    scoringVersion: PURCHASE_INTENT_SCORING_VERSION,
    segmentReferences: input.segmentReferences ?? [],
    sufficient: true,
  };
}
