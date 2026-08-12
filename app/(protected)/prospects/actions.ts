// Prospects workspace server actions. Every action derives the user id from
// the server session (lib/auth/session.ts getCurrentUserId) — never from the
// browser. RLS (migrations/002) enforces ownership on top. Zod validates
// route inputs and DB-shaped JSON before anything is persisted.
//
// Actions return a discriminated ActionResult so the client can surface
// failures calmly with a stable error category (no thrown-action page).
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
        message: error.issues[0]?.message ?? "Check the form and try again.",
      },
    };
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

/** Creates a prospect + its prospect_created activity. */
export async function createProspectAction(
  input: unknown
): Promise<ActionResult<{ prospectId: string }>> {
  try {
    const service = await getService();
    return { ok: true, data: await service.createProspect(input) };
  } catch (error) {
    return mapError(error);
  }
}

/** Full edit (Command Center edit mode) — recomputes Opportunity Fit. */
export async function updateProspectAction(
  prospectId: string,
  input: unknown
): Promise<ActionResult<{ prospectId: string }>> {
  try {
    const service = await getService();
    return { ok: true, data: await service.updateProspect(prospectId, input) };
  } catch (error) {
    return mapError(error);
  }
}

/** Command Center stage control — logs a stage_changed activity. */
export async function changeStageAction(
  prospectId: string,
  input: unknown
): Promise<ActionResult<StageChangeOutcome>> {
  try {
    const service = await getService();
    return { ok: true, data: await service.changeStage(prospectId, input) };
  } catch (error) {
    return mapError(error);
  }
}

/** Inline next-action edit — touches only next_action + due date. */
export async function updateNextActionAction(
  prospectId: string,
  input: unknown
): Promise<ActionResult<{ prospectId: string }>> {
  try {
    const service = await getService();
    return { ok: true, data: await service.updateNextAction(prospectId, input) };
  } catch (error) {
    return mapError(error);
  }
}

/** Delete with ownership guard (notes cascade; activities survive). */
export async function deleteProspectAction(
  prospectId: string
): Promise<ActionResult<{ prospectId: string }>> {
  try {
    const service = await getService();
    return { ok: true, data: await service.deleteProspect(prospectId) };
  } catch (error) {
    return mapError(error);
  }
}

/** Adds a general note + its note_added activity. */
export async function addNoteAction(
  prospectId: string,
  input: unknown
): Promise<ActionResult<{ noteId: string }>> {
  try {
    const service = await getService();
    return { ok: true, data: await service.addNote(prospectId, input) };
  } catch (error) {
    return mapError(error);
  }
}

/**
 * Start AI-Assisted Call — ownership-checked; creates ONE prepared,
 * prospect-linked simulated practice call (default Sales Profile linked when
 * one exists) and returns its id so the client routes to /calls/[callId]/live.
 */
export async function startAiAssistedCallAction(
  prospectId: string
): Promise<ActionResult<{ callId: string }>> {
  try {
    const service = await getService();
    return { ok: true, data: await service.startAiAssistedCall(prospectId) };
  } catch (error) {
    return mapError(error);
  }
}
