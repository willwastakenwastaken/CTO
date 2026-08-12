// Settings data mapping (M9a) — pure helpers over stored auth/profile rows.
//
// Maps stored rows onto what the Settings page shows. Missing values stay
// null/absent — nothing is ever invented. Kept free of Next/Supabase imports
// so Vitest can unit-test the mapping directly.

export interface AccountInfo {
  /** Email from the auth user (read-only; edited via Supabase Auth). */
  email: string | null;
  displayName: string | null;
  timezone: string | null;
}

/** Maps the auth user email + profiles row onto the Account card. */
export function mapAccountInfo(input: {
  email: string | null | undefined;
  displayName: string | null | undefined;
  timezone: string | null | undefined;
}): AccountInfo {
  return {
    email: input.email?.trim() || null,
    displayName: input.displayName?.trim() || null,
    timezone: input.timezone?.trim() || null,
  };
}

export type SalesProfileStatus = "complete" | "needs_completion";

export interface SalesProfileStatusInfo {
  status: SalesProfileStatus;
  /** Short status label, e.g. "Complete". */
  label: string;
  /** Honest guidance sentence for the Settings card. */
  description: string;
}

/** Maps profiles.onboarding_state onto an honest Sales Profile status. */
export function salesProfileStatus(
  onboardingState: string | null | undefined
): SalesProfileStatusInfo {
  const complete = onboardingState === "complete";
  return {
    status: complete ? "complete" : "needs_completion",
    label: complete ? "Complete" : "Needs completion",
    description: complete
      ? "Your Sales Profile is complete — edit it any time."
      : "A Sales Profile unlocks live coaching. Complete it before starting a practice call.",
  };
}
