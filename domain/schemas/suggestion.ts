// Zod schema for the persisted suggestion shape (ai_suggestions table).
// Dismissal is recorded in dismissed_at, NOT as negative feedback.
import { z } from "zod";
import { SUGGESTION_ACTIONS } from "@/domain/coaching/types";

export const SuggestionSchema = z.object({
  id: z.uuid(),
  callId: z.uuid().optional(),
  eventId: z.uuid().nullable().optional(),
  action: z.enum(SUGGESTION_ACTIONS),
  text: z.string().min(1),
  reason: z.string().nullable().optional(),
  priority: z.number().int().min(0),
  expiresAt: z.string().datetime().nullable().optional(),
  displayedAt: z.string().datetime().nullable().optional(),
  dismissedAt: z.string().datetime().nullable().optional(),
  usedAt: z.string().datetime().nullable().optional(),
  feedback: z.enum(["useful", "not_useful"]).nullable().optional(),
  createdAt: z.string().datetime().nullable().optional(),
});

export type SuggestionRow = z.infer<typeof SuggestionSchema>;
