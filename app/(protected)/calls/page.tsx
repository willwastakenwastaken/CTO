import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseCallStore } from "@/lib/calls/store";
import { getCurrentUserId } from "@/lib/auth/session";
import { loginRedirectUrl } from "@/lib/auth/guards";
import { formatDuration, humanizeStage } from "@/domain/utils/format";
import {
  applyCallsFilter,
  CALLS_FILTERS,
  callScenarioLabel,
  DEFAULT_CALLS_FILTER,
  humanizeCallStatus,
  isCallsFilterValue,
  type CallsFilterValue,
} from "@/lib/dashboard/calls";
import { callRowLabel } from "@/lib/dashboard/home";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface CallsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

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

/** Purchase Intent label, shown only for completed calls (stored data). */
function purchaseIntentLabel(
  status: string,
  label: string | null | undefined
): string {
  if (status !== "completed") return "—";
  if (!label) return "—";
  return humanizeStage(label);
}

export default async function CallsPage({ searchParams }: CallsPageProps) {
  const supabase = await createServerSupabaseClient();
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    redirect(loginRedirectUrl("/calls"));
  }
  const callStore = createSupabaseCallStore(supabase);

  // Defensive parse of the filter searchParam — anything malformed falls back
  // to "all". Never trust the browser.
  const parsed = await searchParams;
  const rawFilter = typeof parsed.filter === "string" ? parsed.filter : null;
  const filter: CallsFilterValue =
    rawFilter && isCallsFilterValue(rawFilter)
      ? rawFilter
      : DEFAULT_CALLS_FILTER;

  const sessions = await callStore.listSessions(userId);
  const filtered = applyCallsFilter(sessions, filter);

  // Prospect display identity for each call (distinct lookups only).
  const prospectIds = [
    ...new Set(
      sessions.map((session) => session.prospect_id).filter((id): id is string => id !== null)
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

  const hasCalls = sessions.length > 0;
  const noMatch = hasCalls && filtered.length === 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every practice call you&apos;ve run, newest first. Completed calls
            open their evidence-based review.
          </p>
        </div>
        <Button asChild>
          <Link href="/calls/practice">Start Practice Call</Link>
        </Button>
      </div>

      {/* Filters — a plain GET form; the server re-renders. */}
      <form
        method="get"
        action="/calls"
        className="mt-8 grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[auto_auto_1fr]"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="filter" className="text-xs uppercase tracking-wide text-muted-foreground">
            Filter
          </Label>
          <select
            id="filter"
            name="filter"
            defaultValue={filter}
            className="h-10 rounded-lg border bg-background px-3 text-sm"
          >
            {CALLS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm" className="h-10">
            Apply
          </Button>
          {filter !== DEFAULT_CALLS_FILTER && (
            <Button asChild variant="ghost" size="sm" className="h-10">
              <Link href="/calls">Clear</Link>
            </Button>
          )}
        </div>
      </form>

      {/* Honest empty states — never fake data. */}
      {!hasCalls ? (
        <div className="mt-12 flex flex-col items-start gap-3 rounded-xl border border-dashed p-10">
          <h2 className="text-lg font-semibold">No calls yet</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Run the ABC Roofing practice call to see your first session here —
            a simulated call that exercises the whole loop, from listening to
            the evidence-based review.
          </p>
          <Button asChild>
            <Link href="/calls/practice">Run the ABC Roofing practice call</Link>
          </Button>
        </div>
      ) : noMatch ? (
        <div className="mt-12 flex flex-col items-start gap-3 rounded-xl border border-dashed p-10">
          <h2 className="text-lg font-semibold">No calls match this filter</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Nothing in your stored calls matches &ldquo;{CALLS_FILTERS.find((f) => f.value === filter)?.label}
            &rdquo;. Try another filter, or clear it to see everything.
          </p>
          <Button asChild variant="outline">
            <Link href="/calls">Clear filter</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <caption className="sr-only">Calls</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th scope="col" className="px-4 py-3 font-medium">Call</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Started</th>
                <th scope="col" className="px-4 py-3 font-medium">Duration</th>
                <th scope="col" className="px-4 py-3 font-medium">Purchase Intent</th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((session) => {
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
                  <tr key={session.id} className="border-b last:border-b-0 hover:bg-muted/20">
                    <td className="max-w-[280px] px-4 py-3">
                      <p className="truncate font-medium" title={label}>
                        {label}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {callScenarioLabel(session.scenario)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{humanizeCallStatus(session.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(session.started_at)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {session.duration_seconds != null
                        ? formatDuration(session.duration_seconds * 1000)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {purchaseIntentLabel(session.status, session.purchase_intent_label)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {link ? (
                        <Link
                          href={link}
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {session.status === "completed" ? "Review" : "Open live"}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
