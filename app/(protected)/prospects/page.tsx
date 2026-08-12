import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseProspectStore } from "@/lib/prospects/store";
import { createProspectService } from "@/lib/prospects/service";
import {
  buildProspectListSpec,
  prospectDisplayName,
  SORT_OPTIONS,
} from "@/lib/prospects/query";
import { prospectListQuerySchema, type ProspectSort } from "@/lib/prospects/schema";
import { PIPELINE_STAGES } from "@/domain/pipeline/types";
import { humanizeStage } from "@/domain/utils/format";
import { getCurrentUserId } from "@/lib/auth/session";
import { loginRedirectUrl } from "@/lib/auth/guards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface ProspectsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ProspectsPage({ searchParams }: ProspectsPageProps) {
  const supabase = await createServerSupabaseClient();
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    redirect(loginRedirectUrl("/prospects"));
  }
  const service = createProspectService({
    store: createSupabaseProspectStore(supabase),
    userId,
  });

  // Defensive parse of searchParams — anything malformed falls back to the
  // default list (all stages, newest first). Never trust the browser.
  const parsed = prospectListQuerySchema.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : {};
  const spec = buildProspectListSpec(query);
  const prospects = await service.listProspects(spec);

  const hasQuery = Boolean(query.q || query.stage);
  const empty = prospects.length === 0;
  const noProspectsAtAll = empty && !hasQuery;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prospects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone you&apos;re tracking, with their pipeline stage and Opportunity Fit.
          </p>
        </div>
        <Button asChild>
          <Link href="/prospects/new">New Prospect</Link>
        </Button>
      </div>

      {/* Search / filter / sort — a plain GET form; the server re-renders. */}
      <form
        method="get"
        action="/prospects"
        className="mt-8 grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_auto_auto_auto]"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="q" className="text-xs uppercase tracking-wide text-muted-foreground">
            Search
          </Label>
          <Input
            id="q"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="Name, company, or email…"
            className="bg-background"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="stage" className="text-xs uppercase tracking-wide text-muted-foreground">
            Stage
          </Label>
          <select
            id="stage"
            name="stage"
            defaultValue={query.stage ?? ""}
            className="h-10 rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">All stages</option>
            {PIPELINE_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {humanizeStage(stage)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sort" className="text-xs uppercase tracking-wide text-muted-foreground">
            Sort
          </Label>
          <select
            id="sort"
            name="sort"
            defaultValue={(query.sort as ProspectSort | undefined) ?? "created"}
            className="h-10 rounded-lg border bg-background px-3 text-sm"
          >
            {SORT_OPTIONS.map((option) => (
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
          {(query.q || query.stage) && (
            <Button asChild variant="ghost" size="sm" className="h-10">
              <Link href="/prospects">Clear</Link>
            </Button>
          )}
        </div>
      </form>

      {/* Honest empty states — never fake data. */}
      {noProspectsAtAll ? (
        <div className="mt-12 flex flex-col items-start gap-3 rounded-xl border border-dashed p-10">
          <h2 className="text-lg font-semibold">No prospects yet</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Add the first prospect you want to work — contact details, pipeline stage, and
            Opportunity Fit all start here.
          </p>
          <Button asChild>
            <Link href="/prospects/new">Add your first prospect</Link>
          </Button>
        </div>
      ) : empty ? (
        <div className="mt-12 flex flex-col items-start gap-3 rounded-xl border border-dashed p-10">
          <h2 className="text-lg font-semibold">No prospects match</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Nothing matches this search or filter. Try different terms, or clear the filters.
          </p>
          <Button asChild variant="outline">
            <Link href="/prospects">Clear filters</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <caption className="sr-only">Prospects</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th scope="col" className="px-4 py-3 font-medium">Prospect</th>
                <th scope="col" className="px-4 py-3 font-medium">Stage</th>
                <th scope="col" className="px-4 py-3 font-medium">Opportunity Fit</th>
                <th scope="col" className="px-4 py-3 font-medium">Next action</th>
                <th scope="col" className="px-4 py-3 font-medium">Last contact</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((prospect) => (
                <tr key={prospect.id} className="border-b last:border-b-0 hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <Link
                      href={`/prospects/${prospect.id}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {prospectDisplayName(prospect)}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {[prospect.company, prospect.email].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary">{humanizeStage(prospect.stage)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {prospect.opportunity_fit_score !== null ? (
                      <span className="tabular-nums">
                        {prospect.opportunity_fit_score}
                        <span className="ml-1 text-muted-foreground">
                          {humanizeStage(prospect.opportunity_fit_label)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Insufficient data</span>
                    )}
                  </td>
                  <td className="max-w-[240px] px-4 py-3">
                    {prospect.next_action ? (
                      <>
                        <p className="truncate" title={prospect.next_action}>
                          {prospect.next_action}
                        </p>
                        {prospect.next_action_due_date ? (
                          <p className="text-xs text-muted-foreground">
                            due {formatDate(prospect.next_action_due_date)}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(prospect.last_contact_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
