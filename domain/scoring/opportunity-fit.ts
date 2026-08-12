// Opportunity Fit heuristic — PRE-CALL, from observable prospect
// characteristics only (industry, ideal-customer match, company size,
// geography when relevant, verified need indicators). Returns INSUFFICIENT_DATA
// when inputs are inadequate. This is an explainable 0-100 heuristic, NOT a
// "likelihood to buy" and NOT a probability.
//
// Dimension weights (explicit constants; renormalized over the dimensions
// that were actually scored so the total always stays 0-100):
//   industry            25
//   ideal-customer match 30
//   company size         20
//   geography (when relevant) 10
//   verified need indicators  15

export const OPPORTUNITY_FIT_SCORING_VERSION = "opportunity-fit@1";

export const OPPORTUNITY_FIT_DIMENSIONS = {
  industry: { weight: 25, label: "industry" },
  idealCustomer: { weight: 30, label: "ideal-customer match" },
  companySize: { weight: 20, label: "company size" },
  geography: { weight: 10, label: "geography" },
  verifiedNeed: { weight: 15, label: "verified need indicators" },
} as const;

export const OPPORTUNITY_FIT_MIN_SCORED_DIMENSIONS = 2;

export const OPPORTUNITY_FIT_LABELS = {
  strong: "strong",
  moderate: "moderate",
  weak: "weak",
  poor: "poor",
  insufficientData: "insufficient_data",
} as const;
export type OpportunityFitLabel =
  (typeof OPPORTUNITY_FIT_LABELS)[keyof typeof OPPORTUNITY_FIT_LABELS];

/** Reference profile (from the sales profile / call strategy) used to judge
 * ideal-customer match. All fields optional — missing reference data simply
 * leaves dimensions unscored (never fabricated). */
export interface OpportunityFitIdealCustomer {
  industries?: string[];
  sizes?: string[];
  geographies?: string[];
}

export interface OpportunityFitInput {
  /** Prospect industry, e.g. "Roofing & Exteriors". */
  industry?: string | null;
  /** Prospect company size, e.g. "1-10". */
  companySize?: string | null;
  /** Prospect location, e.g. "Chicago, IL". */
  location?: string | null;
  idealCustomer?: OpportunityFitIdealCustomer | null;
  /** Explicit rep assessment of ideal-customer match, if recorded. */
  idealCustomerMatch?: boolean | null;
  /** When true, geography is a relevant dimension for this prospect. */
  geographyRelevant?: boolean;
  /** Verified need indicators (e.g. "slow callbacks confirmed"). */
  verifiedNeedIndicators?: string[] | null;
}

export interface OpportunityFitDimensionReason {
  dimension: string;
  /** 0-100 sub-score, or null when the dimension was not scorable. */
  score: number | null;
  reason: string;
}

export interface OpportunityFitResult {
  /** null => insufficient data. */
  score: number | null;
  label: OpportunityFitLabel;
  dimensionReasons: OpportunityFitDimensionReason[];
  scoringVersion: string;
  sufficient: boolean;
  /** Human-readable explanation of why data is insufficient (when it is). */
  insufficientReason: string | null;
}

function includesAny(haystack: string | null | undefined, needles: string[]): boolean {
  if (!haystack) return false;
  const h = haystack.toLowerCase();
  return needles.some((n) => n.length > 0 && h.includes(n.toLowerCase()));
}

function industryScore(
  industry: string | null | undefined,
  ideal: OpportunityFitIdealCustomer | null | undefined
): OpportunityFitDimensionReason {
  const industries = ideal?.industries ?? [];
  if (!industry || industries.length === 0) {
    return {
      dimension: OPPORTUNITY_FIT_DIMENSIONS.industry.label,
      score: null,
      reason:
        industry && industries.length === 0
          ? "Industry known but no ideal-customer industries recorded — unscored."
          : "Industry unknown — unscored.",
    };
  }
  const matched = includesAny(industry, industries);
  return {
    dimension: OPPORTUNITY_FIT_DIMENSIONS.industry.label,
    score: matched ? 100 : 40,
    reason: matched
      ? "Industry aligns with the stated ideal customer."
      : "Industry known but outside the stated ideal-customer industries.",
  };
}

function companySizeScore(
  size: string | null | undefined,
  ideal: OpportunityFitIdealCustomer | null | undefined
): OpportunityFitDimensionReason {
  const sizes = ideal?.sizes ?? [];
  if (!size || sizes.length === 0) {
    return {
      dimension: OPPORTUNITY_FIT_DIMENSIONS.companySize.label,
      score: null,
      reason:
        size && sizes.length === 0
          ? "Company size known but no ideal sizes recorded — unscored."
          : "Company size unknown — unscored.",
    };
  }
  const matched = includesAny(size, sizes);
  return {
    dimension: OPPORTUNITY_FIT_DIMENSIONS.companySize.label,
    score: matched ? 100 : 40,
    reason: matched
      ? "Company size fits the stated ideal customer."
      : "Company size known but outside the stated ideal sizes.",
  };
}

