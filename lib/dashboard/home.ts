// Home dashboard aggregation helpers (M9a) — pure functions over STORED rows.
//
// Everything here derives from persisted prospect / call / activity rows —
// no fake metrics, no invented numbers. Kept free of Next/Supabase imports so
// Vitest can unit-test the aggregations directly.
import { PIPELINE_STAGES } from "@/domain/pipeline/types";
import type { CallSessionRow } from "@/lib/calls/types";
import type { ActivityRow, ProspectRow } from "@/lib/prospects/types";

/** The spec's Home section shows up to five recent calls. */
export const HOME_RECENT_CALLS_LIMIT = 5;
/** Latest activity entries shown on Home (bounded, not unbounded). */
export const HOME_RECENT_ACTIVITY_LIMIT = 8;

export interface UpcomingAction {
  /** The prospect's own stored identity (id is a UUID string). */
  prospect: Pick<
    ProspectRow,
    | "id"
    | "first_name"
    | "last_name"
    | "company"
    | "stage"
    | "next_action"
    | "next_action_due_date"
  >;
  /** "YYYY-MM-DD" or null when the prospect has no due date. */
  dueDate: string | null;
  /** Honest overdue flag: due before today (server clock). */
  overdue: boolean;
  dueToday: boolean;
}

/** Normalizes any stored date value ("YYYY-MM-DD" or ISO timestamp) to the
 * "YYYY-MM-DD" day key used for due comparisons; null when unparseable. */
export function datePart(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

/**
 * Upcoming follow-ups: prospects with a stored next action. Sorted with the
 * most urgent first — overdue actions surface first (flagged honestly), then
 * due-soon, then prospects with a next action but no due date (by name).
 * A prospect without a next action never appears here.
 */
export function selectUpcomingActions(
  prospects: readonly ProspectRow[],
  todayIso: string,
  limit: number = 10
): UpcomingAction[] {
  const today = datePart(todayIso);
  return prospects
    .filter((p) => p.next_action?.trim())
    .map((p) => {
      const due = datePart(p.next_action_due_date);
      return {
        prospect: {
          id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          company: p.company,
          stage: p.stage,
          next_action: p.next_action,
          next_action_due_date: p.next_action_due_date,
        },
        dueDate: due,
        overdue: due != null && today != null && due < today,
        dueToday: due != null && today != null && due === today,
      };
    })
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.dueDate != null && b.dueDate != null) {
        if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
        return compareProspectNames(a, b);
      }
      if (a.dueDate != null) return -1;
      if (b.dueDate != null) return 1;
      return compareProspectNames(a, b);
    })
    .slice(0, Math.max(0, limit));
}

function compareProspectNames(a: UpcomingAction, b: UpcomingAction): number {
  const name = (action: UpcomingAction) =>
    [action.prospect.first_name, action.prospect.last_name, action.prospect.company]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  return name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0;
}

/**
 * Most recent call sessions, newest first (created_at, falling back to
 * started_at), capped at the given limit. Deterministic for equal timestamps
 * (id tiebreak) so the dashboard never flickers.
 */
export function selectRecentCalls(
  sessions: readonly CallSessionRow[],
  limit: number = HOME_RECENT_CALLS_LIMIT
): CallSessionRow[] {
  return [...sessions]
    .sort((a, b) => {
      const time = (row: CallSessionRow) => row.created_at ?? row.started_at ?? "";
      const cmp = time(b).localeCompare(time(a));
      if (cmp !== 0) return cmp;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, Math.max(0, limit));
}

export interface StageCount {
  /** A pipeline stage key (PIPELINE_STAGES member). */
  stage: string;
  /** Number of stored prospects in that stage (0 is an honest count). */
  count: number;
}

/** Prospect counts per pipeline stage, in canonical pipeline order. */
export function countStages(prospects: readonly ProspectRow[]): StageCount[] {
  const counts = new Map<string, number>();
  for (const prospect of prospects) {
    counts.set(prospect.stage, (counts.get(prospect.stage) ?? 0) + 1);
  }
  return PIPELINE_STAGES.map((stage) => ({
    stage,
    count: counts.get(stage) ?? 0,
  }));
}

/** Human-readable label for a stored activity type (unknown stays verbatim
 * with underscores replaced — never invented). */
export function activityTypeLabel(type: string): string {
  const known: Record<string, string> = {
    prospect_created: "Prospect created",
    stage_changed: "Stage changed",
    note_added: "Note added",
    call_completed: "Call completed",
  };
  if (known[type]) return known[type];
  return type
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Renders a stored activity row as a short human-readable sentence. Prefers
 * the stored summary; when a summary is missing it falls back to the type
 * label plus a prospect name from metadata — content is never invented.
 */
export function formatActivitySummary(
  activity: Pick<ActivityRow, "type" | "summary" | "metadata">
): string {
  if (activity.summary?.trim()) return activity.summary.trim();
  const meta = (activity.metadata ?? {}) as Record<string, unknown>;
  const prospectName =
    typeof meta.prospectName === "string" && meta.prospectName.trim() !== ""
      ? meta.prospectName.trim()
      : null;
  const base = activityTypeLabel(activity.type);
  return prospectName ? `${base} — ${prospectName}` : base;
}

/** A call list row's display identity: the linked prospect, else "Practice
 * call" (honest label for a standalone simulated call). */
export function callRowLabel(input: {
  prospectName: string | null;
  prospectCompany: string | null;
}): string {
  if (input.prospectName?.trim()) return input.prospectName.trim();
  if (input.prospectCompany?.trim()) return input.prospectCompany.trim();
  return "Practice call";
}
