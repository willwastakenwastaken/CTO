import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRightLeft,
  PhoneCall,
  PlusCircle,
  StickyNote,
} from "lucide-react";

import { isUuid } from "@/domain/utils/uuid";
import { PIPELINE_TRANSITIONS } from "@/domain/pipeline/rules";
import { humanizeStage } from "@/domain/utils/format";
import { getCurrentUserId } from "@/lib/auth/session";
import { loginRedirectUrl } from "@/lib/auth/guards";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseProspectStore } from "@/lib/prospects/store";
import { createProspectService } from "@/lib/prospects/service";
import type { ProspectDetail } from "@/lib/prospects/service";
import { ProspectServiceError } from "@/lib/prospects/types";
import { prospectDisplayName } from "@/lib/prospects/query";
import { ProspectForm, prospectFormDefaults } from "@/components/prospects/prospect-form";
import { StageControl } from "@/components/prospects/stage-control";
import { NextActionEditor } from "@/components/prospects/next-action-editor";
import { NoteForm } from "@/components/prospects/note-form";
import { DeleteProspectButton } from "@/components/prospects/delete-prospect-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ProspectDetailPageProps {
  params: Promise<{ prospectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

const ACTIVITY_ICONS = {
  prospect_created: PlusCircle,
  stage_changed: ArrowRightLeft,
  call_completed: PhoneCall,
  note_added: StickyNote,
} as const;

/** Read-only structured content of a call-summary note (created by M7). */
function StructuredCallSummary({ content }: { content: unknown }) {
  const data = (content ?? {}) as Record<string, unknown>;
  const asText = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value : null;
  const asList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];

  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Situation", value: asText(data.situation) },
    { label: "Pain", value: asText(data.pain) },
    { label: "Impact", value: asText(data.impact) },
    { label: "Decision process", value: asText(data.decisionProcess) },
    { label: "Timing", value: asText(data.timing) },
    { label: "Next step", value: asText(data.nextStep) },
  ];
  const objections = asList(data.objections);
  const evidence = (data.evidence ?? {}) as Record<string, unknown>;
  const evidencePositives = asList(evidence.positives);
  const evidenceRisks = asList(evidence.risks);
  const evidenceUnknowns = asList(evidence.unknowns);
  const buyingSignals = asList(evidence.buyingSignals);
  const purchaseIntent = (data.purchaseIntent ?? {}) as Record<string, unknown>;

  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <FactRow key={row.label} label={row.label} value={row.value ?? <Blank />} />
        ))}
      </dl>
      {objections.length > 0 ? (
        <FactRow
          label="Objections"
          value={
            <ul className="list-disc pl-5 text-sm">
              {objections.map((o) => (
                <li key={o}>&ldquo;{o}&rdquo;</li>
              ))}
            </ul>
          }
        />
      ) : null}
      {typeof purchaseIntent.score === "number" ? (
        <p className="text-sm text-muted-foreground">
          Purchase intent: {purchaseIntent.score} {asText(purchaseIntent.label) ?? ""}
          {typeof purchaseIntent.evidenceCompleteness === "number"
            ? ` (${Math.round(purchaseIntent.evidenceCompleteness * 100)}% evidence completeness)`
            : ""}
        </p>
      ) : null}
      {[
        { label: "Positive evidence", items: evidencePositives },
        { label: "Buying signals", items: buyingSignals },
        { label: "Risks", items: evidenceRisks },
        { label: "Unknowns", items: evidenceUnknowns },
      ]
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </span>
            <ul className="list-disc pl-5 text-sm">
              {group.items.map((item) => (
                <li key={item}>&ldquo;{item}&rdquo;</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

export default async function ProspectDetailPage({
  params,
  searchParams,
}: ProspectDetailPageProps) {
  const { prospectId } = await params;
  // Malformed UUID -> 404 (IDs are UUID strings; never Number(id)).
  if (!isUuid(prospectId)) notFound();

  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    redirect(loginRedirectUrl(`/prospects/${prospectId}`));
  }
  const supabase = await createServerSupabaseClient();
  const service = createProspectService({
    store: createSupabaseProspectStore(supabase),
    userId,
  });

  let detail: ProspectDetail;
  try {
    detail = await service.getDetail(prospectId);
  } catch (error) {
    // Not owned or missing -> 404 (never reveal another user's prospect).
    if (error instanceof ProspectServiceError && error.category === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }
  const { prospect, notes, activities } = detail;
  const name = prospectDisplayName(prospect);
  const editing = (await searchParams).edit === "1";

  const allowedNext = PIPELINE_TRANSITIONS[prospect.stage];

  if (editing) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Edit prospect</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {name} — blank fields become unknown, never deleted data.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/prospects/${prospectId}`}>Cancel</Link>
          </Button>
        </div>
        <div className="mt-8">
          <ProspectForm
            mode="edit"
            prospectId={prospectId}
            initial={prospectFormDefaults(prospect)}
            cancelHref={`/prospects/${prospectId}`}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <Badge variant="secondary">{humanizeStage(prospect.stage)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {prospect.company ?? "No company recorded"} · Command Center
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/prospects/${prospectId}?edit=1`}>Edit</Link>
          </Button>
          <DeleteProspectButton prospectId={prospectId} prospectLabel={name} />
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          {/* Contact & company */}
          <Card>
            <CardHeader>
              <CardTitle>Contact &amp; company</CardTitle>
              <CardDescription>What you know about this prospect. Blank means unknown.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FactRow label="Name" value={name} />
                <FactRow label="Title" value={prospect.title ?? <Blank />} />
                <FactRow
                  label="Email"
                  value={
                    prospect.email ? (
                      <a className="text-primary underline-offset-4 hover:underline" href={`mailto:${prospect.email}`}>
                        {prospect.email}
                      </a>
                    ) : (
                      <Blank />
                    )
                  }
                />
                <FactRow label="Phone" value={prospect.phone ?? <Blank />} />
                <FactRow label="Company" value={prospect.company ?? <Blank />} />
                <FactRow
                  label="Website"
                  value={
                    prospect.website ? (
                      <a
                        className="text-primary underline-offset-4 hover:underline"
                        href={prospect.website}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {prospect.website}
                      </a>
                    ) : (
                      <Blank />
                    )
                  }
                />
                <FactRow label="Industry" value={prospect.industry ?? <Blank />} />
                <FactRow label="Company size" value={prospect.size ?? <Blank />} />
                <FactRow label="Location" value={prospect.location ?? <Blank />} />
                <FactRow label="Source" value={prospect.source ?? <Blank />} />
              </dl>
            </CardContent>
          </Card>

          {/* Opportunity Fit */}
          <Card>
            <CardHeader>
              <CardTitle>Opportunity Fit</CardTitle>
              <CardDescription>
                Pre-call heuristic from observable characteristics — not a likelihood to buy.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border bg-muted/40 text-2xl font-semibold tabular-nums">
                  {prospect.opportunity_fit_score ?? "—"}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">
                    {humanizeStage(prospect.opportunity_fit_label ?? "not_computed")}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {prospect.opportunity_fit_score === null
                      ? "Insufficient data — not enough known characteristics to score fit. Add industry, company size, and ideal-customer details."
                      : "Based on the known dimensions below."}
                  </span>
                </div>
              </div>
              {Array.isArray(prospect.opportunity_fit_reasons) &&
              prospect.opportunity_fit_reasons.length > 0 ? (
                <ul className="grid gap-2">
                  {prospect.opportunity_fit_reasons.map((reason) => (
                    <li
                      key={reason.dimension}
                      className="flex flex-col gap-0.5 rounded-lg border bg-muted/20 px-3 py-2"
                    >
                      <span className="text-sm font-medium">
                        {humanizeStage(reason.dimension)}
                        <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                          {reason.score === null ? "unscored" : `${reason.score}/100`}
                        </span>
                      </span>
                      <span className="text-sm text-muted-foreground">{reason.reason}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Scoring version: {prospect.opportunity_fit_scoring_version ?? "—"}
              </p>
            </CardContent>
          </Card>

          {/* Next action */}
          <Card>
            <CardHeader>
              <CardTitle>Next action</CardTitle>
              <CardDescription>What should happen next with this prospect.</CardDescription>
            </CardHeader>
            <CardContent>
              <NextActionEditor
                prospectId={prospectId}
                nextAction={prospect.next_action}
                nextActionDueDate={prospect.next_action_due_date}
              />
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
              <CardDescription>
                General notes you add, plus structured call summaries from completed calls.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <NoteForm prospectId={prospectId} />
              {notes.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No notes yet. Add a note to remember what you learn about this prospect.
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {notes.map((note) => (
                    <li key={note.id} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={note.type === "call_summary" ? "outline" : "secondary"}>
                            {note.type === "call_summary" ? "Call summary" : "Note"}
                          </Badge>
                          <h3 className="text-sm font-medium">{note.title}</h3>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(note.created_at)}
                        </span>
                      </div>
                      {note.type === "call_summary" ? (
                        <div className="mt-3">
                          <StructuredCallSummary content={note.structured_content} />
                        </div>
                      ) : note.body ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                          {note.body}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Activity timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <CardDescription>What has happened with this prospect, newest first.</CardDescription>
            </CardHeader>
            <CardContent>
              {activities.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No activity yet. Creating this prospect, moving stages, adding notes, and
                  completing linked calls will all show up here.
                </p>
              ) : (
                <ol className="relative flex flex-col gap-5 border-l pl-6">
                  {activities.map((activity) => {
                    const Icon =
                      ACTIVITY_ICONS[activity.type as keyof typeof ACTIVITY_ICONS] ?? PlusCircle;
                    return (
                      <li key={activity.id} className="relative flex flex-col gap-1">
                        <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border bg-background">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {humanizeStage(activity.type)}
                          </span>
                          <time className="text-xs text-muted-foreground">
                            {formatDateTime(activity.occurred_at)}
                          </time>
                        </div>
                        <p className="text-sm text-muted-foreground">{activity.summary}</p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline stage</CardTitle>
              <CardDescription>Move this prospect along your pipeline.</CardDescription>
            </CardHeader>
            <CardContent>
              <StageControl
                prospectId={prospectId}
                currentStage={prospect.stage}
                allowedNext={allowedNext}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-3">
                <FactRow label="Created" value={formatDateTime(prospect.created_at)} />
                <FactRow label="Last contact" value={formatDateTime(prospect.last_contact_at)} />
                <FactRow
                  label="Tags"
                  value={
                    prospect.tags && prospect.tags.length > 0 ? (
                      <span className="flex flex-wrap gap-1.5">
                        {prospect.tags.map((tag) => (
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
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
