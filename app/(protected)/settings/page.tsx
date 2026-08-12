import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loginRedirectUrl } from "@/lib/auth/guards";
import { mapAccountInfo, salesProfileStatus } from "@/lib/dashboard/settings";
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

  // Stored data only — missing values stay blank, never fictional.
  const account = mapAccountInfo({
    email: user.email,
    displayName: profile?.display_name,
    timezone: profile?.timezone,
  });
  const salesProfile = salesProfileStatus(profile?.onboarding_state ?? null);
  const salesProfileComplete = salesProfile.status === "complete";

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
              Your sign-in email, display name, and timezone. The timezone is
              used for follow-up due dates.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <dl className="grid gap-3 rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Email
                </dt>
                <dd className="text-sm">
                  {account.email ?? (
                    <span className="text-muted-foreground">Not set</span>
                  )}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Display name
                </dt>
                <dd className="text-sm">
                  {account.displayName ?? (
                    <span className="text-muted-foreground">Not set</span>
                  )}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Timezone
                </dt>
                <dd className="text-sm">
                  {account.timezone ?? (
                    <span className="text-muted-foreground">Not set</span>
                  )}
                </dd>
              </div>
            </dl>
            <AccountSettingsForm
              userId={user.id}
              initial={{
                display_name: account.displayName,
                timezone: account.timezone,
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sales Profile</CardTitle>
            <CardDescription>{salesProfile.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm">
                <span
                  className={
                    salesProfileComplete
                      ? "text-emerald-600 dark:text-emerald-500"
                      : "text-amber-600 dark:text-amber-500"
                  }
                >
                  {salesProfile.label}
                </span>
              </p>
              <Link
                href="/settings/sales-profile"
                className="inline-flex h-8 items-center justify-center rounded-lg border px-3 text-sm font-medium hover:bg-muted"
              >
                {salesProfileComplete
                  ? "Edit sales profile"
                  : "Complete sales profile"}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
