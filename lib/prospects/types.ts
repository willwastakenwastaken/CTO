// Persistence row shapes for the Prospects workspace — column names MUST
// match migrations/001_initial_schema.sql (prospects, prospect_notes,
// activities). All server-side; user_id is derived from the session and never
// browser-supplied. RLS (migrations/002) enforces ownership on top.
import type { PipelineStage } from "@/domain/pipeline/types";
import type { OpportunityFitDimensionReason } from "@/domain/scoring/opportunity-fit";

/** Full prospects row (the entire public.prospects record). */
export interface ProspectRow {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  stage: PipelineStage;
  opportunity_fit_score: number | null;
  opportunity_fit_label: string | null;
  opportunity_fit_reasons: OpportunityFitDimensionReason[] | null;
  opportunity_fit_scoring_version: string | null;
  next_action: string | null;
  /** ISO date string ("YYYY-MM-DD") or null. */
  next_action_due_date: string | null;
  last_contact_at: string | null;
  tags: string[];
  source: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** prospect_notes row (general notes + structured call-summary notes). */
export interface ProspectNoteRow {
  id: string;
  user_id: string;
  prospect_id: string;
  call_id: string | null;
  type: string;
  title: string | null;
  body: string | null;
  structured_content: unknown;
  created_at?: string | null;
  updated_at?: string | null;
}

/** activities row (prospect_created, stage_changed, call_completed, note_added). */
export interface ActivityRow {
  id: string;
  user_id: string;
  prospect_id: string | null;
  call_id: string | null;
  type: string;
  summary: string | null;
  metadata: unknown;
  occurred_at: string;
  created_at?: string | null;
}

/** Stable error category for prospects workspace failures. */
export class ProspectServiceError extends Error {
  readonly category:
    | "NOT_FOUND"
    | "STALE_CURSOR"
    | "TERMINAL_LOCKED"
    | "TERMINAL_CONFIRMATION_REQUIRED"
    | "INVALID_TRANSITION"
    | "INVALID_INPUT";
  constructor(
    category: ProspectServiceError["category"],
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ProspectServiceError";
    this.category = category;
  }
}
