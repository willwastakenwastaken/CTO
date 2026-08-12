"use client";

// Pipeline board — kanban columns of stored prospects grouped by stage.
//
// Every stage move flows through the SAME service path as the Command Center:
// moveCard (lib/pipeline/board.ts) validates against the pipeline rules, moves
// the card optimistically, then calls moveStageAction (-> service.changeStage),
// which rechecks the client's expectedStage against the server's current stage
// (stale multi-tab guard) and requires explicit confirmation for terminal
// stages. On ANY failure the card is rolled back to its original column and
// the honest error is surfaced. Moves are equally reachable by keyboard:
// cards are focusable, ArrowLeft/ArrowRight move to the previous/next legal
// stage, and every card has an accessible stage selector — drag-and-drop is an
// enhancement, never the only way to move a card.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import {
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/domain/pipeline/types";
import {
  isTerminalStage,
} from "@/domain/pipeline/rules";
import { humanizeStage } from "@/domain/utils/format";
import { prospectDisplayName } from "@/lib/prospects/query";
import {
  findCardStage,
  isLegalTarget,
  moveCard,
  nextReachableStage,
  reachableTargets,
  type MoveError,
  type PipelineColumns,
} from "@/lib/pipeline/board";
import type { ProspectRow } from "@/lib/prospects/types";
import { moveStageAction } from "@/app/(protected)/pipeline/actions";
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

function formatDueDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Opportunity Fit badge — shown only when a label is stored. */
function FitLabel({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <Badge variant="outline" className="shrink-0">
      Fit: {humanizeStage(label)}
    </Badge>
  );
}

