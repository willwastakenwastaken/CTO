// Route input schemas for later server actions. All IDs are validated UUID
// strings — never Number(id)/parseInt(id). Parsing with these schemas is the
// ONLY way server actions should accept IDs and feedback.
import { z } from "zod";
import { PIPELINE_STAGES } from "@/domain/pipeline/types";

export const ProspectIdSchema = z.uuid();
export type ProspectIdInput = z.infer<typeof ProspectIdSchema>;

export const CallIdSchema = z.uuid();
export type CallIdInput = z.infer<typeof CallIdSchema>;

/** Feedback on a live suggestion (ai_suggestions.feedback). */
export const SuggestionFeedbackSchema = z.object({
  callId: z.uuid(),
  suggestionId: z.uuid(),
  feedback: z.enum(["useful", "not_useful"]),
});
export type SuggestionFeedbackInput = z.infer<typeof SuggestionFeedbackSchema>;

/** Pipeline application must be confirmed AND rechecked (stale rejection). */
export const PipelineApplySchema = z.object({
  prospectId: z.uuid(),
  /** The stage the client believes the prospect is currently in. */
  expectedStage: z.enum(PIPELINE_STAGES),
  targetStage: z.enum(PIPELINE_STAGES),
  /** Explicit confirmation is required for terminal stages (closed_*). */
  confirmed: z.boolean(),
});
export type PipelineApplyInput = z.infer<typeof PipelineApplySchema>;
