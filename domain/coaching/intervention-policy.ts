// Intervention policy: given a new event, the conversation state, the recent
// transcript, the active/previous suggestions, the call objective and the
// sales-profile guardrails, decide the ONE next suggestion — or nothing.
//
// Design decisions (explicit constants):
//  * PREFERENCE ORDER (spec): timely prospect questions > high-priority
//    objections > LISTEN while useful detail is shared > buying signals >
//    missed discovery > other signals. Encoded as EVENT_PRIORITY in
//    domain/events/taxonomy.ts and as the builder order below.
//  * COOLDOWN_MS = 30s between suggestions (calm UI — not every turn). A
//    timely prospect QUESTION bypasses the cooldown (top priority).
//  * SUGGESTION_TTL_MS = 90s: an expired suggestion no longer counts as
//    "active"; history is never deleted.
//  * One active suggestion at a time: while one is active, a new suggestion
//    is only emitted when it has STRICTLY higher priority (it supersedes —
//    the old row stays in history with its times).
//  * Near-duplicate suppression via token Jaccard >= 0.7 against the last 5
//    suggestions (same action + overlapping wording => suppressed).
//  * Guardrails: a candidate that matches a guardrail keyword (e.g. "discount"
//    in the guardrails AND in the candidate text) is never emitted. Price
//    handling NEVER suggests a discount — it always asks a value question.
import {
  type SuggestionAction,
  type SuggestionDraft,
  type SuggestionInput,
} from "@/domain/coaching/types";
import type { CallEvent, EventType } from "@/domain/events/types";
import { EVENT_PRIORITY } from "@/domain/events/taxonomy";
import type { ConversationState } from "@/domain/conversation-state/types";
import type { TranscriptSegment } from "@/domain/transcript/types";

/** Milliseconds of quiet after a suggestion before another may appear. */
export const COOLDOWN_MS = 30_000;
/** Milliseconds until an un-actioned suggestion is treated as expired. */
export const SUGGESTION_TTL_MS = 90_000;
/** Token-Jaccard similarity at/above which a candidate is a near-duplicate. */
export const NEAR_DUPLICATE_JACCARD_THRESHOLD = 0.7;
/** Only the last N previous suggestions are considered for deduplication. */
export const RECENT_SUGGESTIONS_WINDOW = 5;

const GUARDRAIL_KEYWORDS = [
  "discount",
  "discounts",
  "roi",
  "guarantee",
  "guaranteed",
  "warranty",
  "legal",
  "price cut",
  "percent off",
  "free",
  "implementation commitment",
] as const;

export type InterventionMode = "suggestion" | "listening";

export interface InterventionInput {
  /** The new event that triggers evaluation. */
  event: CallEvent;
  state: ConversationState;
  /** Last few transcript segments (oldest first). */
  recentTranscript: readonly TranscriptSegment[];
  /** The currently displayed suggestion, if any. */
  currentSuggestion: SuggestionInput | null;
  /** All previously created suggestions (history kept). */
  previousSuggestions: readonly SuggestionInput[];
  /** Call objective from the sales profile / call strategy (may be blank). */
  callObjective?: string | null;
  /** Sales-profile guardrails (e.g. "no unauthorized discounts"). */
  guardrails?: readonly string[];
  /** Current time in ms for cooldown/expiry decisions. */
  nowMs: number;
}

export interface InterventionDecision {
  mode: InterventionMode;
  suggestion: SuggestionDraft | null;
  /** Human-readable reason for the decision (listening or chosen). */
  reason: string;
  /** Event UUID the decision responds to (null when listening). */
  matchedEventId: string | null;
}

/** True when a suggestion is still live (not dismissed/used/expired). */
export function isSuggestionActive(
  suggestion: SuggestionInput,
  nowMs: number
): boolean {
  if (suggestion.dismissedAtMs != null || suggestion.usedAtMs != null) {
    return false;
  }
  if (
    suggestion.expiresAtMs != null &&
    suggestion.expiresAtMs <= nowMs
  ) {
    return false;
  }
  return true;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0)
  );
}

