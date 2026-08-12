"use client";

// Primary hero — ONE recommendation at a time, or a calm Listening state.
// Minimal cognitive load: kickers describe what was heard and what to do,
// the exact recommended words, one secondary reason line, three controls.
// Dismissal is NOT negative feedback (spec: dismissed_at, not feedback).
import { Button } from "@/components/ui/button";
import { heroKickers } from "@/lib/calls/workspace";
import type { LiveWorkspace, WorkspaceEvent, WorkspaceSuggestion } from "@/lib/calls/workspace";
import { cn } from "@/lib/utils";

export type FeedbackAction = "useful" | "not_useful" | "dismiss";

export function RecommendationHero({
  workspace,
  busy,
  onFeedback,
}: {
  workspace: LiveWorkspace;
  /** Non-null while a feedback request is in flight ("Saving feedback…"). */
  busy: boolean;
  onFeedback: (action: FeedbackAction) => void;
}) {
  const suggestion = workspace.activeSuggestion;
  if (!suggestion) {
    return <ListeningState />;
  }
  return (
    <SuggestionCard
      suggestion={suggestion}
      events={workspace.events}
      busy={busy}
      onFeedback={onFeedback}
    />
  );
}

function ListeningState() {
  // Quiet, honest, no fake metrics. A single restrained pulse dot is the only
  // motion; reduced-motion users see a static dot (CSS handles it).
  return (
    <section
      aria-label="SignalDesk is listening"
      className="flex items-center gap-3 rounded-xl border border-dashed px-5 py-6"
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-primary/50 motion-safe:animate-pulse"
      />
      <div>
        <h2 className="text-sm font-semibold tracking-wide">Listening</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          SignalDesk stays quiet until the next meaningful signal.
        </p>
      </div>
    </section>
  );
}

function SuggestionCard({
  suggestion,
  events,
  busy,
  onFeedback,
}: {
  suggestion: WorkspaceSuggestion;
  events: readonly WorkspaceEvent[];
  busy: boolean;
  onFeedback: (action: FeedbackAction) => void;
}) {
  const kickers = heroKickers(suggestion, events);
  return (
    <section
      aria-label="Recommendation"
      className="rounded-xl border bg-card p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
        {kickers.eventLabel && (
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary">
            {kickers.eventLabel}
          </span>
        )}
        <span className="rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {kickers.actionLabel}
        </span>
      </div>
      <p className="mt-3 text-lg font-medium leading-snug tracking-tight">
        {suggestion.text}
      </p>
      {suggestion.reason && (
        <p className="mt-1.5 text-sm text-muted-foreground">{suggestion.reason}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => onFeedback("useful")}
          disabled={busy}
        >
          Useful
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onFeedback("not_useful")}
          disabled={busy}
        >
          Not useful
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onFeedback("dismiss")}
          disabled={busy}
        >
          Dismiss
        </Button>
        <span
          className={cn(
            "ml-auto text-xs text-muted-foreground transition-opacity",
            busy ? "opacity-100" : "opacity-0"
          )}
          aria-live="polite"
        >
          Saving feedback…
        </span>
      </div>
    </section>
  );
}
