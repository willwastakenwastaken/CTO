// Call Review server actions. Every action derives the user id from the
// server session (lib/auth/session.ts getCurrentUserId) — never from the
// browser. RLS (migrations/002) enforces ownership on top. Actions return a
// discriminated ActionResult so the client can surface failures calmly.
"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseCallStore } from "@/lib/calls/store";
import { createSimulationService } from "@/lib/calls/service";
import { getCurrentUserId, SessionError } from "@/lib/auth/session";
import { CallServiceError, PersistenceError } from "@/lib/calls/types";
import type { ApplyRecommendationOutcome } from "@/lib/calls/service";

export type ActionError = {
  category: string;
  message: string;
  /** Present on STALE_STAGE so the client can show the actual stages. */
  currentStage?: string;
  expectedStage?: string;
};
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

async function getService() {
  const supabase = await createServerSupabaseClient();
  const userId = await getCurrentUserId();
  return createSimulationService({
    store: createSupabaseCallStore(supabase),
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
  if (error instanceof CallServiceError) {
    return { ok: false, error: { category: error.category, message: error.message } };
  }
  if (error instanceof PersistenceError) {
    return {
      ok: false,
      error: {
        category: "PERSISTENCE_FAILED",
        message:
          "We couldn't save that right now. Your data is safe — try again in a moment.",
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
 * Applies the review's pipeline recommendation. The server recomputes the
 * stale-stage recheck on every call: when the prospect's CURRENT stage no
 * longer matches the stage captured at review time, the action refuses with
 * STALE_STAGE (plus the actual stages) until the caller sends `confirmed:
 * true`. Applying twice is a no-op (already at the recommended stage).
 */
export async function applyReviewAction(
  callId: string,
  confirmed: boolean
): Promise<ActionResult<Extract<ApplyRecommendationOutcome, { ok: true }>>> {
  try {
    const service = await getService();
    const result = await service.applyReviewRecommendation(callId, { confirmed });
    if (!result.ok) {
      if (result.error.category === "STALE_STAGE") {
        return {
          ok: false,
          error: {
            category: result.error.category,
            message: result.error.message,
            currentStage: result.error.currentStage,
            expectedStage: result.error.expectedStage,
          },
        };
      }
      return { ok: false, error: { category: result.error.category, message: result.error.message } };
    }
    return { ok: true, data: result };
  } catch (error) {
    return mapError(error);
  }
}