function geographyScore(
  location: string | null | undefined,
  ideal: OpportunityFitIdealCustomer | null | undefined
): OpportunityFitDimensionReason {
  const geographies = ideal?.geographies ?? [];
  if (!location || geographies.length === 0) {
    return {
      dimension: OPPORTUNITY_FIT_DIMENSIONS.geography.label,
      score: null,
      reason:
        location && geographies.length === 0
          ? "Geography is relevant but no target geographies recorded — unscored."
          : "Geography is relevant but location unknown — unscored.",
    };
  }
  const matched = includesAny(location, geographies);
  return {
    dimension: OPPORTUNITY_FIT_DIMENSIONS.geography.label,
    score: matched ? 100 : 30,
    reason: matched
      ? "Location is inside the target geography."
      : "Location is outside the target geography.",
  };
}

function verifiedNeedScore(
  indicators: string[] | null | undefined
): OpportunityFitDimensionReason {
  const list = (indicators ?? []).filter((i) => i.trim().length > 0);
  if (list.length === 0) {
    return {
      dimension: OPPORTUNITY_FIT_DIMENSIONS.verifiedNeed.label,
      score: null,
      reason: "No verified need indicators recorded — unscored.",
    };
  }
  const capped = Math.min(list.length, 2);
  return {
    dimension: OPPORTUNITY_FIT_DIMENSIONS.verifiedNeed.label,
    score: capped * 50,
    reason: `${list.length} verified need indicator${list.length === 1 ? "" : "s"} recorded.`,
  };
}

function labelFor(score: number): OpportunityFitLabel {
  if (score >= 75) return OPPORTUNITY_FIT_LABELS.strong;
  if (score >= 50) return OPPORTUNITY_FIT_LABELS.moderate;
  if (score >= 25) return OPPORTUNITY_FIT_LABELS.weak;
  return OPPORTUNITY_FIT_LABELS.poor;
}

/** Computes Opportunity Fit from observable pre-call characteristics. */
export function computeOpportunityFit(
  input: OpportunityFitInput
): OpportunityFitResult {
  const reasons: OpportunityFitDimensionReason[] = [
    industryScore(input.industry, input.idealCustomer),
    companySizeScore(input.companySize, input.idealCustomer),
  ];

  if (input.idealCustomerMatch !== null && input.idealCustomerMatch !== undefined) {
    reasons.push({
      dimension: OPPORTUNITY_FIT_DIMENSIONS.idealCustomer.label,
      score: input.idealCustomerMatch ? 100 : 0,
      reason: input.idealCustomerMatch
        ? "Explicit ideal-customer assessment is a match."
        : "Explicit ideal-customer assessment is not a match.",
    });
  } else {
    reasons.push({
      dimension: OPPORTUNITY_FIT_DIMENSIONS.idealCustomer.label,
      score: null,
      reason: "No ideal-customer assessment recorded — unscored.",
    });
  }

  if (input.geographyRelevant === true) {
    reasons.push(geographyScore(input.location, input.idealCustomer));
  } else {
    reasons.push({
      dimension: OPPORTUNITY_FIT_DIMENSIONS.geography.label,
      score: null,
      reason: "Geography not relevant for this prospect — unscored.",
    });
  }

  reasons.push(verifiedNeedScore(input.verifiedNeedIndicators));

  const scored = reasons.filter(
    (r): r is OpportunityFitDimensionReason & { score: number } =>
      r.score !== null
  );

  if (scored.length < OPPORTUNITY_FIT_MIN_SCORED_DIMENSIONS) {
    return {
      score: null,
      label: OPPORTUNITY_FIT_LABELS.insufficientData,
      dimensionReasons: reasons,
      scoringVersion: OPPORTUNITY_FIT_SCORING_VERSION,
      sufficient: false,
      insufficientReason: `Only ${scored.length} of at least ${OPPORTUNITY_FIT_MIN_SCORED_DIMENSIONS} fit dimensions are knowable. Add prospect and ideal-customer details to compute fit.`,
    };
  }

  const totalWeight = scored.reduce((sum, r) => {
    const dim = Object.values(OPPORTUNITY_FIT_DIMENSIONS).find(
      (d) => d.label === r.dimension
    );
    return sum + (dim ? dim.weight : 0);
  }, 0);
  const weighted = scored.reduce((sum, r) => {
    const dim = Object.values(OPPORTUNITY_FIT_DIMENSIONS).find(
      (d) => d.label === r.dimension
    );
    const weight = dim ? dim.weight : 0;
    return sum + weight * r.score;
  }, 0);
  const score = Math.round(weighted / totalWeight);

  return {
    score,
    label: labelFor(score),
    dimensionReasons: reasons,
    scoringVersion: OPPORTUNITY_FIT_SCORING_VERSION,
    sufficient: true,
    insufficientReason: null,
  };
}
