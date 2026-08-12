// Prospects workspace service — server-side orchestration over Supabase.
//
// Every operation derives rows from a `userId` supplied by the caller, which
// MUST come from the server session (lib/auth/session.ts) — never from the
// browser. RLS (migrations/002) independently enforces ownership.
//
// Opportunity Fit is recomputed on every create/full edit from the submitted
// fields + the default Sales Profile's ideal-customer text (parsed honestly —
// see lib/prospects/ideal-customer.ts). When fields are too sparse the domain
// module returns insufficient data and that is exactly what gets persisted:
// score NULL, label "insufficient_data", the per-dimension reasons explaining
// why, and the scoring version. A score is never fabricated.
import { randomUUID } from "node:crypto";
import { computeOpportunityFit } from "@/domain/scoring/opportunity-fit";
import { applyStageTransition } from "@/domain/pipeline/rules";
import { humanizeStage } from "@/domain/utils/format";
import { isUuid, uuidFromParts } from "@/domain/utils/uuid";
import { compactList, textOrNull } from "@/lib/sales-profile/schema";
import { parseIdealCustomer } from "@/lib/prospects/ideal-customer";
import type { ProspectStore } from "@/lib/prospects/store";
import type { ActivityRow, ProspectNoteRow, ProspectRow } from "@/lib/prospects/types";
import { ProspectServiceError } from "@/lib/prospects/types";
import {
  nextActionSchema,
  noteSchema,
  prospectFormSchema,
  stageChangeSchema,
  type ProspectFormValues,
} from "@/lib/prospects/schema";
import { prospectDisplayName } from "@/lib/prospects/query";

export interface ProspectServiceOptions {
  store: ProspectStore;
  /** Server-derived session user id — never browser-supplied. */
  userId: string;
}

export interface ProspectDetail {
  prospect: ProspectRow;
  notes: ProspectNoteRow[];
  activities: ActivityRow[];
}

