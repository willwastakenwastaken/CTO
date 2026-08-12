"use client";

// Live Call workspace — the centerpiece of SignalDesk. Calm by construction:
// one recommendation at a time, quiet Listening otherwise, compact deal state,
// 3–5 signals, and controls that disable themselves while a turn is in flight.
//
// Server actions (app/calls/[callId]/live/actions.ts) do all the work; this
// component only renders the returned workspace and translates stable error
// categories into calm, honest language. userId never crosses this boundary.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CallHeader } from "@/components/live/call-header";
import {
  RecommendationHero,
  type FeedbackAction,
} from "@/components/live/recommendation-hero";
import { Transcript } from "@/components/live/transcript";
import { DealState } from "@/components/live/deal-state";
import { Signals } from "@/components/live/signals";
import {
  SimulationControls,
  type ControlBusy,
} from "@/components/live/simulation-controls";
import { ConfirmDialog, type ConfirmKind } from "@/components/live/confirm-dialog";
import { AUTO_PLAY_INTERVAL_MS } from "@/components/live/autoplay";
import { canAdvance, isTerminal } from "@/components/live/controls-state";
import type { LiveWorkspace } from "@/lib/calls/workspace";
import type { ActionError } from "@/app/calls/[callId]/live/actions";
import {
  advanceAction,
  cancelAction,
  endAction,
  feedbackAction,
  getWorkspaceAction,
  pauseAction,
  reconcileAction,
  restartAction,
  resumeAction,
  startAction,
} from "@/app/calls/[callId]/live/actions";

type EndedKind = "completed" | "cancelled" | "failed";
type Phase = "loading" | "ready" | "error";

/** Stable error categories -> calm, honest language (spec: explain what broke,
 * whether data is safe, how to recover). Never raw stack text. */
function calmMessage(category: string, fallback: string): string {
  switch (category) {
    case "STALE_CURSOR":
      return "This call changed in another window — showing the latest state.";
    case "NOT_LIVE":
    case "INVALID_STATE":
      return "The call isn't ready for that action yet.";
    case "ADVANCE_IN_FLIGHT":
      return "Already processing — give it a moment.";
    case "END_OF_SCENARIO":
      return "The scenario is complete — end the session to see the review.";
    case "NOT_FOUND":
      return "This call is no longer available.";
    case "PERSISTENCE_FAILED":
      return "We couldn't save that right now. Your data is safe — try again in a moment.";
    case "UNAUTHENTICATED":
      return "Your session expired — please sign in again.";
    default:
      return fallback;
  }
}

