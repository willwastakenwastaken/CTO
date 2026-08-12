import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loginRedirectUrl } from "@/lib/auth/guards";
import { SalesProfileForm } from "@/components/settings/sales-profile-form";

interface SalesProfilePageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function SalesProfilePage({
  searchParams,
}: SalesProfilePageProps) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(loginRedirectUrl("/settings/sales-profile"));
  }

  const { reason } = await searchParams;

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_state")
    .eq("id", user.id)
    .maybeSingle();

  const { data: salesProfile } = await supabase
    .from("sales_profiles")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .maybeSingle();

  const onboardingState =
    profile?.onboarding_state === "complete" ? "complete" : "not_started";
  const gateReason = reason === "onboarding" ? "onboarding" : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Sales Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        What you sell, who you sell to, and how you run calls. This is what
        SignalDesk uses to coach you — leave anything blank rather than guess.
      </p>

      {gateReason ? (
        <p
          role="status"
          className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        >
          Complete your Sales Profile before starting a practice call — it takes
          a couple of minutes.
        </p>
      ) : null}

      {onboardingState !== "complete" ? (
        <p
          role="status"
          className="mt-6 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          Welcome! Finish this one-time setup to unlock live coaching.
        </p>
      ) : null}

      <div className="mt-6">
        <SalesProfileForm
          userId={user.id}
          onboardingState={onboardingState}
          initial={{
            salesProfileId: salesProfile?.id ?? null,
            product_name: salesProfile?.product_name ?? null,
            description: salesProfile?.description ?? null,
            pricing: salesProfile?.pricing ?? null,
            ideal_customer: salesProfile?.ideal_customer ?? null,
            benefits: salesProfile?.benefits ?? null,
            problems_solved: salesProfile?.problems_solved ?? null,
            differentiators: salesProfile?.differentiators ?? null,
            call_goal: salesProfile?.call_goal ?? null,
            preferred_cta: salesProfile?.preferred_cta ?? null,
            sales_process: salesProfile?.sales_process ?? null,
            objections: Array.isArray(salesProfile?.objections)
              ? salesProfile.objections
              : [],
            guardrails: Array.isArray(salesProfile?.guardrails)
              ? salesProfile.guardrails
              : [],
          }}
        />
      </div>
    </div>
  );
}