/** Token-Jaccard similarity between two strings. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection += 1;
  }
  const union = ta.size + tb.size - intersection;
  return intersection / union;
}

/** True when the candidate repeats a recent previous suggestion's advice. */
export function isNearDuplicate(
  candidate: SuggestionDraft,
  previous: readonly SuggestionInput[]
): boolean {
  const recent = previous.slice(-RECENT_SUGGESTIONS_WINDOW);
  return recent.some((prev) => {
    if (prev.action !== candidate.action) return false;
    const candidateText = `${candidate.text} ${candidate.reason ?? ""}`;
    const prevText = `${prev.text} ${prev.reason ?? ""}`;
    return tokenSimilarity(candidateText, prevText) >= NEAR_DUPLICATE_JACCARD_THRESHOLD;
  });
}

/**
 * True when the candidate violates a sales-profile guardrail: a guardrail
 * string mentions a forbidden keyword AND the candidate wording uses the same
 * keyword. (E.g. guardrail "no unauthorized discounts" + a candidate that
 * offers a discount.)
 */
export function violatesGuardrails(
  candidate: SuggestionDraft,
  guardrails: readonly string[]
): boolean {
  const hay = `${candidate.action} ${candidate.text} ${candidate.reason ?? ""}`.toLowerCase();
  return guardrails.some((g) => {
    const gl = g.toLowerCase();
    return GUARDRAIL_KEYWORDS.some(
      (kw) => gl.includes(kw) && hay.includes(kw)
    );
  });
}

/** True when the prospect is still elaborating (LISTEN condition). */
function isUsefulDetailBeingShared(
  event: CallEvent,
  recentTranscript: readonly TranscriptSegment[]
): boolean {
  if (event.speaker !== "prospect") return false;
  const last = recentTranscript[recentTranscript.length - 1];
  if (!last) return false;
  return last.speaker === "prospect" && last.relativeTimeMs >= event.relativeTimeMs;
}

function isPriceConcern(event: CallEvent): boolean {
  return (
    event.type === "PRICE_DISCUSSION" ||
    (event.type === "OBJECTION" && event.metadata?.objectionType === "price")
  );
}

/** Builds the candidate suggestion for one event (no cooldown/dedup/active
 * checks — those live in evaluateIntervention). Returns null for no-op. */
export function buildCandidate(
  event: CallEvent,
  ctx: Pick<
    InterventionInput,
    "state" | "recentTranscript" | "callObjective"
  >
): SuggestionDraft | null {
  const priority = EVENT_PRIORITY[event.type];
  const eventId = event.id;
  const ttl = SUGGESTION_TTL_MS;

  const draft = (
    action: SuggestionAction,
    text: string,
    reason: string
  ): SuggestionDraft => ({
    action,
    text,
    reason,
    priority,
    eventId,
    expiresAtMs: ttl,
  });

  switch (event.type) {
    case "QUESTION": {
      // Timely prospect question — answer first. A rep question needs no
      // intervention (the rep is driving).
      if (event.speaker !== "prospect") return null;
      return draft(
        "SAY",
        "Answer their question concisely, then bridge back to the value discussion.",
        "Timely prospect question — answer it before continuing."
      );
    }
    case "OBJECTION":
    case "PRICE_DISCUSSION": {
      if (isPriceConcern(event)) {
        // Guardrail-aware by construction: never a discount — always a value
        // question (ABC Roofing $500 price concern -> ASK NEXT).
        return draft(
          "ASK",
          "Ask how they value speed — quantify value before discussing price.",
          "Quantify value before defending price."
        );
      }
      return draft(
        "CLARIFY",
        "Clarify the concern before responding — ask what is really behind it.",
        "High-priority objection — understand it fully before addressing it."
      );
    }
    case "PAIN_DISCOVERED": {
      // Rep statements cannot confirm prospect facts — a rep paraphrase of the
      // pain is nothing to act on.
      if (event.speaker !== "prospect") return null;
      if (isUsefulDetailBeingShared(event, ctx.recentTranscript)) {
        return draft(
          "LISTEN",
          "Keep listening — let them finish explaining the pain.",
          "Useful detail is being shared — stay quiet and capture it."
        );
      }
      return draft(
        "ASK",
        "Explore the impact of the pain before proposing a solution.",
        "Quantify impact before moving to solution."
      );
    }
    case "BUYING_SIGNAL": {
      return draft(
        "DO_NOT_PUSH",
        "Acknowledge the signal and confirm the next step without pushing.",
        "Buying signal — confirm interest, do not oversell."
      );
    }
    case "TIMELINE_SIGNAL": {
      return draft(
        "ASK",
        "Confirm the timeline and what needs to happen by then.",
        "Timeline signal — pin down the deadline and its drivers."
      );
    }
    case "MISSED_DISCOVERY": {
      const dimension =
        typeof event.metadata?.dimension === "string"
          ? event.metadata.dimension
          : "the missed topic";
      return draft(
        "ASK",
        `Ask a discovery question about ${dimension} before moving on.`,
        "Missed discovery — close the gap while it is cheap."
      );
    }
    case "AUTHORITY_SIGNAL": {
      return draft(
        "SAY",
        "Confirm they are the decision-maker and who else is involved.",
        "Authority signal — verify the decision process."
      );
    }
    case "COMPETITOR_MENTION": {
      return draft(
        "ASK",
        "Ask what they like and dislike about the current solution.",
        "Competitor mention — understand the incumbent before positioning."
      );
    }
    default:
      return null;
  }
}

