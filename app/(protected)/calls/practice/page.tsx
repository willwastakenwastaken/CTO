import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseCallStore } from "@/lib/calls/store";
import { createSimulationService } from "@/lib/calls/service";
import { getOnboardingState } from "@/lib/auth/profile";
import { loginRedirectUrl } from "@/lib/auth/guards";

/**
 * Start Practice Call — entry point for an ABC Roofing simulated call.
 * The M3 onboarding gate stays: live coaching requires a completed Sales
 * Profile, so an incomplete profile is redirected to onboarding with a clear
 * reason (never silently skipped).
 */
export default async function PracticeCallPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(loginRedirectUrl("/calls/practice"));
  }
  const onboardingState = await getOnboardingState(supabase, user.id);
  if (onboardingState !== "complete") {
    redirect("/settings/sales-profile?reason=onboarding");
  }
  // Prepare a fresh prepared call; the live workspace shows the Start button
  // (this also covers restarts, which mint new call ids in prepared state).
  const service = createSimulationService({
    store: createSupabaseCallStore(supabase),
    userId: user.id,
  });
  const { callId } = await service.prepareCall({ scenarioId: "abc_roofing" });
  redirect(`/calls/${callId}/live`);
}