export function LiveWorkspace({ callId }: { callId: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<LiveWorkspace | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [fatalError, setFatalError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState<ControlBusy>(null);
  const [paused, setPaused] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [notice, setNotice] = useState<ActionError | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [ended, setEnded] = useState<{ kind: EndedKind } | null>(null);
  /** Bumped by "Try again" to re-run the load effect. */
  const [retryToken, setRetryToken] = useState(0);
  /** Total paused wall-clock ms (pause is a view control; the timer freezes). */
  const [pausedMs, setPausedMs] = useState(0);
  const pauseStartedAtRef = useRef<number | null>(null);

  const status = workspace?.status ?? "prepared";
  const snapshot = workspace?.snapshot ?? null;
  const endOfScenario =
    status === "live" &&
    workspace !== null &&
    snapshot !== null &&
    snapshot.revealedTurnCount >= workspace.scenarioTurnCount;

  /** Adopts an authoritative workspace; terminal calls clear it and show the
   * ended state (the snapshot is cleared on completion/cancellation). */
  const applyWorkspace = useCallback((next: LiveWorkspace) => {
    if (isTerminal(next.status)) {
      setWorkspace(null);
      const kind: EndedKind =
        next.status === "completed"
          ? "completed"
          : next.status === "failed"
            ? "failed"
            : "cancelled";
      setEnded({ kind });
      return;
    }
    setWorkspace(next);
    setPhase("ready");
  }, []);

  /** Re-fetches the authoritative workspace (used after a stale cursor). */
  const refreshWorkspace = useCallback(async (): Promise<boolean> => {
    const result = await getWorkspaceAction(callId);
    if (!result.ok) {
      setNotice(result.error);
      return false;
    }
    applyWorkspace(result.data);
    return !isTerminal(result.data.status);
  }, [callId, applyWorkspace]);

  // Load + reconcile on mount (and on refresh of the live page). All state
  // writes happen inside promise callbacks so the effect body never sets
  // state synchronously; cancellation guards against stale resolutions.
  useEffect(() => {
    let cancelled = false;
    void getWorkspaceAction(callId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPhase("error");
        setFatalError(result.error);
        return;
      }
      applyWorkspace(result.data);
      if (isTerminal(result.data.status) || result.data.snapshot === null) return;
      return reconcileAction(callId, result.data.snapshot).then((reconciled) => {
        if (cancelled || !reconciled.ok) return;
        if (reconciled.data.snapshot === null) {
          // The call went terminal between fetch and reconcile.
          setWorkspace(null);
          setEnded({ kind: "completed" });
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [callId, applyWorkspace, retryToken]);

  // -------------------------------------------------------------------------
  // Control handlers
  // -------------------------------------------------------------------------

  const doAdvance = useCallback(async () => {
    if (workspace === null || snapshot === null || busy !== null) return;
    setBusy("advance");
    setNotice(null);
    const result = await advanceAction(callId, snapshot.revealedTurnCount);
    setBusy(null);
    if (!result.ok) {
      if (result.error.category === "STALE_CURSOR") {
        setNotice({ category: result.error.category, message: calmMessage(result.error.category, result.error.message) });
        await refreshWorkspace();
      } else if (result.error.category === "END_OF_SCENARIO") {
        setAutoPlay(false);
        setNotice({ category: result.error.category, message: calmMessage(result.error.category, result.error.message) });
      } else {
        setNotice({ category: result.error.category, message: calmMessage(result.error.category, result.error.message) });
      }
      return;
    }
    applyWorkspace(result.data.workspace);
    if (result.data.repaired) {
      setNotice({
        category: "RECONCILED",
        message: "Reconciled with the saved state — your latest turn is shown.",
      });
    }
  }, [workspace, snapshot, busy, callId, applyWorkspace, refreshWorkspace]);

  const doFeedback = useCallback(
    async (action: FeedbackAction) => {
      if (workspace === null || busy !== null || workspace.activeSuggestion === null) return;
      const suggestionId = workspace.activeSuggestion.id;
      setBusy("feedback");
      setNotice(null);
      const result = await feedbackAction(callId, suggestionId, action);
      setBusy(null);
      if (!result.ok) {
        if (result.error.category === "NOT_FOUND") {
          await refreshWorkspace();
        }
        setNotice({ category: result.error.category, message: calmMessage(result.error.category, result.error.message) });
        return;
      }
      applyWorkspace(result.data);
    },
    [workspace, busy, callId, applyWorkspace, refreshWorkspace]
  );

  const doStart = useCallback(async () => {
    if (workspace === null || busy !== null) return;
    setBusy("start");
    setNotice(null);
    const result = await startAction(callId);
    setBusy(null);
    if (!result.ok) {
      setNotice({ category: result.error.category, message: calmMessage(result.error.category, result.error.message) });
      return;
    }
    setPaused(false);
    applyWorkspace(result.data);
  }, [workspace, busy, callId, applyWorkspace]);

  const togglePause = useCallback(async () => {
    if (workspace === null || busy !== null) return;
    const result = paused ? await resumeAction(callId) : await pauseAction(callId);
    if (!result.ok) {
      setNotice({ category: result.error.category, message: calmMessage(result.error.category, result.error.message) });
      return;
    }
    // Pause accumulation happens in this event handler (never in render).
    if (paused) {
      const startedAt = pauseStartedAtRef.current;
      if (startedAt !== null) {
        setPausedMs((ms) => ms + (Date.now() - startedAt));
      }
      pauseStartedAtRef.current = null;
    } else {
      pauseStartedAtRef.current = Date.now();
    }
    setPaused(!paused);
    applyWorkspace(result.data);
  }, [workspace, paused, busy, callId, applyWorkspace]);

  /** Ends a live call (generates review) or cancels a prepared one (no review
   * to generate). Both clear the snapshot; the page shows the ended state. */
  const doEnd = useCallback(async () => {
    if (workspace === null) return;
    setBusy("end");
    setNotice(null);
    const result = status === "prepared" ? await cancelAction(callId) : await endAction(callId);
    setBusy(null);
    setConfirm(null);
    if (!result.ok) {
      setNotice({ category: result.error.category, message: calmMessage(result.error.category, result.error.message) });
      return;
    }
    setWorkspace(null);
    setAutoPlay(false);
    setEnded({ kind: result.data.status === "cancelled" ? "cancelled" : "completed" });
  }, [workspace, status, callId]);

  const doRestart = useCallback(async () => {
    if (workspace === null) return;
    setBusy("restart");
    setNotice(null);
    const result = await restartAction(callId);
    setBusy(null);
    setConfirm(null);
    if (!result.ok) {
      setNotice({ category: result.error.category, message: calmMessage(result.error.category, result.error.message) });
      return;
    }
    // Engine requirement: restart mints a NEW call id; route to the fresh call.
    router.push(`/calls/${result.data.newCallId}/live`);
  }, [workspace, callId, router]);

  // -------------------------------------------------------------------------
  // Auto-play — modest 2.5s interval, driven entirely by render state. The
  // effect re-creates the interval whenever canAdvanceNow flips false (turn
  // in flight, paused, scenario complete) so it can never double-fire, and
  // stops itself at the end of the scenario. doAdvance guards again.
  // -------------------------------------------------------------------------
  const canAdvanceNow =
    canAdvance(status, paused, busy === "advance", endOfScenario) && busy === null;

  useEffect(() => {
    if (!autoPlay || !canAdvanceNow) return;
    const id = window.setInterval(() => {
      void doAdvance();
    }, AUTO_PLAY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [autoPlay, canAdvanceNow, doAdvance]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (phase === "loading") {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          Preparing call strategy…
        </p>
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-xl font-semibold tracking-tight">This call isn’t available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {calmMessage(fatalError?.category ?? "UNKNOWN", fatalError?.message ?? "Something went wrong.")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setPhase("loading");
              setRetryToken((t) => t + 1);
            }}
          >
            Try again
          </Button>
          <Button asChild variant="ghost">
            <Link href="/home">Back to Home</Link>
          </Button>
        </div>
      </main>
    );
  }

  if (ended !== null) {
    return <EndedState kind={ended.kind} callId={callId} />;
  }

  if (workspace === null) {
    return null;
  }

  const prepared = status === "prepared";
  const live = status === "live";

  return (
    <>
      <CallHeader
        prospectName={workspace.prospectName}
        prospectCompany={workspace.prospectCompany}
        startedAtMs={workspace.startedAtMs}
        timerRunning={live && !paused}
        pausedMs={pausedMs}
        busy={busy === "end"}
        onEnd={() => setConfirm("end")}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {notice && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 flex items-start justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm"
          >
            <p>{notice.message}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss message"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        )}

        {prepared ? (
          <section className="mx-auto mt-10 max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Practice call · simulated
            </p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight">Ready to start</h1>
            <p className="mt-2 text-sm text-muted-foreground">{workspace.callObjective}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button disabled={busy !== null} onClick={() => void doStart()}>
                Start call
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirm("end")}>
                End early
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirm("restart")}>
                Restart
              </Button>
            </div>
          </section>
        ) : (
          <>
            <RecommendationHero
              workspace={workspace}
              busy={busy === "feedback"}
              onFeedback={(action) => void doFeedback(action)}
            />
            <div className="mt-4">
              <SimulationControls
                status={status}
                paused={paused}
                inFlight={busy === "advance"}
                endOfScenario={endOfScenario}
                autoPlay={autoPlay && !endOfScenario}
                busy={busy}
                onStart={() => void doStart()}
                onTogglePause={() => void togglePause()}
                onAdvance={() => void doAdvance()}
                onToggleAutoPlay={() => setAutoPlay((v) => !v)}
                onEndEarly={() => setConfirm("end")}
                onRestart={() => setConfirm("restart")}
              />
            </div>
            <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <section aria-label="Transcript">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Transcript
                </h2>
                <div className="mt-2">
                  <Transcript segments={workspace.segments} />
                </div>
              </section>
              <div className="space-y-8">
                <section aria-label="Deal state">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Deal state
                  </h2>
                  <div className="mt-2 rounded-xl border bg-card p-4">
                    <DealState state={workspace.conversationState} />
                  </div>
                </section>
                <section aria-label="Signals">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Signals
                  </h2>
                  <div className="mt-2">
                    <Signals events={workspace.events} />
                  </div>
                </section>
              </div>
            </div>
          </>
        )}
      </main>
      <ConfirmDialog
        kind={confirm}
        busy={busy === "end" || busy === "restart" || busy === "cancel"}
        onConfirm={() => {
          if (confirm === "restart") void doRestart();
          else void doEnd();
        }}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

/** Terminal state — the snapshot is cleared and the page routes onward. The
 * review page itself is milestone 7; until then an honest bridge state. */
function EndedState({ kind, callId }: { kind: EndedKind; callId: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Call ended</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {kind === "completed" &&
          "The evidence-based review arrives in the next milestone. Your transcript and signals are saved."}
        {kind === "cancelled" &&
          "This practice call was cancelled. Nothing is lost — the transcript is saved."}
        {kind === "failed" &&
          "The call review couldn’t be generated. Your transcript is safe — you can retry from the Calls page."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {kind === "completed" && (
          <Button asChild>
            <Link href={`/calls/${callId}/review`}>View review page</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/home">Back to Home</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/calls/practice">Start another practice call</Link>
        </Button>
      </div>
    </main>
  );
}
