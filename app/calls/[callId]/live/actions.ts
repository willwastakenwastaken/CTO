// Live workspace server actions. Every action derives the user id from the
// server session (lib/auth/session.ts getCurrentUserId) — never from the
// browser. RLS (migrations/002) enforces ownership on top.
//
// Actions return a discriminated ActionResult so the client can surface
// failures calmly with a stable error category (no thrown-action page).
"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseCallStore } from "@/lib/calls/store";
import { createSimulationService } from "@/lib/calls/service";
import type { LiveWorkspace } from "@/lib/calls/workspace";
import { getCurrentUserId, SessionError } from "@/lib/auth/session";
import { CallServiceError, PersistenceError } from "@/lib/calls/types";
import type { LiveSessionSnapshot } from "@/domain/simulation/snapshot";

export type ActionError = { category: string; message: string };
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
    return { ok: false, error: { category: "UNAUTHENTICATED", message: "You must be signed in to do that." } };
  }
  if (error instanceof CallServiceError) {
    return { ok: false, error: { category: error.category, message: error.message } };
  }
  if (error instanceof PersistenceError) {
    return {
      ok: false,
      error: {
        category: "PERSISTENCE_FAILED",
        message: "We couldn't save that right now. Your data is safe — try again in a moment.",
      },
    };
  }
  return { ok: false, error: { category: "UNKNOWN", message: "Something unexpected went wrong. Please try again." } };
}

async function workspaceAfter<T>(run: (service: ReturnType<typeof createSimulationService>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const service = await getService();
    return { ok: true, data: await run(service) };
  } catch (error) {
    return mapError(error);
  }
}

/** Full authoritative workspace for the live page (load + refresh path). */
export async function getWorkspaceAction(callId: string): Promise<ActionResult<LiveWorkspace>> {
  return workspaceAfter(async (service) => service.getWorkspace(callId));
}

/** Reconciles a client snapshot with authoritative DB state. Returns null
 * when the call is terminal (snapshot cleared). */
export async function reconcileAction(
  callId: string,
  snapshot: LiveSessionSnapshot
): Promise<ActionResult<{ snapshot: LiveSessionSnapshot | null }>> {
  return workspaceAfter(async (service) => ({
    snapshot: await service.reconcileCallSnapshot(callId, snapshot),
  }));
}

/** prepared -> live; started_at set exactly once (idempotent). */
export async function startAction(callId: string): Promise<ActionResult<LiveWorkspace>> {
  return workspaceAfter(async (service) => {
    await service.startCall(callId);
    return service.getWorkspace(callId);
  });
}

/** Advances exactly ONE turn. expectedCursor must equal the client's revealed
 * count; a stale cursor is rejected (STALE_CURSOR) and the client reconciles
 * before retrying — the server never silently double-advances. */
export async function advanceAction(
  callId: string,
  expectedCursor: number
): Promise<ActionResult<{ advanced: boolean; repaired: boolean; workspace: LiveWorkspace }>> {
  return workspaceAfter(async (service) => {
    const outcome = await service.advanceCall(callId, { expectedCursor });
    const workspace = await service.getWorkspace(callId);
    return { advanced: outcome.advanced, repaired: outcome.repaired, workspace };
  });
}

/** UI pause is a view control (DB status stays live). */
export async function pauseAction(callId: string): Promise<ActionResult<LiveWorkspace>> {
  return workspaceAfter(async (service) => {
    await service.pauseCall(callId);
    return service.getWorkspace(callId);
  });
}

export async function resumeAction(callId: string): Promise<ActionResult<LiveWorkspace>> {
  return workspaceAfter(async (service) => {
    await service.resumeCall(callId);
    return service.getWorkspace(callId);
  });
}

/** Ends the session: processing -> review generated -> completed. Idempotent;
 * the review page (M7) loads the persisted review_payload. */
export async function endAction(
  callId: string
): Promise<ActionResult<{ callId: string; status: "completed" }>> {
  return workspaceAfter(async (service) => {
    await service.endCall(callId);
    return { callId, status: "completed" };
  });
}

/** Cancels a prepared/live call (history preserved; snapshot cleared). */
export async function cancelAction(
  callId: string
): Promise<ActionResult<{ callId: string; status: "cancelled" }>> {
  return workspaceAfter(async (service) => {
    await service.cancelCall(callId);
    return { callId, status: "cancelled" };
  });
}

/** Deliberate restart: mints a NEW call id (engine requirement); the old
 * call's history is preserved. The client routes to the fresh call. */
export async function restartAction(
  callId: string
): Promise<ActionResult<{ newCallId: string }>> {
  return workspaceAfter(async (service) => {
    const { newCallId } = await service.restartCall(callId);
    return { newCallId };
  });
}

/** Suggestion feedback: useful/not_useful set used_at + feedback; dismiss sets
 * dismissed_at only (dismissal is NOT negative feedback). */
export async function feedbackAction(
  callId: string,
  suggestionId: string,
  action: "useful" | "not_useful" | "dismiss"
): Promise<ActionResult<LiveWorkspace>> {
  return workspaceAfter(async (service) => {
    await service.saveSuggestionFeedback(callId, suggestionId, action);
    return service.getWorkspace(callId);
  });
}
