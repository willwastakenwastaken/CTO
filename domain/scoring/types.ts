// Scoring domain types. Scores are 0–100 explainable evidence-based
// heuristics — NOT statistical probabilities. Never invent evidence. Unknown
// budget is NOT negative evidence. "insufficient data" is a valid result.
export type {
  OpportunityFitDimensionReason,
  OpportunityFitIdealCustomer,
  OpportunityFitInput,
  OpportunityFitLabel,
  OpportunityFitResult,
} from "@/domain/scoring/opportunity-fit";
export type {
  PurchaseIntentFacts,
  PurchaseIntentInput,
  PurchaseIntentLabel,
  PurchaseIntentNegativeSignals,
  PurchaseIntentResult,
} from "@/domain/scoring/purchase-intent";
