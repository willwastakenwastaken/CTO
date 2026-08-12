import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseCallStore } from "@/lib/calls/store";
import { getCurrentUserId } from "@/lib/auth/session";
import { loginRedirectUrl } from "@/lib/auth/guards";
import {
  COACH_ELIGIBLE_CALLS_THRESHOLD,
  aggregateCoachingInsights,
  coachEligibility,
  selectEligibleCalls,
} from "@/lib/coach/insights";
import { callRowLabel } from "@/lib/dashboard/home";
import { humanizeStage } from "@/domain/utils/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function CoachPage() {
  const supabase = await createServerSupabaseClient();
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    redirect(loginRedirectUrl("/coach"));
  }
  const callStore = createSupabaseCallStore(supabase);
  const sessions = await callStore.listSessions(userId);

  const eligibility = coachEligibility(sessions);
  const eligibleCalls = selectEligibleCalls(sessions);

  // Prospect display identity for call labels (distinct lookups only).
  const prospectIds = [
    ...new Set(
      sessions
        .map((session) => session.prospect_id)
        .filter((id): id is string => id !== null)
    ),
  ];
  const prospectIdentities = new Map<
    string,
    { name: string | null; company: string | null } | null
  >();
  await Promise.all(
    prospectIds.map(async (id) => {
      prospectIdentities.set(id, await callStore.getProspect(id));
    })
  );
  const labelFor = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    const identity = session?.prospect_id
      ? prospectIdentities.get(session.prospect_id) ?? null
      : null;
    return callRowLabel({
      prospectName: identity?.name ?? null,
      prospectCompany: identity?.company ?? null,
    });
  };

  const totalCompleted = sessions.filter((s) => s.status === "completed").length;
  const insights = aggregateCoachingInsights(eligibleCalls);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Coach</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Evidence-backed observations from your completed calls — never
            invented, never a guess.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/calls/practice">Run a practice call</Link>
        </Button>
      </div>

      {sessions.length === 0 ? (
        <div className="mt-12 flex flex-col items-start gap-3 rounded-xl border border-dashed p-10">
          <h2 className="text-lg font-semibold">No calls yet</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Complete at least {COACH_ELIGIBLE_CALLS_THRESHOLD} practice calls to
            unlock coaching insights. Insights are built from completed calls
            with a saved review — patterns are only named when there&apos;s
            enough evidence.
          </p>
          <Button asChild>
            <Link href="/calls/practice">Run the ABC Roofing practice call</Link>
          </Button>
        </div>
      ) : !eligibility.unlocked ? (
        <div className="mt-12 flex flex-col items-start gap-3 rounded-xl border border-dashed p-10">
          <h2 className="text-lg font-semibold">
            {eligibility.eligibleCount} of {eligibility.threshold} eligible
            calls completed
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Coaching insights unlock after{" "}
            {COACH_ELIGIBLE_CALLS_THRESHOLD} completed practice calls with a
            saved review
            {totalCompleted > eligibility.eligibleCount
              ? ` — you have ${totalCompleted} completed call${
                  totalCompleted === 1 ? "" : "s"
                } total, ${
                  totalCompleted - eligibility.eligibleCount
                } without a saved review`
              : ""}
            . A single call is never enough to name a pattern.
          </p>
          <Button asChild>
            <Link href="/calls/practice">Complete another practice call</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">
            Based on {eligibility.eligibleCount} eligible completed calls.
            Observations below come straight from your saved reviews.
          </p>

          {/* Strengths */}
          <Card>
            <CardHeader>
              <CardTitle>Strengths</CardTitle>
              <CardDescription>
                Coaching areas your reviews marked as strengths, by how often
                they show up.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {insights.strengths.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No strengths recorded yet — reviews haven&apos;t marked any
                  area as a strength.
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {insights.strengths.map((area) => (
                    <AreaInsightRow
                      key={area.area}
                      area={area.area}
                      count={area.count}
                      total={eligibility.eligibleCount}
                      observations={area.observations}
                      examples={area.examples}
                      labelFor={labelFor}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Improvement areas */}
          <Card>
            <CardHeader>
              <CardTitle>Improvement areas</CardTitle>
              <CardDescription>
                Coaching areas your reviews suggested working on, by frequency.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {insights.improvements.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No improvement areas recorded yet — reviews haven&apos;t
                  flagged any.
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {insights.improvements.map((area) => (
                    <AreaInsightRow
                      key={area.area}
                      area={area.area}
                      count={area.count}
                      total={eligibility.eligibleCount}
                      observations={area.observations}
                      examples={area.examples}
                      labelFor={labelFor}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Purchase Intent + pipeline recommendations */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Purchase Intent</CardTitle>
                <CardDescription>
                  Evidence-based labels across your eligible calls.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {insights.purchaseIntentLabels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No labels recorded.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {insights.purchaseIntentLabels.map((item) => (
                      <li
                        key={item.label}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="font-medium">
                          {humanizeStage(item.label)}
                        </span>
                        <span className="text-muted-foreground">
                          {item.count} of {eligibility.eligibleCount} calls
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pipeline recommendations</CardTitle>
                <CardDescription>
                  The next-stage moves your reviews recommended.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {insights.pipelineRecommendations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No recommendations recorded.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {insights.pipelineRecommendations.map((item) => (
                      <li
                        key={item.targetStage}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="font-medium">
                          {humanizeStage(item.targetStage)}
                        </span>
                        <span className="text-muted-foreground">
                          {item.count} of {eligibility.eligibleCount} calls
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent coaching moments */}
          <Card>
            <CardHeader>
              <CardTitle>Recent coaching moments</CardTitle>
              <CardDescription>
                The latest eligible calls and what each review observed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {insights.recentMoments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No coaching moments yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {insights.recentMoments.map((moment) => (
                    <li
                      key={moment.callId}
                      className="rounded-lg border p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {labelFor(moment.callId)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(moment.createdAt)}
                          </span>
                        </div>
                        <Link
                          href={`/calls/${moment.callId}/review`}
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                          Open review
                        </Link>
                      </div>
                      {moment.observations.length === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                          No coaching observations recorded for this call.
                        </p>
                      ) : (
                        <ul className="mt-2 flex flex-col gap-1.5">
                          {moment.observations.map((observation) => (
                            <li
                              key={`${observation.area}-${observation.observation}`}
                              className="flex flex-wrap items-start gap-2 text-sm text-muted-foreground"
                            >
                              <Badge
                                variant={
                                  observation.kind === "strength"
                                    ? "outline"
                                    : "secondary"
                                }
                                className="mt-0.5 shrink-0"
                              >
                                {observation.kind === "strength"
                                  ? "Strength"
                                  : "Improvement"}
                              </Badge>
                              <span>
                                <span className="font-medium text-foreground">
                                  {humanizeStage(observation.area)}:
                                </span>{" "}
                                {observation.observation}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function AreaInsightRow({
  area,
  count,
  total,
  observations,
  examples,
  labelFor,
}: {
  area: string;
  count: number;
  total: number;
  observations: string[];
  examples: Array<{ callId: string; quote: string }>;
  labelFor: (callId: string) => string;
}) {
  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{humanizeStage(area)}</span>
        <Badge variant="outline" className="shrink-0 tabular-nums">
          {count} of {total} calls
        </Badge>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {observations.map((observation) => (
          <li key={observation}>{observation}</li>
        ))}
      </ul>
      {examples.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {examples.map((example) => (
            <li key={`${example.callId}-${example.quote}`}>
              <span className="text-muted-foreground">
                &ldquo;{example.quote}&rdquo;
              </span>{" "}
              —{" "}
              <Link
                href={`/calls/${example.callId}/review`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {labelFor(example.callId)} review
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
