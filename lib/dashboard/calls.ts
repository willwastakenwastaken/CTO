// Calls list query + filter helpers (M9a) — pure functions over STORED rows.
//
// Every predicate reads only persisted call_sessions columns (status,
// purchase_intent_label, next_action, pipeline_recommendation, evidence,
// prospect_id) — never fabricated metrics. Kept free of Next/Supabase imports
// so Vitest can unit-test the predicates directly.
import type { CallSessionRow } from "@/lib/calls/types";
import { getScenario } from "@/providers/simulation/registry";

/** The exact filter set the spec's Calls list defines. */
export const CALLS_FILTERS = [
  { value: "all", label: "All" },
  { value: "high_intent", label: "High intent" },
  { value: "follow_up", label: "Follow-up" },
  { value: "qualified", label: "Qualified" },
  { value: "not_interested", label: "Not interested" },
  { value: "practice", label: "Practice" },
] as const;

export type CallsFilterValue = (typeof CALLS_FILTERS)[number]["value"];

export const DEFAULT_CALLS_FILTER: CallsFilterValue = "all";

/** Defensive guard for searchParams — unknown values fall back to "all". */
export function isCallsFilterValue(value: unknown): value is CallsFilterValue {
  return CALLS_FILTERS.some((filter) => filter.value === value);
}

/** "completed" -> "Completed"; unknown statuses stay humanized/verbatim. */
export function humanizeCallStatus(
  status: string | null | undefined
): string {
  if (!status) return "—";
  return status
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The risk string the purchase-intent heuristic records for an explicit
 * rejection (domain/scoring/purchase-intent.ts RISK_LABELS.explicitRejection).
 * Matching on the exact stored string — never parsed from prose.
 */
export const EXPLICIT_REJECTION_RISK = "Explicit rejection";

/** Risks recorded on a completed call's evidence payload, if any. */
export function recordedRisks(row: CallSessionRow): string[] {
  const evidence = row.evidence;
  if (!evidence || typeof evidence !== "object") return [];
  const risks = (evidence as { risks?: unknown }).risks;
  if (!Array.isArray(risks)) return [];
  return risks.filter((risk): risk is string => typeof risk === "string");
}

/**
 * The spec's filter set, mapped onto stored data (honest semantics):
 *  - all:           every call session.
 *  - high_intent:   completed calls whose evidence-based Purchase Intent
 *                   label is "high".
 *  - follow_up:     completed calls with a stored next action (the review's
 *                   follow-up step).
 *  - qualified:     completed calls whose review recommended the "qualified"
 *                   pipeline stage.
 *  - not_interested: completed calls whose recorded risks include an explicit
 *                   rejection.
 *  - practice:      standalone practice calls (not linked to a prospect).
 */
export function matchCallsFilter(
  filter: CallsFilterValue,
  row: CallSessionRow
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "high_intent":
      return (
        row.status === "completed" && row.purchase_intent_label === "high"
      );
    case "follow_up":
      return (
        row.status === "completed" &&
        row.next_action != null &&
        row.next_action.trim() !== ""
      );
    case "qualified":
      return (
        row.status === "completed" &&
        row.pipeline_recommendation === "qualified"
      );
    case "not_interested":
      return (
        row.status === "completed" &&
        recordedRisks(row).includes(EXPLICIT_REJECTION_RISK)
      );
    case "practice":
      return row.prospect_id === null;
  }
}

/** Applies a filter to a row list (callers fetch + order the full set). */
export function applyCallsFilter(
  rows: readonly CallSessionRow[],
  filter: CallsFilterValue
): CallSessionRow[] {
  return rows.filter((row) => matchCallsFilter(filter, row));
}

/**
 * Scenario display label from the stored `scenario` slug. Falls back to the
 * humanized slug when the slug isn't in the registry — never crashes a list.
 */
export function callScenarioLabel(
  scenario: string | null | undefined
): string {
  if (!scenario) return "Practice call";
  try {
    return getScenario(scenario).label;
  } catch {
    return humanizeCallStatus(scenario);
  }
}
