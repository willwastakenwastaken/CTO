// Scoring provider boundary — future vendor adapter (placeholder).
// Phase 1 uses deterministic explainable heuristics: Opportunity Fit (pre-call)
// and Purchase Intent (post-evidence). Scores are never invented.

export interface ScoringProvider {
  readonly id: string;
  scoreOpportunityFit(input: unknown): Promise<unknown>;
  scorePurchaseIntent(input: unknown): Promise<unknown>;
  // TODO(Phase 1): heuristics with dimension reasons + scoring version.
}
