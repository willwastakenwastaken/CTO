"use client";

// Start AI-Assisted Call — the Command Center's primary action. Calls the
// ownership-checked server action once (double-clicks are guarded by the
// pending flag), then routes to the prepared call's live workspace.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneCall } from "lucide-react";

import { startAiAssistedCallAction } from "@/app/(protected)/prospects/actions";
import type { ActionError } from "@/app/(protected)/prospects/actions";
import { Button } from "@/components/ui/button";

export function StartCallButton({ prospectId }: { prospectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  async function start() {
    if (pending) return; // double-click / double-submit guard
    setPending(true);
    setError(null);
    const result = await startAiAssistedCallAction(prospectId);
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    router.push(`/calls/${result.data.callId}/live`);
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="button" onClick={() => void start()} disabled={pending}>
        <PhoneCall aria-hidden="true" className="mr-2 h-4 w-4" />
        {pending ? "Preparing call…" : "Start AI-Assisted Call"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error.message}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Starts a clearly labeled simulated practice call linked to this prospect.
        </p>
      )}
    </div>
  );
}
