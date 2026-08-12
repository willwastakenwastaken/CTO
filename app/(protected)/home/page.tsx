import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOnboardingState } from "@/lib/auth/profile";
import { loginRedirectUrl } from "@/lib/auth/guards";

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(loginRedirectUrl("/home"));
  }
  // New users (no completed Sales Profile) see "Start Practice Call" and
  // "Add First Prospect" — not fake metrics. Everyone else sees the full
  // "Ready to sell?" CTAs. Both call CTAs route through /calls/practice,
  // which enforces the onboarding gate.
  const onboardingState = await getOnboardingState(supabase, user.id);
  const onboardingComplete = onboardingState === "complete";

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Ready to sell?</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        What should you do next? Your dashboard lands with the next milestone —
        for now, start a practice call or pick a prospect.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {onboardingComplete ? (
          <>
            <Link
              href="/calls/practice"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              Start a Call
            </Link>
            <Link
              href="/prospects"
              className="inline-flex h-10 items-center justify-center rounded-lg border px-5 text-sm font-medium hover:bg-muted"
            >
              Choose Prospect
            </Link>
          </>
        ) : (
          <>
            <Link
              href="/calls/practice"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              Start Practice Call
            </Link>
            <Link
              href="/prospects"
              className="inline-flex h-10 items-center justify-center rounded-lg border px-5 text-sm font-medium hover:bg-muted"
            >
              Add First Prospect
            </Link>
          </>
        )}
      </div>
      {!onboardingComplete && (
        <p className="mt-4 text-sm text-muted-foreground">
          Live coaching needs a short Sales Profile first — you’ll set it up in
          a moment.
        </p>
      )}
    </div>
  );
}
