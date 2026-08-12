// Pipeline stage rules.
// Allowed transitions follow the spec linear pipeline with sensible skips
// (e.g. new -> ready_to_contact). Terminal stages (closed_won / closed_lost)
// require explicit confirmation. Applying a transition rechecks the current
// stage against the expected pre-transition stage to reject stale updates
// (multi-tab). NEVER silently move the pipeline.
import {
  PIPELINE_STAGES,
  TERMINAL_STAGES,
  type PipelineStage,
} from "@/domain/pipeline/types";
import { isUuid } from "@/domain/utils/uuid";

export type PipelineErrorCategory =
  | "INVALID_TRANSITION"
  | "TERMINAL_CONFIRMATION_REQUIRED"
  | "TERMINAL_LOCKED"
  | "STALE_CURSOR"
  | "NOT_FOUND";

export interface PipelineError {
  category: PipelineErrorCategory;
  message: string;
}

/** Legal stage-to-stage moves (forward with skips, plus limited backwards
 * re-qualification moves). */
export const PIPELINE_TRANSITIONS: Record<
  PipelineStage,
  readonly PipelineStage[]
> = {
  new: ["researching", "ready_to_contact", "contacted", "closed_lost"],
  researching: ["ready_to_contact", "contacted", "new", "closed_lost"],
  ready_to_contact: ["contacted", "new", "researching", "closed_lost"],
  contacted: ["qualified", "ready_to_contact", "closed_lost"],
  qualified: ["meeting_booked", "proposal", "contacted", "closed_lost"],
  meeting_booked: ["proposal", "qualified", "closed_won", "closed_lost"],
  proposal: ["closed_won", "closed_lost", "meeting_booked", "qualified"],
  closed_won: [],
  closed_lost: [],
};

export function isTerminalStage(stage: PipelineStage): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage);
}

export function canTransitionStage(
  from: PipelineStage,
  to: PipelineStage
): boolean {
  return PIPELINE_TRANSITIONS[from].includes(to);
}

export function nextStages(stage: PipelineStage): readonly PipelineStage[] {
  return PIPELINE_TRANSITIONS[stage];
}

export interface ApplyStageTransitionInput {
  prospectId: string;
  /** The stage the prospect is ACTUALLY in right now (server truth). */
  currentStage: PipelineStage;
  /** The stage the client believed the prospect was in. */
  expectedStage: PipelineStage;
  targetStage: PipelineStage;
  /** Explicit confirmation — required for terminal stages. */
  confirmed: boolean;
}

export type StageTransitionResult =
  | { ok: true; prospectId: string; nextStage: PipelineStage }
  | { ok: false; error: PipelineError };

/**
 * Applies a pipeline stage transition with guards, in order:
 *  1. NOT_FOUND for a malformed prospect id (ids are UUID strings).
 *  2. STALE_CURSOR when currentStage no longer matches expectedStage.
 *  3. TERMINAL_LOCKED when the prospect is already in a terminal stage.
 *  4. TERMINAL_CONFIRMATION_REQUIRED for terminal targets without
 *     confirmation.
 *  5. INVALID_TRANSITION when the pair is not in PIPELINE_TRANSITIONS.
 */
export function applyStageTransition(
  input: ApplyStageTransitionInput
): StageTransitionResult {
  const { prospectId, currentStage, expectedStage, targetStage, confirmed } =
    input;

  if (!isUuid(prospectId)) {
    return {
      ok: false,
      error: {
        category: "NOT_FOUND",
        message: `Invalid prospect id "${prospectId}" — IDs are UUID strings.`,
      },
    };
  }

  if (currentStage !== expectedStage) {
    return {
      ok: false,
      error: {
        category: "STALE_CURSOR",
        message: `Stale pipeline update: prospect ${prospectId} is "${currentStage}", not "${expectedStage}". Recheck before applying.`,
      },
    };
  }

  if (isTerminalStage(currentStage)) {
    return {
      ok: false,
      error: {
        category: "TERMINAL_LOCKED",
        message: `Prospect ${prospectId} is in terminal stage "${currentStage}" and cannot move.`,
      },
    };
  }

  if (isTerminalStage(targetStage) && !confirmed) {
    return {
      ok: false,
      error: {
        category: "TERMINAL_CONFIRMATION_REQUIRED",
        message: `Moving to terminal stage "${targetStage}" requires explicit confirmation.`,
      },
    };
  }

  if (!canTransitionStage(currentStage, targetStage)) {
    return {
      ok: false,
      error: {
        category: "INVALID_TRANSITION",
        message: `Invalid pipeline transition: ${currentStage} -> ${targetStage}.`,
      },
    };
  }

  return { ok: true, prospectId, nextStage: targetStage };
}

export { PIPELINE_STAGES, TERMINAL_STAGES };
export type { PipelineStage };
