// Event-detection provider boundary — future vendor adapter (placeholder).
// Phase 1 uses a deterministic adapter that emits Zod-validated CallEvent
// shapes (see domain/events). Never parse arbitrary prose for app logic.

export interface EventDetectionProvider {
  readonly id: string;
  detect(input: unknown): Promise<unknown>;
  // TODO(Phase 1): deterministic adapter over structured scenario turns.
}
