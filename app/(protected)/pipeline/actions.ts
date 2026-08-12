// Pipeline board server actions. Stage moves from /pipeline go through the
// SAME service path as the Command Center (service.changeStage — stale-cursor
// recheck, terminal confirmations, stage_changed activity) with the source
// recorded as "pipeline_board" in the activity metadata. The user id is
// derived from the server session (lib/auth/session.ts) — never from the
// browser; RLS (migrations/002) enforces ownership on top.
"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseProspectStore } from "@/lib/prospects/store";
import {
  createProspectService,
  type StageChangeOutcome,
} from "@/lib/prospects/service";
import { getCurrentUserId, SessionError } from "@/lib/auth/session";
import { ProspectServiceError } from "@/lib/prospects/types";
import { PersistenceError } from "@/lib/calls/types";
import { ZodError } from "zod";

export type ActionError = { category: string; message: string };
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

async function getService() {
  const supabase = await createServerSupabaseClient();
  const userId = await getCurrentUserId();
  return createProspectService({
    store: createSupabaseProspectStore(supabase),
    userId,
  });
}

function mapError(error: unknown): { ok: false; error: ActionError } {
  if (error instanceof SessionError) {
    return {
      ok: false,
      error: {
        category: "UNAUTHENTICATED",
        message: "You must be signed in to do that.",
      },
    };
  }
  if (error instanceof ProspectServiceError) {
    return { ok: false, error: { category: error.category, message: error.message } };
  }
  if (error instanceof ZodError) {
    return {
      ok: false,
      error: {
        category: "INVALID_INPUT",
        message: error.issues[0]?.message ?? "Check the selection and try again.",
      },
    };
  }
  if (error instanceof PersistenceError) {
    return {
      ok: false,
      error: {
        category: "PERSISTENCE_FAILED",
        message:
          "We couldn't save that move right now. Your data is safe — the card has been returned to its original stage.",
      },
    };
  }
  return {
    ok: false,
    error: {
      category: "UNKNOWN",
      message: "Something unexpected went wrong. Please try again.",
    },
  };
}

/**
 * Moves a board card to another stage. `input` is the same shape the Command
 * Center sends ({ targetStage, expectedStage, confirmed }); the board passes
 * its own belief about the card's current stage so the stale-cursor recheck
 * applies. Terminal targets still require confirmed: true.
 */
export async function moveStageAction(
  prospectId: string,
  input: unknown
): Promise<ActionResult<StageChangeOutcome>> {
  try {
    const service = await getService();
    return {
      ok: true,
      data: await service.changeStage(prospectId, input, undefined, "pipeline_board"),
    };
  } catch (error) {
    return mapError(error);
  }
}
