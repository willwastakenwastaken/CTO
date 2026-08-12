// Coach aggregation helpers — pure functions over STORED completed calls.
//
// Coaching insights are derived ONLY from persisted review data
// (call_sessions.review_payload): purchase intent, pipeline recommendations,
// and the evidence-backed coaching observations each review already recorded.
// Nothing here invents numbers — every insight is a count over stored rows and
// is labeled as an observation. Recurring patterns unlock only after at least
// COACH_ELIGIBLE_CALLS_THRESHOLD eligible calls (spec: never fabricate trends
// from one simulation). Kept free of Next/Supabase imports for direct testing.
import {
  PURCHASE_INTENT_LABELS,
  type PurchaseIntentLabel,
} from "@/domain/scoring/purchase-intent";
import {
  ReviewPayloadSchema,
  type ReviewPayload,
} from "@/domain/schemas/review";
import { PIPELINE_STAGES, type PipelineStage } from "@/domain/pipeline/types";
import type { CallSessionRow } from "@/lib/calls/types";

/** Spec: infer recurring patterns only after at least three eligible calls. */
export const COACH_ELIGIBLE_CALLS_THRESHOLD = 3;
/** Recent coaching moments shown on /coach (bounded, honest). */
export const COACH_RECENT_MOMENTS_LIMIT = 3;

/**
 * An eligible call is a COMPLETED call with a persisted, Zod-valid review
 * payload. Completed calls without a review never count toward coaching.
 */
export function isEligibleCompletedCall(row: CallSessionRow): boolean {
  if (row.status !== "completed") return false;
  if (row.review_payload == null) return false;
  return ReviewPayloadSchema.safeParse(row.review_payload).success;
}

/** All of a user's eligible completed calls (newest first is caller's order). */
export function selectEligibleCalls(
  sessions: readonly CallSessionRow[]
): CallSessionRow[] {
  return sessions.filter(isEligibleCompletedCall);
}

export interface CoachEligibility {
  /** Number of stored eligible completed calls. */
  eligibleCount: number;
  threshold: number;
  /** True once eligibleCount >= threshold (insights unlocked). */
  unlocked: boolean;
  /** How many more eligible calls unlock insights (0 when unlocked). */
  remaining: number;
}

export function coachEligibility(
  sessions: readonly CallSessionRow[]
): CoachEligibility {
  const eligibleCount = selectEligibleCalls(sessions).length;
  const unlocked = eligibleCount >= COACH_ELIGIBLE_CALLS_THRESHOLD;
  return {
    eligibleCount,
    threshold: COACH_ELIGIBLE_CALLS_THRESHOLD,
    unlocked,
    remaining: Math.max(0, COACH_ELIGIBLE_CALLS_THRESHOLD - eligibleCount),
  };
}

/** Zod-safe parse of a stored review payload; null when it isn't a review. */
export function parseReviewPayload(
  row: CallSessionRow
): ReviewPayload | null {
  if (row.review_payload == null) return null;
  const parsed = ReviewPayloadSchema.safeParse(row.review_payload);
  return parsed.success ? parsed.data : null;
}

/** One aggregated coaching area: count, the observation sentences, examples. */
export interface AreaInsight {
  /** Coaching area, e.g. "price handling" (stored in the review). */
  area: string;
  /** Number of eligible calls whose review recorded this area. */
  count: number;
  /** Distinct observation sentences recorded for this area (stored text). */
  observations: string[];
  /** Up to 3 verbatim evidence quotes, each with its call's review link. */
  examples: Array<{ callId: string; quote: string }>;
}

export interface RecentCoachingMoment {
  callId: string;
  createdAt: string | null;
  observations: Array<{
    kind: "strength" | "improvement";
    area: string;
    observation: string;
  }>;
}

export interface CoachingInsights {
  eligibleCount: number;
  /** Strength areas, most frequent first. */
  strengths: AreaInsight[];
  /** Improvement areas, most frequent first. */
  improvements: AreaInsight[];
  /** Purchase Intent label counts over eligible calls (canonical order). */
  purchaseIntentLabels: Array<{ label: PurchaseIntentLabel; count: number }>;
  /** Pipeline recommendation counts (canonical stage order, nonzero only). */
  pipelineRecommendations: Array<{ targetStage: PipelineStage; count: number }>;
  /** Latest eligible calls with their recorded coaching observations. */
  recentMoments: RecentCoachingMoment[];
}

