"use client";

// Signals — only the 3–5 most recent meaningful events (type + short evidence
// quote). Most recent first, deterministically ordered, no gauges.
import { selectSignalWindow, type WorkspaceEvent } from "@/lib/calls/workspace";
import { eventLabel } from "@/lib/calls/workspace";
import { formatCallDuration } from "@/components/live/call-timer";
import { cn } from "@/lib/utils";

/** Neutral dot + uppercase type + verbatim quote. Non-color cues: the label
 * text itself carries the meaning, so color-blind users are not left out. */
export function Signals({ events }: { events: readonly WorkspaceEvent[] }) {
  const window = selectSignalWindow(events);
  if (window.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No signals yet — they appear here as the conversation unfolds.
      </p>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Recent signals">
      {window.map((event) => (
        <li key={event.id} className="flex items-start gap-2 text-sm">
          <span
            aria-hidden="true"
            className={cn(
              "mt-1.5 size-1.5 shrink-0 rounded-full",
              event.category === "positive" && "bg-emerald-500/70",
              event.category === "negative" && "bg-amber-500/70",
              event.category === "neutral" && "bg-muted-foreground/50"
            )}
          />
          <div className="min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {eventLabel(event.type, event.metadata)}
            </span>
            <p className="line-clamp-2 text-muted-foreground" title={event.exactEvidence}>
              “{event.exactEvidence}”
            </p>
          </div>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground/70">
            {formatCallDuration(event.relativeTimeMs)}
          </span>
        </li>
      ))}
    </ul>
  );
}
