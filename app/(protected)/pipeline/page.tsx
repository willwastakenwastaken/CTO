import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseProspectStore } from "@/lib/prospects/store";
import { getCurrentUserId } from "@/lib/auth/session";
import { loginRedirectUrl } from "@/lib/auth/guards";
import { groupProspectsByStage } from "@/lib/pipeline/board";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { Button } from "@/components/ui/button";

export default async function PipelinePage() {
  const supabase = await createServerSupabaseClient();
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    redirect(loginRedirectUrl("/pipeline"));
  }
  const store = createSupabaseProspectStore(supabase);
  const prospects = await store.listProspects(userId, {
    ilike: [],
    eq: [],
    order: { column: "created_at", ascending: false },
  });
  const columns = groupProspectsByStage(prospects);
  const total = prospects.length;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your prospects grouped by stage. Moves follow the same pipeline
            rules as the Command Center — terminal stages ask for confirmation.
          </p>
        </div>
        <Button asChild>
          <Link href="/prospects/new">Add prospect</Link>
        </Button>
      </div>

      {total === 0 ? (
        <div className="mt-12 flex flex-col items-start gap-3 rounded-xl border border-dashed p-10">
          <h2 className="text-lg font-semibold">No prospects yet — add one</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Create your first prospect and it will appear here in the{" "}
            <span className="font-medium">New</span> column. From there you can
            move it along the pipeline by selector, keyboard, or drag-and-drop.
          </p>
          <Button asChild>
            <Link href="/prospects/new">Add your first prospect</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-8">
          <PipelineBoard initialColumns={columns} />
        </div>
      )}
    </div>
  );
}
