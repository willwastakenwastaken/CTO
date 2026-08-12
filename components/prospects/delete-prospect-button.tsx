"use client";

// Delete prospect — deliberate, confirmed, then routed back to the list.
// Notes cascade with the prospect; activity timeline rows survive (their
// prospect reference is nulled by the FK). Delete is a server action with an
// ownership check; a not-owned / missing prospect is a NOT_FOUND no-op.
import { useState } from "react";
import { useRouter } from "next/navigation";

import { deleteProspectAction } from "@/app/(protected)/prospects/actions";
import type { ActionError } from "@/app/(protected)/prospects/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DeleteProspectButton({
  prospectId,
  prospectLabel,
}: {
  prospectId: string;
  prospectLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await deleteProspectAction(prospectId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.push("/prospects");
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && !busy && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {prospectLabel}?</DialogTitle>
            <DialogDescription>
              This removes the prospect and its notes. Activity history and past
              practice calls are kept (they just lose the prospect link). This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
              {busy ? "Deleting…" : "Delete prospect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
