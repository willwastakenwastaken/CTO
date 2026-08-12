// Formatting helpers for durations. Used by call timers, reviews, and lists.

/**
 * Formats a millisecond duration as a compact string:
 *   < 1s        -> "0s"
 *   seconds     -> "45s"
 *   minutes     -> "12m 30s"
 *   hours       -> "1h 02m"
 * Negative/non-finite input is clamped to 0 (a timer never runs backwards).
 */
export function formatDuration(ms: number): string {
  const clamped = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/** Formats a duration as the seconds-only integer the DB stores. */
export function toDurationSeconds(ms: number): number {
  const clamped = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return Math.floor(clamped / 1000);
}
/** "contacted" -> "Contacted"; "ready_to_contact" -> "Ready to contact". */
export function humanizeStage(stage: string | null | undefined): string {
  if (!stage) return "—";
  return stage
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
