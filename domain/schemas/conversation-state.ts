// DB-shaped JSON for call_sessions.conversation_state (and the Deal State in
// the live UI). Sparse rows from the DB (default '{}') are normalized by
// domain/conversation-state/state.ts.
import { z } from "zod";
import {
  CONVERSATION_STAGES,
  INTEREST_LEVELS,
} from "@/domain/conversation-state/types";

export const StateFactJsonSchema = z.object({
  value: z.string().min(1),
  /** Event UUIDs that confirmed/updated this fact (history preserved). */
  evidenceIds: z.array(z.uuid()).default([]),
  updatedAtMs: z.number().int().min(0),
});
export type StateFactJson = z.infer<typeof StateFactJsonSchema>;

export const ConversationStateJsonSchema = z.object({
  stage: z.enum(CONVERSATION_STAGES),
  interest: z.enum(INTEREST_LEVELS),
  pain: StateFactJsonSchema.nullable(),
  impact: StateFactJsonSchema.nullable(),
  authority: StateFactJsonSchema.nullable(),
  budget: StateFactJsonSchema.nullable(),
  timeline: StateFactJsonSchema.nullable(),
  currentSolution: StateFactJsonSchema.nullable(),
  nextObjective: StateFactJsonSchema.nullable(),
  competitors: z.array(StateFactJsonSchema).default([]),
  objections: z.array(StateFactJsonSchema).default([]),
  buyingSignals: z.array(StateFactJsonSchema).default([]),
  version: z.number().int().min(0).default(0),
});

export type ConversationStateJson = z.infer<typeof ConversationStateJsonSchema>;

/** Parses a stored row (which may be sparse/'{}') into a complete JSON shape. */
export function normalizeConversationStateJson(
  raw: unknown
): ConversationStateJson {
  const base: ConversationStateJson = {
    stage: "opening",
    interest: "unknown",
    pain: null,
    impact: null,
    authority: null,
    budget: null,
    timeline: null,
    currentSolution: null,
    nextObjective: null,
    competitors: [],
    objections: [],
    buyingSignals: [],
    version: 0,
  };
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return base;
  }
  const merged = { ...base, ...raw };
  const parsed = ConversationStateJsonSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(
      `Invalid conversation_state JSON: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}
