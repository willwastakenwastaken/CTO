import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseCallStore } from "@/lib/calls/store";
import { createSupabaseProspectStore } from "@/lib/prospects/store";
import { createProspectService } from "@/lib/prospects/service";
import { getOnboardingState } from "@/lib/auth/profile";
import { getCurrentUserId } from "@/lib/auth/session";
import { loginRedirectUrl } from "@/lib/auth/guards";
import { prospectDisplayName } from "@/lib/prospects/query";
import { humanizeStage, formatDuration } from "@/domain/utils/format";
import {
  callScenarioLabel,
  humanizeCallStatus,
} from "@/lib/dashboard/calls";
import {
  countStages,
  formatActivitySummary,
  HOME_RECENT_ACTIVITY_LIMIT,
  selectRecentCalls,
  selectUpcomingActions,
  callRowLabel,
} from "@/lib/dashboard/home";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** The exact "YYYY-MM-DD" key used to compare due dates (server clock). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    redirect(loginRedirectUrl("/home"));
  }
  // New users (no completed Sales Profile) see "Start Practice Call" and
  // "Add First Prospect" — not fake metrics. Everyone else sees the full
  // "Ready to sell?" CTAs. Both call CTAs route through /calls/practice,
  // which enforces the onboarding gate.
  const onboardingState = await getOnboardingState(supabase, userId);
  const onboardingComplete = onboardingState === "complete";

  const prospectService = createProspectService({
    store: createSupabaseProspectStore(supabase),
    userId,
  });
  const callStore = createSupabaseCallStore(supabase);

  // All read-only aggregations come from STORED rows — no fake metrics.
  const [prospects, sessions, activities] = await Promise.all([
    prospectService.listProspects({
      ilike: [],
      eq: [],
      order: { column: "created_at", ascending: false },
    }),
    callStore.listSessions(userId),
    supabase
      .from("activities")
      .select("id, type, summary, metadata, prospect_id, call_id, occurred_at")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(HOME_RECENT_ACTIVITY_LIMIT),
  ]);
  const activityRows = (activities.data ?? []) as Array<{
    id: string;
    type: string;
    summary: string | null;
    metadata: unknown;
    prospect_id: string | null;
    call_id: string | null;
    occurred_at: string;
  }>;

  const upcoming = selectUpcomingActions(prospects, todayIso());
  const recentSessions = selectRecentCalls(sessions);
  const stages = countStages(prospects);

  // Prospect display identity for each recent call (distinct lookups only).
  const recentProspectIds = [
    ...new Set(
      recentSessions
        .map((session) => session.prospect_id)
        .filter((id): id is string => id !== null)
    ),
  ];
  const prospectIdentities = new Map<
    string,
    { name: string | null; company: string | null } | null
  >();
  await Promise.all(
    recentProspectIds.map(async (id) => {
      prospectIdentities.set(id, await callStore.getProspect(id));
    })
  );

  const hasProspects = prospects.length > 0;
  const hasActivity = activityRows.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Ready to sell?
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What should you do next — from the calls, prospects, and follow-ups
            you&apos;ve already logged.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {onboardingComplete ? (
            <>
              <Button asChild>
                <Link href="/calls/practice">Start a Call</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/prospects">Choose Prospect</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild>
                <Link href="/calls/practice">Start Practice Call</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/prospects/new">Add First Prospect</Link>
              </Button>
            </>
          )}
        </div>
      </div>
      {!onboardingComplete && (
        <p className="mt-4 text-sm text-muted-foreground">
          Live coaching needs a short Sales Profile first — you&apos;ll set it
          up in a moment.
        </p>
      )}

      <div className="mt-8 grid gap-6">
        {/* Upcoming follow-ups */}
        <Card>
          <CardHeader>
            <CardTitle>Upcoming follow-ups</CardTitle>
            <CardDescription>
              Prospects with a next action, due-soon first. Overdue actions
              are flagged, never hidden.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
                <p className="text-sm text-muted-foreground">
                  No upcoming follow-ups yet — add a next action to a prospect
                  and it shows up here.
                </p>
                {!hasProspects ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/prospects/new">Add your first prospect</Link>
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/prospects">Open prospects</Link>
                  </Button>
                )}
              </div>
            ) : (
              <ul className="divide-y">
                {upcoming.map((item) => (
                  <li key={item.prospect.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/prospects/${item.prospect.id}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {prospectDisplayName(item.prospect)}
                      </Link>
                      <p className="truncate text-sm text-muted-foreground">
                        {item.prospect.next_action}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.overdue ? (
                        <Badge variant="destructive">Overdue</Badge>
                      ) : item.dueToday ? (
                        <Badge variant="secondary">Due today</Badge>
                      ) : null}
                      <span
                        className={`text-sm tabular-nums ${
                          item.overdue
                            ? "font-medium text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {item.dueDate ? `Due ${formatDate(item.dueDate)}` : "No due date"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent calls */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Recent calls</CardTitle>
              <CardDescription>
                Your most recent practice calls — completed ones open their
                evidence-based review.
              </CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/calls">View all calls</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentSessions.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
                <p className="text-sm text-muted-foreground">
                  No calls yet — start a practice call and the ABC Roofing
                  scenario runs end to end.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/calls/practice">Start a practice call</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y">
                {recentSessions.map((session) => {
                  const identity = session.prospect_id
                    ? prospectIdentities.get(session.prospect_id) ?? null
                    : null;
                  const label = callRowLabel({
                    prospectName: identity?.name ?? null,
                    prospectCompany: identity?.company ?? null,
                  });
                  const link =
                    session.status === "completed"
                      ? `/calls/${session.id}/review`
                      : session.status === "cancelled" ||
                          session.status === "failed"
                        ? null
                        : `/calls/${session.id}/live`;
                  return (
                    <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">{label}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {callScenarioLabel(session.scenario)}
                          {session.started_at
                            ? ` · ${formatDate(session.started_at)}`
                            : ""}
                          {session.duration_seconds != null
                            ? ` · ${formatDuration(session.duration_seconds * 1000)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge variant="outline">
                          {humanizeCallStatus(session.status)}
                        </Badge>
                        {link ? (
                          <Link
                            href={link}
                            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {session.status === "completed" ? "Review" : "Open live"}
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Pipeline summary */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Pipeline</CardTitle>
                <CardDescription>
                  Stored prospects by stage — every count comes from a real
                  prospect row.
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/pipeline">View pipeline</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {!hasProspects ? (
                <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
                  <p className="text-sm text-muted-foreground">
                    No prospects in your pipeline yet.
                  </p>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/prospects/new">Add your first prospect</Link>
                  </Button>
                </div>
              ) : (
                <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  {stages.map(({ stage, count }) => (
                    <li key={stage} className="flex items-baseline justify-between gap-2">
                      <Link
                        href="/pipeline"
                        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        {humanizeStage(stage)}
                      </Link>
                      <span className="text-sm font-medium tabular-nums">
                        {count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>
                The latest timeline entries from your calls and prospects.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!hasActivity ? (
                <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
                  <p className="text-sm text-muted-foreground">
                    No activity yet — creating prospects and completing calls
                    will show up here.
                  </p>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/calls/practice">Start a practice call</Link>
                  </Button>
                </div>
              ) : (
                <ul className="divide-y">
                  {activityRows.map((activity) => (
                    <li key={activity.id} className="flex items-start justify-between gap-3 py-2.5">
                      <p className="text-sm">
                        {formatActivitySummary(activity)}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(activity.occurred_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
