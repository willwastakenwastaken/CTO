// Scoring domain types (placeholder).
// Scores are 0–100 explainable evidence-based heuristics — NOT statistical
// probabilities. Never invent evidence. Unknown budget is NOT negative
// evidence. "insufficient data" is a valid result.

export interface OpportunityFitScore {
  score: number | null; // null => insufficient data
  label: string;
  reasons: string[];
  // TODO(Phase 1): dimension reasons (industry, ideal-customer match, size,
  // geography, verified need), scoring version.
}

export interface PurchaseIntentScore {
  score: number | null;
  label: string;
  positives: string[];
  risks: string[];
  unknowns: string[];
  // TODO(Phase 1): evidence completeness, scoring version, segment references.
}
