"use client";

// Inline next-action editor on the Command Center. Touches ONLY next_action
// and next_action_due_date via its own server action — nothing else on the
// prospect is overwritten. Blank = no next action (unknown), not deleted data.
import { useState } from "react";
import { useRouter } from "next/navigation";

import { updateNextActionAction } from "@/app/(protected)/prospects/actions";
import type { ActionError } from "@/app/(protected)/prospects/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function NextActionEditor({
  prospectId,
  nextAction,
  nextActionDueDate,
}: {
  prospectId: string;
  nextAction: string | null;
  nextActionDueDate: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState(nextAction ?? "");
  const [dueDate, setDueDate] = useState(nextActionDueDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await updateNextActionAction(prospectId, {
      next_action: action,
      next_action_due_date: dueDate,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    setSaved(true);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-1.5">
        {nextAction ? (
          <p className="text-sm">
            {nextAction}
            {nextActionDueDate ? (
              <span className="ml-2 text-muted-foreground">due {nextActionDueDate}</span>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No next action set.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(true); setSaved(false); }}>
            {nextAction ? "Edit next action" : "Set next action"}
          </Button>
          {saved ? (
            <span role="status" className="text-sm text-emerald-600 dark:text-emerald-500">
              Saved.
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <Textarea
        rows={2}
        value={action}
        onChange={(e) => setAction(e.target.value)}
        placeholder="e.g. Send the pricing overview and book a demo."
        aria-label="Next action"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-44"
          aria-label="Next action due date"
        />
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setError(null); }}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
