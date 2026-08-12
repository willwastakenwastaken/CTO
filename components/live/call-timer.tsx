"use client";

// Client-side elapsed timer for the live workspace. The spec forbids
// per-second DB writes and full-page rerenders: this component owns its own
// 1s interval so only it re-renders, and it never talks to the server.
//
// Pause accumulation happens in the parent's event handler (pause is a view
// control); this component just receives the total paused time as a prop.
import { useEffect, useState } from "react";

export function formatCallDuration(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function CallTimer({
  startedAtMs,
  running,
  pausedMs,
}: {
  /** Wall-clock ms when the call went live; null = not started yet. */
  startedAtMs: number | null;
  /** True while the call is live and not paused (pause is a view control). */
  running: boolean;
  /** Total paused wall-clock ms accumulated by the parent's pause/resume. */
  pausedMs: number;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsed =
    startedAtMs !== null
      ? Math.max(0, nowMs - startedAtMs - pausedMs)
      : 0;

  return (
    <span
      className="tabular-nums text-sm text-muted-foreground"
      aria-label="Elapsed time"
      role="timer"
    >
      {formatCallDuration(elapsed)}
    </span>
  );
}
