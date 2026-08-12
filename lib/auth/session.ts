// Server-side session helper: derives the current user id from the request
// session (never from the browser). Use this at every route/server-action
// boundary that touches user-owned rows; the persistence layer then writes
// with this id and RLS enforces ownership on top.
import { createServerSupabaseClient } from "@/lib/supabase/server";

export class SessionError extends Error {
  readonly category = "UNAUTHENTICATED" as const;
  constructor() {
    super("You must be signed in to do that.");
    this.name = "SessionError";
  }
}

export async function getCurrentUserId(): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new SessionError();
  return data.user.id;
}
