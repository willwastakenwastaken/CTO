// Post-call analysis provider boundary — future vendor adapter (placeholder).
// Phase 1 uses a deterministic adapter producing the structured review payload:
// outcome, Purchase Intent with evidence, summary, next action, coaching
// observations, pipeline recommendation + reason. Never fabricate quotes.

export interface PostCallAnalysisProvider {
  readonly id: string;
  analyze(input: unknown): Promise<unknown>;
  // TODO(Phase 1): review payload shape (see domain/scoring + domain/coaching).
}