export function PipelineBoard({
  initialColumns,
}: {
  initialColumns: PipelineColumns;
}) {
  const [columns, setColumns] = useState<PipelineColumns>(initialColumns);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<MoveError | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    prospectId: string;
    targetStage: PipelineStage;
  } | null>(null);
  const [drag, setDrag] = useState<{
    prospectId: string;
    fromStage: PipelineStage;
  } | null>(null);
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(
    null
  );
  // After a move, the card re-renders in another column (React re-parents the
  // DOM node), so focus is restored explicitly: { kind: "card" | "select", id }.
  // Every move requests a FRESH object, so the effect re-runs on each move even
  // when the same card is moved twice in a row — no setState inside the effect
  // body, and no reset-then-set race.
  const [focusTarget, setFocusTarget] = useState<{
    kind: "card" | "select";
    id: string;
  } | null>(null);

  useEffect(() => {
    if (!focusTarget) return;
    document
      .getElementById(
        focusTarget.kind === "select"
          ? `stage-select-${focusTarget.id}`
          : `pipeline-card-${focusTarget.id}`
      )
      ?.focus();
  }, [focusTarget]);

  /** The one move path: optimistic -> service -> rollback on failure. */
  async function performMove(
    prospectId: string,
    targetStage: PipelineStage,
    confirmed: boolean
  ): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setPendingConfirm(null);
    setFocusTarget({ kind: "card", id: prospectId });

    const result = await moveCard(
      columns,
      prospectId,
      targetStage,
      confirmed,
      async (id, input) => {
        const response = await moveStageAction(id, input);
        return response.ok
          ? { ok: true as const, data: response.data }
          : { ok: false as const, error: response.error };
      }
    );

    busyRef.current = false;
    setBusy(false);
    setColumns(result.columns);
    if (!result.ok) setError(result.error);
  }

  function requestMove(
    prospectId: string,
    targetStage: PipelineStage
  ): void {
    const from = findCardStage(columns, prospectId);
    if (!from || from === targetStage) return;
    // Terminal targets always go through the explicit confirmation dialog.
    if (isTerminalStage(targetStage)) {
      setPendingConfirm({ prospectId, targetStage });
      return;
    }
    void performMove(prospectId, targetStage, false);
  }

  function handleCardKeyDown(
    event: React.KeyboardEvent<HTMLLIElement>,
    prospectId: string,
    stage: PipelineStage
  ): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const target = nextReachableStage(stage, event.key === "ArrowLeft" ? "prev" : "next");
    if (target) requestMove(prospectId, target);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Honest error surface — rollback already happened; explain + recover. */}
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <p className="font-medium">Couldn&apos;t move that card</p>
          <p className="mt-0.5 text-destructive/90">
            {error.message} The card was returned to its original stage — refresh
            if anything looks off.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-9">
        {PIPELINE_STAGES.map((stage) => {
          const cards = columns[stage];
          const highlight = drag
            ? isLegalTarget(drag.fromStage, stage) &&
              dragOverStage === stage &&
              drag.fromStage !== stage
            : false;
          return (
            <section
              key={stage}
              aria-label={`${humanizeStage(stage)} stage`}
              onDragOver={(event) => {
                if (!drag) return;
                if (isLegalTarget(drag.fromStage, stage) && drag.fromStage !== stage) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverStage(stage);
                } else {
                  setDragOverStage((current) => (current === stage ? null : current));
                }
              }}
              onDragLeave={() =>
                setDragOverStage((current) => (current === stage ? null : current))
              }
              onDrop={(event) => {
                event.preventDefault();
                setDragOverStage(null);
                if (!drag || drag.fromStage === stage) return;
                if (!isLegalTarget(drag.fromStage, stage)) return;
                requestMove(drag.prospectId, stage);
              }}
              className={`flex min-h-[160px] flex-col rounded-xl border bg-muted/20 transition-colors ${
                highlight ? "border-primary ring-1 ring-primary" : ""
              }`}
            >
              <h2 className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <span className="text-sm font-medium">{humanizeStage(stage)}</span>
                <span className="rounded-full border bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {cards.length}
                </span>
              </h2>
              {cards.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No prospects in this stage.
                </p>
              ) : (
                <ul className="flex flex-col gap-2 p-2">
                  {cards.map((prospect) => (
                    <PipelineCard
                      key={prospect.id}
                      prospect={prospect}
                      stage={stage}
                      busy={busy}
                      onMove={requestMove}
                      onKeyDown={handleCardKeyDown}
                      onDragStart={(prospectId) => {
                        setDrag({ prospectId, fromStage: stage });
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setDragOverStage(null);
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Drag a card to another column, use the Move selector, or focus a card
        and press the arrow keys. Moves are saved through the same pipeline
        rules as the Command Center — terminal stages ask for confirmation.
      </p>

      {/* Terminal-stage confirmation (closed_won / closed_lost). */}
      <Dialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Move to {pendingConfirm ? humanizeStage(pendingConfirm.targetStage) : ""}?
            </DialogTitle>
            <DialogDescription>
              {pendingConfirm?.targetStage === "closed_won"
                ? "Closed-won means this deal was won. This stage is terminal — the record won't move again."
                : "Closed-lost means this opportunity was lost. This stage is terminal — the record won't move again."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingConfirm(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant={pendingConfirm?.targetStage === "closed_lost" ? "destructive" : "default"}
              disabled={busy}
              onClick={() => {
                if (!pendingConfirm) return;
                void performMove(pendingConfirm.prospectId, pendingConfirm.targetStage, true);
              }}
            >
              {busy ? "Moving…" : "Move to terminal stage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PipelineCard({
  prospect,
  stage,
  busy,
  onMove,
  onKeyDown,
  onDragStart,
  onDragEnd,
}: {
  prospect: ProspectRow;
  stage: PipelineStage;
  busy: boolean;
  onMove: (prospectId: string, targetStage: PipelineStage) => void;
  onKeyDown: (
    event: React.KeyboardEvent<HTMLLIElement>,
    prospectId: string,
    stage: PipelineStage
  ) => void;
  onDragStart: (prospectId: string) => void;
  onDragEnd: () => void;
}) {
  const name = prospectDisplayName(prospect);
  const reachable = reachableTargets(stage);
  const terminal = reachable.length === 0;
  const due = formatDueDate(prospect.next_action_due_date);

  return (
    <li
      id={`pipeline-card-${prospect.id}`}
      className="group flex flex-col gap-2 rounded-lg border bg-background p-3 shadow-sm transition-shadow hover:shadow"
      role="group"
      aria-label={`${name} — ${humanizeStage(stage)} stage`}
      tabIndex={0}
      aria-keyshortcuts="ArrowLeft ArrowRight"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", prospect.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(prospect.id);
      }}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => onKeyDown(event, prospect.id, stage)}
    >
      <div className="flex flex-col gap-1">
        <Link
          href={`/prospects/${prospect.id}`}
          className="font-medium leading-snug underline-offset-4 hover:underline"
        >
          {name}
        </Link>
        {prospect.company ? (
          <p className="truncate text-xs text-muted-foreground" title={prospect.company}>
            {prospect.company}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <FitLabel label={prospect.opportunity_fit_label} />
          {terminal ? (
            <Badge variant="secondary">Terminal</Badge>
          ) : null}
        </div>
      </div>

      {prospect.next_action ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">Next:</span>{" "}
          {prospect.next_action}
          {due ? <span className="block text-xs">Due {due}</span> : null}
        </p>
      ) : null}

      {!terminal ? (
        <StageMoveSelect
          prospect={prospect}
          stage={stage}
          reachable={reachable}
          busy={busy}
          onMove={onMove}
        />
      ) : null}
    </li>
  );
}

/** Per-card accessible stage selector — the spec's keyboard-first move path. */
function StageMoveSelect({
  prospect,
  stage,
  reachable,
  busy,
  onMove,
}: {
  prospect: ProspectRow;
  stage: PipelineStage;
  reachable: readonly PipelineStage[];
  busy: boolean;
  onMove: (prospectId: string, targetStage: PipelineStage) => void;
}) {
  const [target, setTarget] = useState<PipelineStage | "">("");
  const selectId = `stage-select-${prospect.id}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label htmlFor={selectId} className="sr-only">
        Move {prospectDisplayName(prospect)} to stage
      </label>
      <select
        id={selectId}
        value={target}
        disabled={busy}
        onChange={(event) => setTarget(event.target.value as PipelineStage | "")}
        className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
      >
        <option value="">Move to…</option>
        {reachable.map((reachableStage) => (
          <option key={reachableStage} value={reachableStage}>
            {humanizeStage(reachableStage)}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 px-2 text-xs"
        disabled={!target || busy || target === stage}
        onClick={() => {
          if (target) {
            onMove(prospect.id, target);
            setTarget("");
          }
        }}
      >
        Move
      </Button>
    </div>
  );
}
