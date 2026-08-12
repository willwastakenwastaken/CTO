// Call Strategy card for the Command Center — the pre-call brief, built
// server-side from stored data only (lib/prospects/service.getCallStrategy).
// Renders the deterministic brief with honest empty states; every section
// distinguishes saved prospect facts, profile-derived content, and labeled
// hypotheses. "Call Strategy" — never a script. When no Sales Profile exists
// the card links to onboarding instead of inventing a strategy.
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { CallStrategyResult } from "@/domain/call-strategy/types";
import { StartCallButton } from "@/components/prospects/start-call-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function Blank() {
  return <span className="text-muted-foreground">—</span>;
}

/** Honest empty-state text for a subsection with nothing inferable. */
function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function ReadyStrategy({
  prospectId,
  strategy,
}: {
  prospectId: string;
  strategy: Extract<CallStrategyResult, { state: "ready" }>;
}) {
  const {
    profileName,
    context,
    angle,
    painHypotheses,
    objective,
    opener,
    discoveryQuestions,
    objectionsToExpect,
    guardrails,
    close,
  } = strategy;

  return (
    <>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <CardTitle>Call Strategy</CardTitle>
          <CardDescription>
            Pre-call brief from your Sales Profile and this prospect&apos;s saved
            data. Facts, profile content, and hypotheses are labeled.
          </CardDescription>
        </div>
        <StartCallButton prospectId={prospectId} />
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Known context */}
        <section aria-label="Known context" className="flex flex-col gap-2">
          <SectionLabel>Known context</SectionLabel>
          {context.summary ? (
            <p className="text-sm">{context.summary}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No context recorded for this prospect yet.
            </p>
          )}
          <dl className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FactRow label="Title" value={context.title ?? <Blank />} />
            <FactRow label="Company" value={context.company ?? <Blank />} />
            <FactRow label="Industry" value={context.industry ?? <Blank />} />
            <FactRow label="Company size" value={context.size ?? <Blank />} />
            <FactRow label="Location" value={context.location ?? <Blank />} />
            <FactRow label="Source" value={context.source ?? <Blank />} />
            <FactRow
              label="Tags"
              value={
                context.tags.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5">
                    {context.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  <Blank />
                )
              }
            />
          </dl>
        </section>

        {/* Opportunity angle */}
        <section aria-label="Opportunity angle" className="flex flex-col gap-2">
          <SectionLabel>Opportunity angle</SectionLabel>
          {angle.present ? (
            <div className="flex flex-col gap-2">
              {angle.summary ? <p className="text-sm">{angle.summary}</p> : null}
              <ul className="flex flex-col gap-1.5">
                {angle.points.map((point) => (
                  <li
                    key={point.label}
                    className="rounded-lg border bg-muted/20 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{point.label}</span>
                    <span className="text-muted-foreground"> — {point.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyNote>{angle.note ?? "No angle yet."}</EmptyNote>
          )}
        </section>

        {/* Pain hypotheses */}
        <section aria-label="Pain hypotheses" className="flex flex-col gap-2">
          <SectionLabel>Pain hypotheses</SectionLabel>
          {painHypotheses.length === 0 ? (
            <EmptyNote>
              No pain hypotheses yet — nothing in this prospect&apos;s record
              supports one.
            </EmptyNote>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {painHypotheses.map((h) => (
                <li key={h.hypothesis} className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                  <span className="font-medium">Hypothesis:</span> {h.hypothesis}
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {h.support}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Objective */}
        <section aria-label="Call objective" className="flex flex-col gap-1.5">
          <SectionLabel>Call objective</SectionLabel>
          <p className="text-sm">{objective.text}</p>
          {objective.source === "default" ? (
            <p className="text-xs text-muted-foreground">
              Default objective — set a call goal in your Sales Profile to
              personalize it.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">From your Sales Profile.</p>
          )}
        </section>

        {/* Opener */}
        <section aria-label="Opener" className="flex flex-col gap-1.5">
          <SectionLabel>Opener</SectionLabel>
          <blockquote className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
            {opener.text}
          </blockquote>
          {opener.note ? (
            <p className="text-xs text-muted-foreground">{opener.note}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Built from your benefits and preferred call to action.
            </p>
          )}
        </section>

        {/* Discovery questions */}
        <section aria-label="Discovery questions" className="flex flex-col gap-2">
          <SectionLabel>Discovery questions</SectionLabel>
          {discoveryQuestions.length === 0 ? (
            <EmptyNote>
              No discovery questions yet — add problems solved, benefits, or an
              ideal customer to your Sales Profile.
            </EmptyNote>
          ) : (
            <ol className="flex list-decimal flex-col gap-1.5 pl-5">
              {discoveryQuestions.map((q) => (
                <li key={q.question} className="text-sm">
                  {q.question}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    ({q.basis})
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Objections to expect + guardrails */}
        <section aria-label="Objections to expect" className="flex flex-col gap-2">
          <SectionLabel>Objections to expect</SectionLabel>
          {objectionsToExpect.length === 0 ? (
            <EmptyNote>
              No objections recorded in your Sales Profile yet.
            </EmptyNote>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {objectionsToExpect.map((o) => (
                <li key={o.objection} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-lg border bg-muted/20 px-3 py-1.5">
                    {o.objection}
                  </span>
                  {o.relatedGuardrail ? (
                    <Badge variant="outline">
                      Remember: {o.relatedGuardrail}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {guardrails.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Guardrails
              </span>
              <div className="flex flex-wrap gap-1.5">
                {guardrails.map((g) => (
                  <Badge key={g} variant="outline">
                    {g}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Close */}
        <section aria-label="Close" className="flex flex-col gap-1.5">
          <SectionLabel>Close</SectionLabel>
          <p className="text-sm">{close.instruction}</p>
          {close.note ? (
            <p className="text-xs text-muted-foreground">{close.note}</p>
          ) : (
            <p className="text-xs text-muted-foreground">From your preferred call to action.</p>
          )}
        </section>

        <p className="border-t pt-3 text-xs text-muted-foreground">
          Built from {profileName ? `“${profileName}”` : "your default"} Sales Profile
          and this prospect&apos;s saved data — nothing is invented.
        </p>
      </CardContent>
    </>
  );
}

export function CallStrategyCard({
  prospectId,
  strategy,
}: {
  prospectId: string;
  strategy: CallStrategyResult;
}) {
  if (strategy.state === "onboarding_required") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Call Strategy</CardTitle>
          <CardDescription>
            The pre-call brief — who they are, why they might care, and what to
            ask — is built from your Sales Profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm">{strategy.reason}</p>
          <Button asChild size="sm">
            <Link href="/settings/sales-profile?reason=onboarding">
              Complete your Sales Profile
              <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            It takes a couple of minutes — then this prospect&apos;s brief and
            Start AI-Assisted Call unlock here.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <ReadyStrategy prospectId={prospectId} strategy={strategy} />
    </Card>
  );
}