export interface StageChangeOutcome {
  prospectId: string;
  fromStage: string;
  toStage: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** The subset of ProspectRow fields the create/edit form owns. All keys are
 * required in the patch (blank submitted fields become NULL), so spreading it
 * can never produce `undefined` values. */
type ProspectPatch = {
  [K in
    | "first_name"
    | "last_name"
    | "title"
    | "email"
    | "phone"
    | "company"
    | "website"
    | "industry"
    | "size"
    | "location"
    | "next_action"
    | "next_action_due_date"
    | "tags"
    | "source"]: ProspectRow[K];
};

/** Maps the form's blank-as-unknown semantics onto DB columns: empty strings
 * become NULL (unknown), tags are compacted, and only submitted fields are
 * present in the patch (inline edits never touch the rest). */
function toProspectPatch(values: ProspectFormValues): ProspectPatch {
  return {
    first_name: textOrNull(values.first_name),
    last_name: textOrNull(values.last_name),
    title: textOrNull(values.title),
    email: textOrNull(values.email),
    phone: textOrNull(values.phone),
    company: textOrNull(values.company),
    website: textOrNull(values.website),
    industry: textOrNull(values.industry),
    size: textOrNull(values.size),
    location: textOrNull(values.location),
    next_action: textOrNull(values.next_action),
    next_action_due_date: textOrNull(values.next_action_due_date),
    tags: compactList(values.tags),
    source: textOrNull(values.source),
  };
}

export function createProspectService({ store, userId }: ProspectServiceOptions) {
  /** Ownership-guarded load: malformed UUID or another user's prospect is a
   * NOT_FOUND (404 semantics — never reveal a prospect's existence). */
  async function loadProspect(prospectId: string): Promise<ProspectRow> {
    if (!isUuid(prospectId)) {
      throw new ProspectServiceError(
        "NOT_FOUND",
        `Invalid prospect id "${prospectId}" — IDs are UUID strings.`
      );
    }
    const row = await store.getProspect(prospectId);
    if (!row || row.user_id !== userId) {
      throw new ProspectServiceError(
        "NOT_FOUND",
        `Prospect "${prospectId}" not found for this user.`
      );
    }
    return row;
  }

  /** Computes Opportunity Fit from a prospect patch + the sales profile's
   * ideal-customer text. Honors the domain module's own semantics: sparse
   * fields -> insufficient data (score NULL), never a fabricated score. */
  async function computeFit(
    patch: Partial<ProspectRow>
  ): Promise<{
    opportunity_fit_score: number | null;
    opportunity_fit_label: string;
    opportunity_fit_reasons: ProspectRow["opportunity_fit_reasons"];
    opportunity_fit_scoring_version: string;
  }> {
    const idealCustomerText = await store.getIdealCustomerText(userId);
    const result = computeOpportunityFit({
      industry: patch.industry ?? null,
      companySize: patch.size ?? null,
      location: patch.location ?? null,
      idealCustomer: parseIdealCustomer(idealCustomerText),
      // No stored ideal-customer assessment or geography flag in Phase 1 —
      // those dimensions are left unscored rather than guessed.
      idealCustomerMatch: null,
      geographyRelevant: false,
      verifiedNeedIndicators: undefined,
    });
    return {
      opportunity_fit_score: result.score,
      opportunity_fit_label: result.label,
      opportunity_fit_reasons: result.dimensionReasons,
      opportunity_fit_scoring_version: result.scoringVersion,
    };
  }

  async function stageChangedActivity(
    prospect: ProspectRow,
    fromStage: string,
    toStage: string,
    source: "command_center" | "edit_form",
    nowMs: number
  ): Promise<ActivityRow> {
    return {
      id: uuidFromParts(
        prospect.id,
        "activity",
        "stage_changed",
        toStage,
        String(nowMs)
      ),
      user_id: userId,
      prospect_id: prospect.id,
      call_id: null,
      type: "stage_changed",
      summary: `Pipeline stage changed — ${humanizeStage(fromStage)} → ${humanizeStage(toStage)}.`,
      metadata: {
        prospectId: prospect.id,
        fromStage,
        toStage,
        source,
      },
      occurred_at: iso(nowMs),
    };
  }

  return {
    /**
     * Creates a prospect (one-shot flow): validates the form, computes and
     * persists Opportunity Fit from the submitted fields, and writes exactly
     * one prospect_created activity (deterministic id — re-running the same
     * flow cannot duplicate the timeline entry).
     */
    async createProspect(
      input: unknown,
      nowMs: number = Date.now()
    ): Promise<{ prospectId: string }> {
      const values = prospectFormSchema.parse(input);
      const prospectId = randomUUID();
      const stage = values.stage ?? "new";
      const patch = toProspectPatch(values);
      const fit = await computeFit(patch);
      const row: ProspectRow = {
        id: prospectId,
        user_id: userId,
        stage,
        ...patch,
        ...fit,
        last_contact_at: null,
      };
      await store.insertProspect(row);
      await store.upsertActivity({
        id: uuidFromParts(prospectId, "activity", "prospect_created"),
        user_id: userId,
        prospect_id: prospectId,
        call_id: null,
        type: "prospect_created",
        summary: `Prospect created — ${prospectDisplayName(row)}.`,
        metadata: { prospectId, stage },
        occurred_at: iso(nowMs),
      });
      return { prospectId };
    },

    /**
     * Full edit (Command Center edit mode). Only the submitted form fields
     * are overwritten; blank submitted fields become unknown (NULL), never
     * fabricated. Opportunity Fit is recomputed from the resulting fields.
     * A form-driven stage change goes through the pipeline transition rules
     * (terminal targets still need the confirmation-only stage control).
     */
    async updateProspect(
      prospectId: string,
      input: unknown,
      nowMs: number = Date.now()
    ): Promise<{ prospectId: string }> {
      const prospect = await loadProspect(prospectId);
      const values = prospectFormSchema.parse(input);
      const targetStage = values.stage ?? prospect.stage;
      const stageChanged = targetStage !== prospect.stage;
      if (stageChanged) {
        const transition = applyStageTransition({
          prospectId,
          currentStage: prospect.stage,
          expectedStage: prospect.stage,
          targetStage,
          confirmed: false,
        });
        if (!transition.ok) {
          throw new ProspectServiceError(
            transition.error.category as ProspectServiceError["category"],
            transition.error.message
          );
        }
      }
      const patch = { ...toProspectPatch(values), stage: targetStage };
      const fit = await computeFit(patch);
      await store.updateProspect(prospectId, { ...patch, ...fit });
      if (stageChanged) {
        await store.upsertActivity(
          await stageChangedActivity(
            prospect,
            prospect.stage,
            targetStage,
            "edit_form",
            nowMs
          )
        );
      }
      return { prospectId };
    },

    /**
     * Command Center stage control. Rechecks the CURRENT stage against the
     * client's expectedStage (stale multi-tab guard), requires explicit
     * confirmation for terminal stages, and logs exactly one stage_changed
     * activity per change with from/to metadata.
     */
    async changeStage(
      prospectId: string,
      input: unknown,
      nowMs: number = Date.now()
    ): Promise<StageChangeOutcome> {
      const prospect = await loadProspect(prospectId);
      const values = stageChangeSchema.parse(input);
      const transition = applyStageTransition({
        prospectId,
        currentStage: prospect.stage,
        expectedStage: values.expectedStage,
        targetStage: values.targetStage,
        confirmed: values.confirmed === true,
      });
      if (!transition.ok) {
        throw new ProspectServiceError(
          transition.error.category as ProspectServiceError["category"],
          transition.error.message
        );
      }
      await store.updateProspect(prospectId, { stage: transition.nextStage });
      await store.upsertActivity(
        await stageChangedActivity(
          prospect,
          prospect.stage,
          transition.nextStage,
          "command_center",
          nowMs
        )
      );
      return {
        prospectId,
        fromStage: prospect.stage,
        toStage: transition.nextStage,
      };
    },

    /** Inline next-action edit: ONLY these two fields are overwritten. */
    async updateNextAction(
      prospectId: string,
      input: unknown
    ): Promise<{ prospectId: string }> {
      await loadProspect(prospectId); // ownership guard
      const values = nextActionSchema.parse(input);
      await store.updateProspect(prospectId, {
        next_action: textOrNull(values.next_action),
        next_action_due_date: textOrNull(values.next_action_due_date),
      });
      return { prospectId };
    },

    /** Delete with ownership guard. Activities survive (prospect_id is
     * nulled by FK), notes cascade with the prospect. */
    async deleteProspect(prospectId: string): Promise<{ prospectId: string }> {
      await loadProspect(prospectId);
      await store.deleteProspect(prospectId);
      return { prospectId };
    },

    /**
     * Adds a general note (one-shot flow): inserts the note, then exactly one
     * note_added activity referencing it (deterministic id).
     */
    async addNote(
      prospectId: string,
      input: unknown,
      nowMs: number = Date.now()
    ): Promise<{ noteId: string }> {
      await loadProspect(prospectId);
      const values = noteSchema.parse(input);
      const noteId = randomUUID();
      const row: ProspectNoteRow = {
        id: noteId,
        user_id: userId,
        prospect_id: prospectId,
        call_id: null,
        type: "general",
        title: values.title,
        body: textOrNull(values.body),
        structured_content: {},
      };
      await store.insertNote(row);
      await store.upsertActivity({
        id: uuidFromParts(prospectId, "activity", "note_added", noteId),
        user_id: userId,
        prospect_id: prospectId,
        call_id: null,
        type: "note_added",
        summary: `Note added — ${values.title}.`,
        metadata: { prospectId, noteId },
        occurred_at: iso(nowMs),
      });
      return { noteId };
    },

    /** Detail payload for the Command Center (ownership-guarded). */
    async getDetail(prospectId: string): Promise<ProspectDetail> {
      const prospect = await loadProspect(prospectId);
      const [notes, activities] = await Promise.all([
        store.listNotes(prospectId),
        store.listActivities(prospectId),
      ]);
      return { prospect, notes, activities };
    },

    /** All of the user's prospects (list page). */
    async listProspects(
      spec: Parameters<ProspectStore["listProspects"]>[1]
    ): Promise<ProspectRow[]> {
      return store.listProspects(userId, spec);
    },
  };
}

export type ProspectService = ReturnType<typeof createProspectService>;
