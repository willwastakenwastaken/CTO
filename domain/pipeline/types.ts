// Pipeline domain types (placeholder).

export const PIPELINE_STAGES = [
  "new",
  "researching",
  "ready_to_contact",
  "contacted",
  "qualified",
  "meeting_booked",
  "proposal",
  "closed_won",
  "closed_lost",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const TERMINAL_STAGES: readonly PipelineStage[] = [
  "closed_won",
  "closed_lost",
];

// NEVER silently move the pipeline: Apply only after confirmation AND a
// recheck of the current stage to prevent stale updates.
