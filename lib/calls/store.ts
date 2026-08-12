// CallStore — the persistence boundary for the simulation engine.
// Implemented over Supabase; every write is an idempotent upsert keyed on the
// row's deterministic UUID (onConflict: "id", ignoreDuplicates), so replaying
// an advance can never duplicate segments/events/suggestions. All rows carry
// user_id derived from the server session (never from the browser); RLS
// (migrations/002) enforces ownership anyway.
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActivityRow,
  AiSuggestionRow,
  CallEventRow,
  CallSessionRow,
  ProductEventRow,
  ProspectNoteRow,
  ProspectRow,
  TranscriptSegmentRow,
} from "@/lib/calls/types";
import { PersistenceError } from "@/lib/calls/types";

export interface ProspectIdentity {
  name: string | null;
  company: string | null;
}

export interface CallStore {
  getSession(callId: string): Promise<CallSessionRow | null>;
  /** Prospect display identity for a call header; null when not linked. */
  getProspect(prospectId: string | null): Promise<ProspectIdentity | null>;
  /** Full prospect row (identity + stage) for review/apply; null when missing. */
  getProspectRecord(prospectId: string): Promise<ProspectRow | null>;
  /** Applies a stage + last-contact patch to a prospect (Apply action). */
  updateProspect(prospectId: string, patch: { stage?: string; last_contact_at?: string | null }): Promise<void>;
  insertSession(row: CallSessionRow): Promise<void>;
  updateSession(callId: string, patch: Partial<CallSessionRow>): Promise<void>;
  listSegments(callId: string): Promise<TranscriptSegmentRow[]>;
  upsertSegment(row: TranscriptSegmentRow): Promise<void>;
  upsertEvents(rows: CallEventRow[]): Promise<void>;
  upsertSuggestion(row: AiSuggestionRow): Promise<void>;
  updateSuggestion(suggestionId: string, patch: Partial<AiSuggestionRow>): Promise<void>;
  markSuggestionSuperseded(suggestionId: string, supersededById: string): Promise<void>;
  listEvents(callId: string): Promise<CallEventRow[]>;
  listSuggestions(callId: string): Promise<AiSuggestionRow[]>;
  /** The call-summary note for a call, or null (exactly one per call). */
  getNoteByCallAndType(callId: string, type: string): Promise<ProspectNoteRow | null>;
  /** Idempotent insert-or-update keyed on the note's deterministic id. */
  upsertNote(row: ProspectNoteRow): Promise<void>;
  getActivityByCallAndType(callId: string, type: string): Promise<ActivityRow | null>;
  /** Idempotent insert-or-update keyed on the activity's deterministic id. */
  upsertActivity(row: ActivityRow): Promise<void>;
  getProductEventBySessionAndType(sessionId: string, type: string): Promise<ProductEventRow | null>;
  /** Idempotent insert-or-update keyed on the event's deterministic id. */
  upsertProductEvent(row: ProductEventRow): Promise<void>;
}

