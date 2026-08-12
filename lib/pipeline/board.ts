// Pipeline board helpers — pure, unit-testable orchestration for /pipeline.
//
// The board groups stored prospects by stage, then every stage move — whether
// driven by the per-card selector, the keyboard arrows, or drag-and-drop —
// flows through `moveCard`, which calls the SAME service path as the Command
// Center (lib/prospects/service.ts changeStage -> the injected `apply`), so
// the stale-cursor recheck, terminal confirmations, and stage_changed activity
// logging all apply. Moves are applied optimistically and rolled back on any
// failure, surfacing the honest error.
//
// Kept free of Next/Supabase imports so Vitest can unit-test the pure logic
// (grouping, reachable targets, keyboard moves, rollback) directly.
import {
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/domain/pipeline/types";
import {
  canTransitionStage,
  isTerminalStage,
  PIPELINE_TRANSITIONS,
} from "@/domain/pipeline/rules";
import type { ProspectRow } from "@/lib/prospects/types";

/** Cards grouped by stage. Every one of the 9 enum stages has a key. */
export type PipelineColumns = Record<PipelineStage, ProspectRow[]>;

export function emptyColumns(): PipelineColumns {
  return Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [stage, [] as ProspectRow[]])
  ) as PipelineColumns;
}

/**
 * Groups prospects into the 9 canonical stage columns, each column sorted
 * newest-first (created_at desc, deterministic id tiebreak) so the board
 * never flickers. Unknown stages (defensive) fall back to "new".
 */
