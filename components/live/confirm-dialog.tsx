"use client";

// Confirm dialogs for the deliberate live-screen actions: End Session (ends
// the call and generates the review) and Restart (mints a NEW call id — the
// engine requires it; the old call's history is preserved). Both ask first:
// nothing on the live screen happens implicitly.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type ConfirmKind = "end" | "restart" | null;

export function ConfirmDialog({
  kind,
  busy,
  onConfirm,
  onCancel,
}: {
  kind: ConfirmKind;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open = kind !== null;
  const isEnd = kind === "end";
  return (
    <Dialog open={open} onOpenChange={(openChange) => !openChange && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEnd ? "End this session?" : "Restart the practice call?"}</DialogTitle>
          <DialogDescription>
            {isEnd
              ? "Ending generates the evidence-based call review and completes the call. Your transcript and signals are kept."
              : "Restarting begins a brand-new call with a fresh call id. The current call’s history is kept as-is, but it stops here."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={isEnd ? "destructive" : "default"} onClick={onConfirm} disabled={busy}>
            {busy
              ? isEnd
                ? "Generating call review…"
                : "Restarting…"
              : isEnd
                ? "End session"
                : "Restart with a new call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