const LABEL_ORDER: PurchaseIntentLabel[] = [
  PURCHASE_INTENT_LABELS.high,
  PURCHASE_INTENT_LABELS.moderate,
  PURCHASE_INTENT_LABELS.low,
  PURCHASE_INTENT_LABELS.insufficientData,
];

function aggregateAreas(
  rows: readonly CallSessionRow[]
): { strengths: AreaInsight[]; improvements: AreaInsight[] } {
  const byArea = new Map<
    string,
    {
      kind: "strength" | "improvement";
      observations: Map<string, Array<{ callId: string; quote: string }>>;
      /** Distinct calls that recorded an observation in this area. */
      calls: Set<string>;
    }
  >();
  for (const row of rows) {
    const review = parseReviewPayload(row);
    if (!review) continue;
    for (const observation of review.coaching) {
      let entry = byArea.get(observation.area);
      if (!entry) {
        entry = { kind: observation.kind, observations: new Map(), calls: new Set() };
        byArea.set(observation.area, entry);
      }
      entry.calls.add(row.id);
      if (!entry.observations.has(observation.observation)) {
        entry.observations.set(observation.observation, []);
      }
      const examples = entry.observations.get(observation.observation)!;
      const firstQuote = observation.evidence[0]?.quote;
      if (firstQuote && examples.length < 3) {
        examples.push({ callId: row.id, quote: firstQuote });
      }
    }
  }
  const strengths: AreaInsight[] = [];
  const improvements: AreaInsight[] = [];
  for (const [area, entry] of byArea) {
    const insight: AreaInsight = {
      area,
      count: entry.calls.size,
      observations: [...entry.observations.keys()],
      examples: [...entry.observations.values()].flat().slice(0, 3),
    };
    (entry.kind === "strength" ? strengths : improvements).push(insight);
  }
  const byCount = (a: AreaInsight, b: AreaInsight) =>
    b.count - a.count || a.area.localeCompare(b.area);
  strengths.sort(byCount);
  improvements.sort(byCount);
  return { strengths, improvements };
}

function aggregateLabels(rows: readonly CallSessionRow[]): CoachingInsights["purchaseIntentLabels"] {
  const counts = new Map<PurchaseIntentLabel, number>();
  for (const row of rows) {
    const review = parseReviewPayload(row);
    if (!review) continue;
    // The persisted review schema types the label as a plain string; map it
    // onto the canonical label enum (anything unknown = insufficient data).
    const label: PurchaseIntentLabel = (
      LABEL_ORDER as readonly string[]
    ).includes(review.purchaseIntent.label)
      ? (review.purchaseIntent.label as PurchaseIntentLabel)
      : PURCHASE_INTENT_LABELS.insufficientData;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return LABEL_ORDER.filter((label) => (counts.get(label) ?? 0) > 0).map((label) => ({
    label,
    count: counts.get(label) ?? 0,
  }));
}

function aggregateRecommendations(
  rows: readonly CallSessionRow[]
): CoachingInsights["pipelineRecommendations"] {
  const counts = new Map<PipelineStage, number>();
  for (const row of rows) {
    const review = parseReviewPayload(row);
    if (!review) continue;
    const target = review.pipelineRecommendation.targetStage;
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return PIPELINE_STAGES.filter((stage) => (counts.get(stage) ?? 0) > 0).map(
    (stage) => ({ targetStage: stage, count: counts.get(stage) ?? 0 })
  );
}

function recentMoments(
  rows: readonly CallSessionRow[]
): RecentCoachingMoment[] {
  return rows.slice(0, COACH_RECENT_MOMENTS_LIMIT).map((row) => ({
    callId: row.id,
    createdAt: row.created_at ?? row.started_at ?? null,
    observations: (parseReviewPayload(row)?.coaching ?? []).map((observation) => ({
      kind: observation.kind,
      area: observation.area,
      observation: observation.observation,
    })),
  }));
}

/**
 * Deterministic insight aggregation over eligible completed calls. Empty or
 * ineligible input yields an empty-but-valid result (no invented insights).
 */
export function aggregateCoachingInsights(
  eligibleCalls: readonly CallSessionRow[]
): CoachingInsights {
  const { strengths, improvements } = aggregateAreas(eligibleCalls);
  return {
    eligibleCount: eligibleCalls.length,
    strengths,
    improvements,
    purchaseIntentLabels: aggregateLabels(eligibleCalls),
    pipelineRecommendations: aggregateRecommendations(eligibleCalls),
    recentMoments: recentMoments(eligibleCalls),
  };
}
