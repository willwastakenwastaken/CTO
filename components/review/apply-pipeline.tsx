"use client";
// Apply the review's pipeline recommendation — deliberately gated:
//   1. A confirmation dialog shows the target stage first (spec: NEVER
//      silently move the pipeline).
//   2. The server recomputes the stale-stage recheck on every apply; when
//      the prospect moved since the call, a second, explicit warning dialog
//      is required before applying anyway.
//   3. Applying twice is a no-op (server-side idempotent).
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { applyReviewAction } from "@/app/calls/[callId]/review/actions";
import type { ActionError } from "@/app/calls/[callId]/review/actions";

function humanizeStage(stage: string | null | undefined): string {
  if (!stage) return "—";
  return stage
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function ApplyPipelineRecommendation({
  callId,
  prospectId,
  prospectLabel,
  prospectHref,
  fromStage,
  toStage,
  reason,
  alreadyApplied,
}: {
  callId: string;
  /** Null when the call isn't linked to a prospect (Apply disabled). */
  prospectId: string | null;
  prospectLabel: string;
  prospectHref: string;
  /** Pre-call stage captured when the review was generated; null when unset. */
  fromStage: string | null;
  toStage: string;
  reason: string;
  /** Server-side check: the prospect is already at the recommended stage. */
  alreadyApplied: boolean;
}) {
  const [dialog, setDialog] = useState<null | "confirm" | "stale">(null);
  const [stale, setStale] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  const doApply = async (confirmed: boolean) => {
    setBusy(true);
    setError(null);
    const result = await applyReviewAction(callId, confirmed);
    setBusy(false);
    if (!result.ok) {
      if (result.error.category === "STALE_STAGE") {
        setStale(result.error);
        setDialog("stale");
        return;
      }
      setDialog(null);
      setError(result.error);
      return;
    }
    setDialog(null);
    setStale(null);
    setApplied(true);
  };

  // No linked prospect — nothing to move.
  if (!prospectId || !fromStage) {
    return (
      <p className="text-sm text-muted-foreground">
        This practice call isn&apos;t linked to a prospect, so there&apos;s no pipeline record
        to update. Start practice calls from a prospect&apos;s Command Center to get the Apply action.
      </p>
    );
  }

  // Already applied (either this session or an earlier one) — no-op.
  if (alreadyApplied || applied) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300">
          Applied
        </Badge>
        <span className="text-sm text-muted-foreground">
          {prospectLabel} is now <span className="font-medium text-foreground">{humanizeStage(toStage)}</span>.
        </span>
        <Button asChild size="sm" variant="outline">
          <Link href={prospectHref}>View prospect</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => {
            setError(null);
            setDialog("confirm");
          }}
        >
          Apply to pipeline
        </Button>
        <span className="text-sm text-muted-foreground">
          Move {prospectLabel} from <span className="font-medium text-foreground">{humanizeStage(fromStage)}</span> to{" "}
          <span className="font-medium text-foreground">{humanizeStage(toStage)}</span>
        </span>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      )}

      {/* Step 1: confirmation with the target stage. */}
      <Dialog open={dialog === "confirm"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply {humanizeStage(fromStage)} → {humanizeStage(toStage)}?</DialogTitle>
            <DialogDescription>
              {reason} This updates {prospectLabel}&apos;s pipeline stage and records a
              stage-change activity. SignalDesk never moves the pipeline without your confirmation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void doApply(false)}>
              {busy ? "Applying pipeline update…" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 2 (only when the stage changed since the call): explicit warning. */}
      <Dialog open={dialog === "stale"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stage changed since this call</DialogTitle>
            <DialogDescription>
              {prospectLabel} was {humanizeStage(stale?.expectedStage ?? fromStage)} when this call happened, but is now{" "}
              {humanizeStage(stale?.currentStage ?? fromStage)}. Apply the recommendation ({humanizeStage(toStage)}) anyway?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void doApply(true)}>
              {busy ? "Applying pipeline update…" : "Apply anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
