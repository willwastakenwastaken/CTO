"use client";

// Compact Deal State — the evolving truth model of the call, tightly laid out.
// Facts are only ever what the conversation confirmed (null = "—", never
// invented). Nine rows, small type, no gauges, no score overload.
import type { ConversationState, StateFact } from "@/domain/conversation-state/types";

function factValue(fact: StateFact | null): string {
  return fact?.value ?? "";
}

function Fact({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className="mt-0.5 line-clamp-2 text-sm"
        title={value}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

export function DealState({ state }: { state: ConversationState }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3" aria-label="Deal state">
      <Fact label="Stage" value={state.stage} testId="deal-stage" />
      <Fact label="Interest" value={state.interest} testId="deal-interest" />
      <Fact label="Pain" value={factValue(state.pain)} testId="deal-pain" />
      <Fact label="Impact" value={factValue(state.impact)} />
      <Fact label="Authority" value={factValue(state.authority)} />
      <Fact label="Budget" value={factValue(state.budget)} />
      <Fact label="Timeline" value={factValue(state.timeline)} />
      <Fact label="Current solution" value={factValue(state.currentSolution)} />
      <Fact
        label="Objections"
        value={state.objections.map((o) => o.value).join(" · ")}
      />
      <Fact label="Next objective" value={factValue(state.nextObjective)} />
      <Fact
        label="Buying signals"
        value={state.buyingSignals.map((s) => s.value).join(" · ")}
      />
    </dl>
  );
}
