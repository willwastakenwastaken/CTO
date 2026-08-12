import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Onboarding lifecycle stored on profiles.onboarding_state (free text column).
 * 'not_started' -> 'complete' is the Phase 1 contract; other values are unused.
 */
export type OnboardingState = "not_started" | "complete";

export interface ProfileRow {
  id: string;
  display_name: string | null;
  timezone: string | null;
  onboarding_state: OnboardingState | null;
}

/**
 * Creates the profiles row for a freshly signed-up user when it does not exist
 * yet (e.g. email confirmation was required at sign-up and the row was never
 * inserted). Idempotent. Never overwrites an existing row and never fabricates
 * data — missing values stay NULL.
 *
 * The caller must already hold an authenticated session; RLS confines the
 * insert to the caller's own id (id = auth.uid()).
 */
export async function ensureProfileForUser(
  supabase: SupabaseClient,
  user: { id: string; user_metadata?: Record<string, unknown> | null }
): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (data) {
    return;
  }

  const rawDisplayName = user.user_metadata?.display_name;
  const displayName =
    typeof rawDisplayName === "string" && rawDisplayName.trim() !== ""
      ? rawDisplayName.trim()
      : null;

  await supabase.from("profiles").insert({
    id: user.id,
    display_name: displayName,
    timezone: null,
    onboarding_state: "not_started" as OnboardingState,
  });
}

/**
 * Reads the user's onboarding state. Returns null when the profile row is
 * missing entirely (should not happen after ensureProfileForUser).
 */
export async function getOnboardingState(
  supabase: SupabaseClient,
  userId: string
): Promise<OnboardingState | null> {
  const { data } = await supabase
    .from("profiles")
    .select("onboarding_state")
    .eq("id", userId)
    .maybeSingle();

  const state = data?.onboarding_state;
  return state === "not_started" || state === "complete" ? state : null;
}
