// Coaching provider boundary — future vendor adapter (placeholder).
// Phase 1 uses a deterministic intervention policy: one concise suggestion at
// the right moment, calm Listening state otherwise. May return NO suggestion.

export interface CoachingProvider {
  readonly id: string;
  suggest(input: unknown): Promise<unknown>;
  // TODO(Phase 1): intervention policy — event priority, stage, recent
  // transcript, cooldown, repetition, call objective, guardrails.
}
