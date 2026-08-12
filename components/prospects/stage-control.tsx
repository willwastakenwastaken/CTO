"use client";

// Command Center pipeline stage control. Moves the prospect one allowed step
// via the stage-change server action, which rechecks the CURRENT stage
// against the client's expectation (stale multi-tab guard) and requires
// explicit confirmation for terminal stages (closed_won / closed_lost).
// The server logs a stage_changed activity with from/to metadata.
import { useState } from "react";
import { useRouter } from "next/navigation";

import { changeStageAction } from "@/app/(protected)/prospects/actions";
import type { ActionError } from "@/app/(protected)/prospects/actions";
import type { PipelineStage } from "@/domain/pipeline/types";
import { humanizeStage } from "@/domain/utils/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function StageControl({
  prospectId,
  currentStage,
  allowedNext,
}: {
  prospectId: string;
  currentStage: PipelineStage;
  /** Allowed next stages from the pipeline rules (empty = terminal locked). */
  allowedNext: readonly PipelineStage[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<PipelineStage | "">("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  async function doChange(confirmed: boolean) {
    if (!target) return;
    setBusy(true);
    setError(null);
    const result = await changeStageAction(prospectId, {
      targetStage: target,
      expectedStage: currentStage,
      confirmed,
    });
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTarget("");
    router.refresh();
  }

  const terminal = allowedNext.length === 0;

  if (terminal) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">{humanizeStage(currentStage)}</Badge>
        <span className="text-sm text-muted-foreground">
          Terminal stage — this prospect&apos;s pipeline record is closed and can&apos;t move.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">{humanizeStage(currentStage)}</Badge>
        <Select
          value={target}
          onValueChange={(value) => {
            setTarget(value as PipelineStage);
            setError(null);
          }}
        >
          <SelectTrigger className="w-52" aria-label="Move to stage">
            <SelectValue placeholder="Move to…" />
          </SelectTrigger>
          <SelectContent>
            {allowedNext.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {humanizeStage(stage)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          disabled={!target || busy}
          onClick={() => {
            if (!target) return;
            if (target === "closed_won" || target === "closed_lost") {
              setConfirming(true);
            } else {
              void doChange(false);
            }
          }}
        >
          {busy ? "Moving…" : "Change stage"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}

      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to {humanizeStage(target)}?</DialogTitle>
            <DialogDescription>
              {target === "closed_won"
                ? "Closed-won means this deal was won. This stage is terminal — the record won't move again."
                : "Closed-lost means this opportunity was lost. This stage is terminal — the record won't move again."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={target === "closed_lost" ? "destructive" : "default"}
              onClick={() => void doChange(true)}
              disabled={busy}
            >
              {busy ? "Moving…" : `Move to ${humanizeStage(target)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
