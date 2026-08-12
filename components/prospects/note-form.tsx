"use client";

// Add-general-note form on the Command Center. Inserts one note and one
// note_added activity (server side); the page refreshes to show both.
import { useState } from "react";
import { useRouter } from "next/navigation";

import { addNoteAction } from "@/app/(protected)/prospects/actions";
import type { ActionError } from "@/app/(protected)/prospects/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function NoteForm({ prospectId }: { prospectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await addNoteAction(prospectId, { title, body });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTitle("");
    setBody("");
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Note title (required)"
        aria-label="Note title"
        maxLength={200}
      />
      <Textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What do you want to remember about this prospect?"
        aria-label="Note body"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={busy || title.trim().length === 0}
        >
          {busy ? "Adding…" : "Add note"}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
