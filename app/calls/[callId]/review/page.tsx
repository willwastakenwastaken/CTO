import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { isUuid } from "@/domain/utils/uuid";
import { formatDuration, humanizeStage } from "@/domain/utils/format";
import { getScenario } from "@/providers/simulation/registry";
import { getCurrentUserId } from "@/lib/auth/session";
import { loginRedirectUrl } from "@/lib/auth/guards";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseCallStore } from "@/lib/calls/store";
import { createSimulationService } from "@/lib/calls/service";
import type { StoredReviewPayload } from "@/domain/schemas/review";
import { ApplyPipelineRecommendation } from "@/components/review/apply-pipeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function humanizeOutcome(outcome: string | null | undefined): string {
  if (!outcome) return "—";
  return outcome
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function FactRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || <span className="text-muted-foreground">Not revealed</span>}</dd>
    </div>
  );
}

export default async function CallReviewPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { callId } = await params;
  // Malformed UUID -> 404 (IDs are UUID strings; never Number(id)).
  if (!isUuid(callId)) notFound();

  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    redirect(loginRedirectUrl(`/calls/${callId}/review`));
  }
  const supabase = await createServerSupabaseClient();
  const store = createSupabaseCallStore(supabase);
  const service = createSimulationService({ store, userId });

  // Ownership guard: a call the current user doesn't own is a 404.
  const row = await store.getSession(callId);
  if (!row || row.user_id !== userId) notFound();

  // Honest empty states: cancelled/failed calls never get a review.
  if (row.status === "cancelled" || row.status === "failed") {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="flex flex-col items-start gap-3">
          <Badge variant="outline">PRACTICE</Badge>
          <h1 className="text-2xl font-semibold tracking-tight">No review for this call</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            This call was {row.status}, so no evidence-based review was generated. The transcript is
            kept — you can start another practice call any time.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/calls">Back to Calls</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/home">Back to Home</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // Calm "being prepared" state for prepared/live/processing calls.
  if (row.status !== "completed") {
    const live = row.status === "live";
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="flex flex-col items-start gap-3">
          <Badge variant="outline">PRACTICE</Badge>
          <h1 className="text-2xl font-semibold tracking-tight">Generating call review</h1>
          <p className="max-w-xl text-sm text-muted-foreground" role="status" aria-live="polite">
            {live
              ? "This call is still live — end the session to generate the evidence-based review."
              : "The review is being prepared. Refresh in a moment to see it."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {live && (
              <Button asChild>
                <Link href={`/calls/${callId}/live`}>Back to live session</Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={`/calls/${callId}/review`}>Refresh</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/calls">Back to Calls</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // Completed: finalize (idempotent) so a call that ended before the review
  // was persisted still gets one here, then load the saved review payload.
  let review: StoredReviewPayload;
  try {
    const result = await service.finalizeReview(callId);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    review = result.review;
  } catch {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="flex flex-col items-start gap-3">
          <Badge variant="outline">PRACTICE</Badge>
          <h1 className="text-2xl font-semibold tracking-tight">Review unavailable right now</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            The review couldn&apos;t be loaded. Your transcript and signals are safe — refresh to try again.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild>
              <Link href={`/calls/${callId}/review`}>Try again</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/calls">Back to Calls</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const scenario = getScenario(row.scenario);
  const prospect = row.prospect_id ? await store.getProspectRecord(row.prospect_id) : null;
  const prospectName = prospect
    ? [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") ||
      prospect.company ||
      "Linked prospect"
    : null;
  const toStage = review.pipelineRecommendation.targetStage;
  const alreadyApplied = prospect?.stage === toStage;
  const durationSeconds = row.duration_seconds;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">PRACTICE</Badge>
              <span className="text-sm text-muted-foreground">{scenario.label}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Call review</h1>
            <p className="text-sm text-muted-foreground">
              {humanizeOutcome(review.outcome)}
              {durationSeconds !== null && durationSeconds !== undefined
                ? ` · ${formatDuration(durationSeconds * 1000)}`
                : ""}
              {prospect ? (
                <>
                  {" · "}
                  <Link href={`/prospects/${prospect.id}`} className="text-primary underline-offset-4 hover:underline">
                    {prospectName}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/calls">Back to Calls</Link>
          </Button>
        </div>

        {/* Purchase Intent */}
        <Card>
          <CardHeader>
            <CardTitle>Purchase Intent</CardTitle>
            <CardDescription>
              Evidence-based heuristic — never a probability. {Math.round(review.purchaseIntent.evidenceCompleteness * 100)}%
              evidence completeness · {review.purchaseIntent.scoringVersion}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border bg-muted/40 text-2xl font-semibold tabular-nums">
              {review.purchaseIntent.score ?? "—"}
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-medium">{humanizeStage(review.purchaseIntent.label)}</span>
              <span className="text-sm text-muted-foreground">
                {review.purchaseIntent.score === null
                  ? "Insufficient data — not enough revealed evidence."
                  : `Based on the confirmed evidence below (${Math.round(review.purchaseIntent.evidenceCompleteness * 100)}% of the seven evidence dimensions known).`}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Evidence — verbatim quotes only, grouped positive / risk / unknown */}
        <Card>
          <CardHeader>
            <CardTitle>Evidence</CardTitle>
            <CardDescription>Verbatim quotes and confirmed signals from this call.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Positive</h2>
              <ul className="list-disc space-y-1.5 pl-5 text-sm">
                {review.purchaseIntent.positives.map((p) => (
                  <li key={p}>{p}</li>
                ))}
                {review.buyingSignals.map((signal) => (
                  <li key={signal.eventId}>
                    <span className="text-muted-foreground">&ldquo;{signal.quote}&rdquo;</span>
                  </li>
                ))}
                {review.purchaseIntent.positives.length === 0 && review.buyingSignals.length === 0 && (
                  <li className="text-muted-foreground">No positive evidence revealed.</li>
                )}
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-amber-700 dark:text-amber-300">Risks</h2>
              <ul className="list-disc space-y-1.5 pl-5 text-sm">
                {review.purchaseIntent.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
                {review.objections.map((objection) => (
                  <li key={objection.eventId}>
                    <span className="text-muted-foreground">&ldquo;{objection.quote}&rdquo;</span>
                  </li>
                ))}
                {review.purchaseIntent.risks.length === 0 && review.objections.length === 0 && (
                  <li className="text-muted-foreground">No risks revealed.</li>
                )}
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">Unknowns</h2>
              <ul className="list-disc space-y-1.5 pl-5 text-sm">
                {review.purchaseIntent.unknowns.map((u) => (
                  <li key={u}>{u}</li>
                ))}
                {review.purchaseIntent.unknowns.length === 0 && (
                  <li className="text-muted-foreground">None outstanding.</li>
                )}
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{review.summary}</p>
          </CardContent>
        </Card>

        {/* Facts */}
        <Card>
          <CardHeader>
            <CardTitle>What we learned</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FactRow label="Pain" value={review.facts.pain} />
              <FactRow label="Impact" value={review.facts.impact} />
              <FactRow label="Authority" value={review.facts.authority} />
              <FactRow label="Budget" value={review.facts.budget} />
              <FactRow label="Timing" value={review.facts.timing} />
              <FactRow label="Current solution" value={review.facts.currentSolution} />
              <FactRow label="Competitors" value={review.facts.competitors.join(", ") || null} />
              <FactRow label="Decision process" value={review.facts.decisionProcess} />
            </dl>
          </CardContent>
        </Card>

        {/* Coaching */}
        <Card>
          <CardHeader>
            <CardTitle>Coaching observations</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {review.coaching.map((observation, index) => (
              <div key={`${observation.area}-${index}`} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={observation.kind === "strength" ? "outline" : "secondary"}>
                    {observation.kind === "strength" ? "Strength" : "Improvement"}
                  </Badge>
                  <span className="text-sm font-medium">{humanizeStage(observation.area)}</span>
                </div>
                <p className="text-sm text-muted-foreground">{observation.observation}</p>
                {observation.evidence.length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    {observation.evidence.map((ref) => (
                      <li key={ref.eventId}>&ldquo;{ref.quote}&rdquo;</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Next action */}
        <Card>
          <CardHeader>
            <CardTitle>Next action</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{review.nextAction}</p>
          </CardContent>
        </Card>

        {/* Pipeline recommendation + Apply */}
        <Card>
          <CardHeader>
            <CardTitle>Pipeline recommendation</CardTitle>
            <CardDescription>
              Suggested move: {humanizeStage(review.preCallStage)} → {humanizeStage(toStage)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed">{review.pipelineRecommendation.reason}</p>
            <ApplyPipelineRecommendation
              callId={callId}
              prospectId={row.prospect_id}
              prospectLabel={prospectName ?? "Linked prospect"}
              prospectHref={`/prospects/${row.prospect_id ?? ""}`}
              fromStage={review.preCallStage}
              toStage={toStage}
              reason={review.pipelineRecommendation.reason}
              alreadyApplied={alreadyApplied}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