/**
 * Evaluates the intervention policy for a new event. Returns a suggestion
 * draft or a calm "listening" decision (no suggestion).
 */
export function evaluateIntervention(
  input: InterventionInput
): InterventionDecision {
  const {
    event,
    currentSuggestion,
    previousSuggestions,
    guardrails,
    nowMs,
  } = input;

  const candidate = buildCandidate(event, input);
  if (candidate === null) {
    return {
      mode: "listening",
      suggestion: null,
      reason: "No intervention warranted for this event.",
      matchedEventId: null,
    };
  }

  if (violatesGuardrails(candidate, guardrails ?? [])) {
    return {
      mode: "listening",
      suggestion: null,
      reason: "Suppressed by sales-profile guardrails.",
      matchedEventId: null,
    };
  }

  const active =
    currentSuggestion !== null && isSuggestionActive(currentSuggestion, nowMs)
      ? currentSuggestion
      : null;

  // One active suggestion at a time: only a strictly higher priority may
  // supersede (the superseded row is kept in history, never deleted).
  if (active !== null) {
    if (candidate.priority > active.priority) {
      candidate.supersedesId = active.id;
    } else {
      return {
        mode: "listening",
        suggestion: null,
        reason: "An active suggestion still stands.",
        matchedEventId: null,
      };
    }
  }

  // Cooldown: stay quiet between suggestions — except a timely prospect
  // question, which always gets answered (top priority).
  const isTimelyQuestion =
    event.type === "QUESTION" && event.speaker === "prospect";
  if (!isTimelyQuestion) {
    const lastAtMs = [
      ...previousSuggestions,
      ...(currentSuggestion ? [currentSuggestion] : []),
    ].reduce((max, s) => Math.max(max, s.createdAtMs), 0);
    if (nowMs - lastAtMs < COOLDOWN_MS) {
      return {
        mode: "listening",
        suggestion: null,
        reason: "Within the suggestion cooldown — listening.",
        matchedEventId: null,
      };
    }
  }

  // Repetition suppression: near-duplicate advice is not shown again.
  if (isNearDuplicate(candidate, previousSuggestions)) {
    return {
      mode: "listening",
      suggestion: null,
      reason: "Near-duplicate of a recent suggestion — suppressed.",
      matchedEventId: null,
    };
  }

  return {
    mode: "suggestion",
    suggestion: candidate,
    reason: candidate.reason ?? "Suggested by the intervention policy.",
    matchedEventId: event.id,
  };
}

export type { EventType };
