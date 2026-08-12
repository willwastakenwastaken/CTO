"use client";

// Secondary transcript — REP / PROSPECT / system turns, appended without
// re-rendering earlier turns. New segments are added to local state once, so
// the rest of the workspace (hero, controls) can re-render without touching
// the transcript DOM.
import { useEffect, useRef, useState } from "react";
import type { WorkspaceSegment } from "@/lib/calls/workspace";
import { cn } from "@/lib/utils";

const SPEAKER_LABEL: Record<WorkspaceSegment["speaker"], string> = {
  rep: "Rep",
  prospect: "Prospect",
  system: "SignalDesk",
};

export function Transcript({ segments }: { segments: readonly WorkspaceSegment[] }) {
  const [items, setItems] = useState<WorkspaceSegment[]>([]);
  const renderedCountRef = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  // Append-only: track how many segments we have already rendered; only the
  // newly arrived slice is appended to state (keyed by segment id).
  useEffect(() => {
    const count = segments.length;
    if (count > renderedCountRef.current) {
      const added = segments.slice(renderedCountRef.current);
      renderedCountRef.current = count;
      setItems((prev) => [...prev, ...added]);
    } else {
      // Refresh/authoritative reconcile: adopt the full list once.
      renderedCountRef.current = count;
      setItems([...segments]);
    }
  }, [segments]);

  // Auto-scroll only when the reader is already near the bottom; never yank
  // the viewport away while they are reading earlier turns.
  useEffect(() => {
    if (!nearBottomRef.current || items.length === 0) return;
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [items.length]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distance < 120;
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No turns yet — the conversation appears here as it happens.
      </p>
    );
  }

  return (
    <div
      className="max-h-80 space-y-3 overflow-y-auto pr-2"
      onScroll={handleScroll}
      aria-label="Call transcript"
    >
      {items.map((segment) => (
        <div
          key={segment.id}
          className={cn(
            "flex flex-col gap-0.5 text-sm",
            segment.speaker === "rep" && "items-end",
            segment.speaker === "system" && "items-center"
          )}
        >
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
              segment.speaker === "rep" && "text-primary/70",
              segment.speaker === "system" && "italic"
            )}
          >
            {SPEAKER_LABEL[segment.speaker]}
          </span>
          <span
            className={cn(
              "max-w-[85%] rounded-lg border px-3 py-2 leading-relaxed",
              segment.speaker === "rep" && "border-primary/15 bg-muted/60",
              segment.speaker === "prospect" && "border-border bg-card",
              segment.speaker === "system" && "border-transparent text-muted-foreground italic"
            )}
          >
            {segment.text}
          </span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
