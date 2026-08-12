import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOnboardingState } from "@/lib/auth/profile";
import { loginRedirectUrl } from "@/lib/auth/guards";

export default async function PracticeCallPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(loginRedirectUrl("/calls/practice"));
  }

  // Live coaching requires a completed Sales Profile. Until then, every
  // call-starting entry point (this page, Home's "Start a Call") funnels here
  // and is redirected to onboarding with a clear reason.
  const onboardingState = await getOnboardingState(supabase, user.id);
  if (onboardingState !== "complete") {
    redirect("/settings/sales-profile?reason=onboarding");
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Practice call</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Start a clearly labeled simulated practice call (ABC Roofing). The
        deterministic simulation lands in a later milestone — this page is the
        gated entry point.
      </p>
      <div className="mt-8 rounded-lg border bg-muted/40 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Practice-call simulation is not built yet.{" "}
          <Link href="/home" className="underline underline-offset-4">
            Back to Home
          </Link>
        </p>
      </div>
    </div>
  );
}
