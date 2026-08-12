"use client";

// Simulation controls — start, pause/resume, manual next turn, optional
// auto-play, end early, and a deliberate Restart that mints a NEW call id.
// Controls are disabled at the right times (prevent rapid double advancement;
// the server also rejects stale cursors).
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipForward, RotateCcw, CircleStop } from "lucide-react";
import type { CallSessionStatus } from "@/domain/sessions/types";
import {
  canAdvance,
  canEnd,
  canPause,
  canResume,
  canStart,
  canToggleAutoPlay,
} from "@/components/live/controls-state";
import { cn } from "@/lib/utils";

export type ControlBusy =
  | "advance"
  | "start"
  | "pause"
  | "end"
  | "cancel"
  | "restart"
  | "feedback"
  | null;

export function SimulationControls({
  status,
  paused,
  inFlight,
  endOfScenario,
  autoPlay,
  busy,
  onStart,
  onTogglePause,
  onAdvance,
  onToggleAutoPlay,
  onEndEarly,
  onRestart,
}: {
  status: CallSessionStatus;
  paused: boolean;
  inFlight: boolean;
  endOfScenario: boolean;
  autoPlay: boolean;
  busy: ControlBusy;
  onStart: () => void;
  onTogglePause: () => void;
  onAdvance: () => void;
  onToggleAutoPlay: () => void;
  onEndEarly: () => void;
  onRestart: () => void;
}) {
  const statusLine = busy === "advance" ? "Analyzing objection…" : null;

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Simulation controls"
    >
      {canStart(status) && (
        <Button size="sm" disabled={busy !== null} onClick={onStart}>
          <Play aria-hidden="true" className="size-3.5" />
          Start call
        </Button>
      )}

      {canPause(status, paused) && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={onTogglePause}
        >
          <Pause aria-hidden="true" className="size-3.5" />
          Pause
        </Button>
      )}

      {canResume(status, paused) && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={onTogglePause}
        >
          <Play aria-hidden="true" className="size-3.5" />
          Resume
        </Button>
      )}

      <Button
        size="sm"
        variant="outline"
        disabled={!canAdvance(status, paused, inFlight, endOfScenario) || busy !== null}
        onClick={onAdvance}
      >
        <SkipForward aria-hidden="true" className="size-3.5" />
        Next turn
      </Button>

      <label
        className={cn(
          "flex items-center gap-2 text-sm",
          !canToggleAutoPlay(status, endOfScenario) && "opacity-50"
        )}
      >
        <input
          type="checkbox"
          className="size-3.5 accent-(--primary)"
          checked={autoPlay}
          disabled={!canToggleAutoPlay(status, endOfScenario) || busy !== null}
          onChange={onToggleAutoPlay}
        />
        Auto-play
      </label>

      {canEnd(status) && (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={onEndEarly}
            className="text-muted-foreground"
          >
            <CircleStop aria-hidden="true" className="size-3.5" />
            End early
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={onRestart}
            className="text-muted-foreground"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Restart
          </Button>
        </>
      )}

      <span
        className="ml-auto text-xs text-muted-foreground"
        aria-live="polite"
        role="status"
      >
        {statusLine ?? (endOfScenario ? "Scenario complete — end the session to see the review." : "")}
      </span>
    </div>
  );
}
