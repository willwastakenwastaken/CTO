// ProspectStore — the persistence boundary for the Prospects workspace.
// Implemented over Supabase. All rows carry user_id derived from the server
// session (never from the browser); RLS (migrations/002) enforces ownership
// anyway. Activities use deterministic ids where the parent is known before
// insert (prospect_created), so re-running the one-shot flow cannot duplicate.
import type { SupabaseClient } from "@supabase/supabase-js";
import { PersistenceError } from "@/lib/calls/types";
import type {
  ActivityRow,
  ProspectNoteRow,
  ProspectRow,
} from "@/lib/prospects/types";
import type { ProspectListSpec } from "@/lib/prospects/query";

export interface ProspectStore {
  /** All of a user's prospects, filtered/sorted by the list spec. */
  listProspects(userId: string, spec: ProspectListSpec): Promise<ProspectRow[]>;
  getProspect(prospectId: string): Promise<ProspectRow | null>;
  insertProspect(row: ProspectRow): Promise<void>;
  /** Scoped by id; callers must verify ownership (RLS enforces on top). */
  updateProspect(prospectId: string, patch: Partial<ProspectRow>): Promise<void>;
  deleteProspect(prospectId: string): Promise<void>;
  listNotes(prospectId: string): Promise<ProspectNoteRow[]>;
  insertNote(row: ProspectNoteRow): Promise<void>;
  /** Timeline entries for a prospect, newest first. */
  listActivities(prospectId: string): Promise<ActivityRow[]>;
  /** Idempotent insert-or-update keyed on the activity's id. */
  upsertActivity(row: ActivityRow): Promise<void>;
  /** The default Sales Profile's ideal_customer text (for Opportunity Fit). */
  getIdealCustomerText(userId: string): Promise<string | null>;
}

export function createSupabaseProspectStore(supabase: SupabaseClient): ProspectStore {
  const fail = (what: string, error: unknown): never => {
    throw new PersistenceError(`Failed to ${what}.`, error);
  };

  return {
    async listProspects(userId, spec) {
      let query = supabase
        .from("prospects")
        .select("*")
        .eq("user_id", userId);
      for (const { column, pattern } of spec.ilike) {
        query = query.ilike(column, pattern);
      }
      for (const { column, value } of spec.eq) {
        query = query.eq(column, value);
      }
      query = query.order(spec.order.column, {
        ascending: spec.order.ascending,
        nullsFirst: false,
      });
      const { data, error } = await query;
      if (error) fail(`list prospects for ${userId}`, error);
      return (data as ProspectRow[] | null) ?? [];
    },

    async getProspect(prospectId) {
      const { data, error } = await supabase
        .from("prospects")
        .select("*")
        .eq("id", prospectId)
        .maybeSingle();
      if (error) fail(`load prospect ${prospectId}`, error);
      return (data as ProspectRow | null) ?? null;
    },

    async insertProspect(row) {
      const { error } = await supabase.from("prospects").insert(row);
      if (error) fail(`create prospect ${row.id}`, error);
    },

    async updateProspect(prospectId, patch) {
      const { error } = await supabase
        .from("prospects")
        .update(patch)
        .eq("id", prospectId);
      if (error) fail(`update prospect ${prospectId}`, error);
    },

    async deleteProspect(prospectId) {
      const { error } = await supabase
        .from("prospects")
        .delete()
        .eq("id", prospectId);
      if (error) fail(`delete prospect ${prospectId}`, error);
    },

    async listNotes(prospectId) {
      const { data, error } = await supabase
        .from("prospect_notes")
        .select("*")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false });
      if (error) fail(`load notes for ${prospectId}`, error);
      return (data as ProspectNoteRow[] | null) ?? [];
    },

    async insertNote(row) {
      const { error } = await supabase.from("prospect_notes").insert(row);
      if (error) fail(`create note for ${row.prospect_id}`, error);
    },

    async listActivities(prospectId) {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("prospect_id", prospectId)
        .order("occurred_at", { ascending: false });
      if (error) fail(`load activities for ${prospectId}`, error);
      return (data as ActivityRow[] | null) ?? [];
    },

    async upsertActivity(row) {
      const { error } = await supabase
        .from("activities")
        .upsert(row, { onConflict: "id" });
      if (error) fail(`persist activity ${row.id}`, error);
    },

    async getIdealCustomerText(userId) {
      const { data, error } = await supabase
        .from("sales_profiles")
        .select("ideal_customer")
        .eq("user_id", userId)
        .eq("is_default", true)
        .maybeSingle();
      if (error) fail(`load sales profile for ${userId}`, error);
      return (data as { ideal_customer: string | null } | null)?.ideal_customer ?? null;
    },
  };
}
