"use client";

// Focused header — prospect + company, clearly visible PRACTICE badge, elapsed
// timer (client-side only), End Session. No sidebar on this screen.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CallTimer } from "@/components/live/call-timer";

export function CallHeader({
  prospectName,
  prospectCompany,
  startedAtMs,
  timerRunning,
  pausedMs,
  busy,
  onEnd,
}: {
  prospectName: string;
  prospectCompany: string;
  startedAtMs: number | null;
  timerRunning: boolean;
  /** Total paused ms (view control) for the client-side elapsed timer. */
  pausedMs: number;
  /** True while the end request is in flight ("Generating call review…"). */
  busy: boolean;
  onEnd: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-base font-semibold tracking-tight">
            {prospectName}
          </h1>
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            title="Simulated practice call — no real audio"
          >
            <span aria-hidden="true" className="mr-1 size-1 rounded-full bg-amber-500" />
            PRACTICE
          </Badge>
        </div>
        <p className="truncate text-sm text-muted-foreground">{prospectCompany}</p>
      </div>
      <div className="ml-auto flex items-center gap-4">
        <CallTimer startedAtMs={startedAtMs} running={timerRunning} pausedMs={pausedMs} />
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={onEnd}
        >
          End Session
        </Button>
      </div>
    </header>
  );
}
