import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loginRedirectUrl } from "@/lib/auth/guards";
import { AccountSettingsForm } from "@/components/settings/account-settings-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function SettingsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(loginRedirectUrl("/settings"));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, timezone, onboarding_state")
    .eq("id", user.id)
    .maybeSingle();

  const onboardingState = profile?.onboarding_state ?? null;
  const onboardingComplete = onboardingState === "complete";

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Account basics and how SignalDesk coaches you.
      </p>

      <div className="mt-8 grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              Your display name appears in the sidebar. The timezone is used for
              follow-up due dates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccountSettingsForm
              userId={user.id}
              initial={{
                display_name: profile?.display_name ?? null,
                timezone: profile?.timezone ?? null,
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sales Profile</CardTitle>
            <CardDescription>
              {onboardingComplete
                ? "Your Sales Profile is complete — edit it any time."
                : "A Sales Profile unlocks live coaching. Complete it before starting a practice call."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm">
                <span
                  className={
                    onboardingComplete
                      ? "text-emerald-600 dark:text-emerald-500"
                      : "text-amber-600 dark:text-amber-500"
                  }
                >
                  {onboardingComplete ? "Complete" : "Not started"}
                </span>
              </p>
              <Link
                href="/settings/sales-profile"
                className="inline-flex h-8 items-center justify-center rounded-lg border px-3 text-sm font-medium hover:bg-muted"
              >
                {onboardingComplete ? "Edit sales profile" : "Complete sales profile"}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