export function groupProspectsByStage(
  prospects: readonly ProspectRow[]
): PipelineColumns {
  const columns = emptyColumns();
  for (const prospect of prospects) {
    const stage = (PIPELINE_STAGES as readonly string[]).includes(
      prospect.stage
    )
      ? (prospect.stage as PipelineStage)
      : "new";
    columns[stage].push(prospect);
  }
  for (const stage of PIPELINE_STAGES) {
    columns[stage].sort((a, b) => {
      const time = (row: ProspectRow) => row.created_at ?? row.updated_at ?? "";
      const cmp = time(b).localeCompare(time(a));
      if (cmp !== 0) return cmp;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  return columns;
}

/** The stage a card currently sits in, or null when it isn't on the board. */
export function findCardStage(
  columns: PipelineColumns,
  prospectId: string
): PipelineStage | null {
  for (const stage of PIPELINE_STAGES) {
    if (columns[stage].some((row) => row.id === prospectId)) return stage;
  }
  return null;
}

/** Removes a card from its column (no-op when absent). */
export function removeCardFromColumns(
  columns: PipelineColumns,
  prospectId: string
): { columns: PipelineColumns; removed: ProspectRow | null } {
  let removed: ProspectRow | null = null;
  const next = emptyColumns();
  for (const stage of PIPELINE_STAGES) {
    next[stage] = columns[stage].filter((row) => {
      if (row.id === prospectId) {
        removed = row;
        return false;
      }
      return true;
    });
  }
  return { columns: next, removed };
}

/** Inserts a card into a column, keeping the column's newest-first sort. */
export function insertCardIntoColumns(
  columns: PipelineColumns,
  stage: PipelineStage,
  card: ProspectRow
): PipelineColumns {
  const next = emptyColumns();
  for (const key of PIPELINE_STAGES) next[key] = columns[key];
  next[stage] = [...next[stage], card].sort((a, b) => {
    const time = (row: ProspectRow) => row.created_at ?? row.updated_at ?? "";
    const cmp = time(b).localeCompare(time(a));
    if (cmp !== 0) return cmp;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return next;
}

/** Whether a card in `from` may be moved to `to` (pipeline rules). */
export function isLegalTarget(
  from: PipelineStage,
  to: PipelineStage
): boolean {
  if (isTerminalStage(from)) return false;
  return canTransitionStage(from, to);
}

/** Reachable targets for a card, in canonical pipeline order. */
export function reachableTargets(stage: PipelineStage): PipelineStage[] {
  if (isTerminalStage(stage)) return [];
  return PIPELINE_TRANSITIONS[stage].slice();
}

/**
 * Keyboard move helper: the next reachable stage before/after the current one
 * in canonical pipeline order. Returns null when there is no move in that
 * direction (terminal stages never move). Drives ArrowLeft/ArrowRight on a
 * focused card.
 */
export function nextReachableStage(
  stage: PipelineStage,
  direction: "prev" | "next"
): PipelineStage | null {
  if (isTerminalStage(stage)) return null;
  const currentIndex = PIPELINE_STAGES.indexOf(stage);
  const reachable = PIPELINE_TRANSITIONS[stage];
  if (direction === "prev") {
    // The nearest reachable stage with a smaller index (a backwards move).
    let best: PipelineStage | null = null;
    for (const target of reachable) {
      const index = PIPELINE_STAGES.indexOf(target);
      if (index < currentIndex && (best === null || index > PIPELINE_STAGES.indexOf(best))) {
        best = target;
      }
    }
    return best;
  }
  // The nearest reachable stage with a larger index (a forward move).
  let best: PipelineStage | null = null;
  for (const target of reachable) {
    const index = PIPELINE_STAGES.indexOf(target);
    if (index > currentIndex && (best === null || index < PIPELINE_STAGES.indexOf(best))) {
      best = target;
    }
  }
  return best;
}

/** A stable, honest move error (category + message) surfaced to the board. */
export interface MoveError {
  category: string;
  message: string;
}

export type StageMoveResult =
  | { ok: true; columns: PipelineColumns }
  | { ok: false; columns: PipelineColumns; error: MoveError };

export interface StageMoveInput {
  targetStage: PipelineStage;
  /** The stage the client believes the card is in (stale-cursor recheck). */
  expectedStage: PipelineStage;
  /** Explicit confirmation — required for terminal targets. */
  confirmed: boolean;
}

/**
 * The persistence function the board injects — the same path the Command
 * Center uses (service.changeStage via the moveStageAction server action).
 */
export type StageMoveFn = (
  prospectId: string,
  input: StageMoveInput
) => Promise<{ ok: true; data: unknown } | { ok: false; error: MoveError }>;

/**
 * Moves a card to another stage through the injected service path:
 *  1. Validates against the pipeline rules (honest errors, no round trip).
 *  2. Applies the move optimistically (card relocates immediately).
 *  3. Calls `apply` — the SAME service.changeStage path, carrying the client's
 *     expectedStage so the stale-cursor recheck applies.
 *  4. On any failure, returns the ORIGINAL columns (rollback) + the error.
 * Deterministic and side-effect free apart from `apply`.
 */
export async function moveCard(
  columns: PipelineColumns,
  prospectId: string,
  targetStage: PipelineStage,
  confirmed: boolean,
  apply: StageMoveFn
): Promise<StageMoveResult> {
  const from = findCardStage(columns, prospectId);
  if (!from) {
    return {
      ok: false,
      columns,
      error: {
        category: "NOT_FOUND",
        message: `Prospect "${prospectId}" isn't on this board — refresh to see the current state.`,
      },
    };
  }
  if (from === targetStage) return { ok: true, columns };

  if (isTerminalStage(from)) {
    return {
      ok: false,
      columns,
      error: {
        category: "TERMINAL_LOCKED",
        message: `This prospect is in terminal stage "${from}" and can't move.`,
      },
    };
  }
  if (isTerminalStage(targetStage) && !confirmed) {
    return {
      ok: false,
      columns,
      error: {
        category: "TERMINAL_CONFIRMATION_REQUIRED",
        message: `Moving to terminal stage "${targetStage}" requires explicit confirmation.`,
      },
    };
  }
  if (!canTransitionStage(from, targetStage)) {
    return {
      ok: false,
      columns,
      error: {
        category: "INVALID_TRANSITION",
        message: `Invalid pipeline transition: ${from} -> ${targetStage}.`,
      },
    };
  }

  // Optimistic move (rollback = the original `columns` on failure).
  const { columns: without, removed } = removeCardFromColumns(columns, prospectId);
  const optimistic = removed
    ? insertCardIntoColumns(without, targetStage, { ...removed, stage: targetStage })
    : columns;

  const result = await apply(prospectId, {
    targetStage,
    expectedStage: from,
    confirmed,
  });

  if (result.ok) return { ok: true, columns: optimistic };
  return { ok: false, columns, error: result.error };
}
