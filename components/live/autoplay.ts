// Auto-play scheduling — a modest client-side interval that calls the advance
// action. Bounds are explicit and clamped so a busy loop can never spin faster
// than AUTO_PLAY_MIN_MS per turn. Pure so it is unit-testable.
export const AUTO_PLAY_MIN_MS = 2_000;
export const AUTO_PLAY_MAX_MS = 4_000;
export const AUTO_PLAY_INTERVAL_MS = 2_500;

/** Clamps an auto-play delay into the spec's modest 2–4s band. */
export function clampAutoPlayDelay(ms: number): number {
  if (!Number.isFinite(ms)) return AUTO_PLAY_INTERVAL_MS;
  return Math.min(AUTO_PLAY_MAX_MS, Math.max(AUTO_PLAY_MIN_MS, Math.round(ms)));
}

/** Whether an auto-play tick may fire right now. Auto-play stops itself the
 * moment a turn is in flight, the call is paused, or the scenario ends. */
export function shouldAutoPlayTick(input: {
  autoPlay: boolean;
  canAdvance: boolean;
}): boolean {
  return input.autoPlay && input.canAdvance;
}