export function createSupabaseCallStore(supabase: SupabaseClient): CallStore {
  const fail = (what: string, error: unknown): never => {
    throw new PersistenceError(`Failed to ${what}.`, error);
  };

  return {
    async getSession(callId) {
      const { data, error } = await supabase
        .from("call_sessions")
        .select("*")
        .eq("id", callId)
        .maybeSingle();
      if (error) fail(`load call session ${callId}`, error);
      return (data as CallSessionRow | null) ?? null;
    },

    async getProspect(prospectId) {
      if (!prospectId) return null;
      const { data, error } = await supabase
        .from("prospects")
        .select("first_name, last_name, company")
        .eq("id", prospectId)
        .maybeSingle();
      if (error) fail(`load prospect ${prospectId}`, error);
      const row = data as
        | { first_name: string | null; last_name: string | null; company: string | null }
        | null;
      if (!row) return null;
      const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
      return { name: name || null, company: row.company };
    },

    async getProspectRecord(prospectId) {
      const { data, error } = await supabase
        .from("prospects")
        .select("id, user_id, first_name, last_name, company, stage, last_contact_at")
        .eq("id", prospectId)
        .maybeSingle();
      if (error) fail(`load prospect record ${prospectId}`, error);
      return (data as ProspectRow | null) ?? null;
    },

    async updateProspect(prospectId, patch) {
      const { error } = await supabase
        .from("prospects")
        .update(patch)
        .eq("id", prospectId);
      if (error) fail(`update prospect ${prospectId}`, error);
    },

    async insertSession(row) {
      const { error } = await supabase.from("call_sessions").insert(row);
      if (error) fail(`create call session ${row.id}`, error);
    },

    async updateSession(callId, patch) {
      const { error } = await supabase
        .from("call_sessions")
        .update(patch)
        .eq("id", callId);
      if (error) fail(`update call session ${callId}`, error);
    },

    async listSegments(callId) {
      const { data, error } = await supabase
        .from("transcript_segments")
        .select("*")
        .eq("call_id", callId)
        .order("sequence", { ascending: true });
      if (error) fail(`load transcript for ${callId}`, error);
      return (data as TranscriptSegmentRow[] | null) ?? [];
    },

    async upsertSegment(row) {
      const { error } = await supabase
        .from("transcript_segments")
        .upsert(row, { onConflict: "id", ignoreDuplicates: true });
      if (error) fail(`persist transcript segment ${row.id}`, error);
    },

    async upsertEvents(rows) {
      if (rows.length === 0) return;
      const { error } = await supabase
        .from("call_events")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (error) fail(`persist call events for ${rows[0].call_id}`, error);
    },

    async upsertSuggestion(row) {
      const { error } = await supabase
        .from("ai_suggestions")
        .upsert(row, { onConflict: "id", ignoreDuplicates: true });
      if (error) fail(`persist suggestion ${row.id}`, error);
    },

    async updateSuggestion(suggestionId, patch) {
      const { error } = await supabase
        .from("ai_suggestions")
        .update(patch)
        .eq("id", suggestionId);
      if (error) fail(`update suggestion ${suggestionId}`, error);
    },

    async markSuggestionSuperseded(suggestionId, supersededById) {
      const { error } = await supabase
        .from("ai_suggestions")
        .update({ superseded_by: supersededById })
        .eq("id", suggestionId);
      if (error) fail(`mark suggestion ${suggestionId} superseded`, error);
    },

    async listEvents(callId) {
      const { data, error } = await supabase
        .from("call_events")
        .select("*")
        .eq("call_id", callId)
        .order("created_at", { ascending: true });
      if (error) fail(`load events for ${callId}`, error);
      return (data as CallEventRow[] | null) ?? [];
    },

    async listSuggestions(callId) {
      const { data, error } = await supabase
        .from("ai_suggestions")
        .select("*")
        .eq("call_id", callId)
        .order("created_at", { ascending: true });
      if (error) fail(`load suggestions for ${callId}`, error);
      return (data as AiSuggestionRow[] | null) ?? [];
    },

    async getNoteByCallAndType(callId, type) {
      const { data, error } = await supabase
        .from("prospect_notes")
        .select("*")
        .eq("call_id", callId)
        .eq("type", type)
        .limit(1)
        .maybeSingle();
      if (error) fail(`load note for ${callId}`, error);
      return (data as ProspectNoteRow | null) ?? null;
    },

    async upsertNote(row) {
      const { error } = await supabase
        .from("prospect_notes")
        .upsert(row, { onConflict: "id" });
      if (error) fail(`persist note ${row.id}`, error);
    },

    async getActivityByCallAndType(callId, type) {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("call_id", callId)
        .eq("type", type)
        .limit(1)
        .maybeSingle();
      if (error) fail(`load activity for ${callId}`, error);
      return (data as ActivityRow | null) ?? null;
    },

    async upsertActivity(row) {
      const { error } = await supabase
        .from("activities")
        .upsert(row, { onConflict: "id" });
      if (error) fail(`persist activity ${row.id}`, error);
    },

    async getProductEventBySessionAndType(sessionId, type) {
      const { data, error } = await supabase
        .from("product_events")
        .select("*")
        .eq("session_id", sessionId)
        .eq("type", type)
        .limit(1)
        .maybeSingle();
      if (error) fail(`load product event for ${sessionId}`, error);
      return (data as ProductEventRow | null) ?? null;
    },

    async upsertProductEvent(row) {
      const { error } = await supabase
        .from("product_events")
        .upsert(row, { onConflict: "id" });
      if (error) fail(`persist product event ${row.id}`, error);
    },
  };
}
