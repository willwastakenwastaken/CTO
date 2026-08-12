// List query builder for /prospects — pure functions that turn user inputs
// (search text, stage filter, sort) into the predicate spec the store applies
// to Supabase. Kept free of Supabase imports so Vitest can unit-test the
// predicates directly.
import type { ProspectListQuery, ProspectSort } from "@/lib/prospects/schema";
import type { ProspectRow } from "@/lib/prospects/types";

export interface ProspectListSpec {
  /** Case-insensitive substring matches (search). */
  ilike: Array<{ column: string; pattern: string }>;
  /** Exact matches (stage filter). */
  eq: Array<{ column: string; value: string }>;
  order: { column: string; ascending: boolean };
}

/** Columns searched by the free-text query. */
const SEARCH_COLUMNS = ["first_name", "last_name", "company", "email"] as const;

const SORT_COLUMNS: Record<
  ProspectSort,
  { column: string; ascending: boolean }
> = {
  name: { column: "first_name", ascending: true },
  company: { column: "company", ascending: true },
  created: { column: "created_at", ascending: false },
  last_contact: { column: "last_contact_at", ascending: false },
  due: { column: "next_action_due_date", ascending: true },
};

export const DEFAULT_SORT: ProspectSort = "created";

/** UI labels for the sort select, in display order. */
export const SORT_OPTIONS: ReadonlyArray<{ value: ProspectSort; label: string }> = [
  { value: "created", label: "Newest first" },
  { value: "name", label: "Name" },
  { value: "company", label: "Company" },
  { value: "last_contact", label: "Last contact" },
  { value: "due", label: "Next action due" },
];

/**
 * Builds the Supabase predicate spec for a list query. Search matches name /
 * company / email (case-insensitive substring); stage filters exactly; the
 * sort maps to one ordered column. An empty query returns just the default
 * order (created_at desc).
 */
export function buildProspectListSpec(
  query: ProspectListQuery = {}
): ProspectListSpec {
  const spec: ProspectListSpec = {
    ilike: [],
    eq: [],
    order: SORT_COLUMNS[query.sort ?? DEFAULT_SORT],
  };
  const q = query.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    for (const column of SEARCH_COLUMNS) {
      spec.ilike.push({ column, pattern });
    }
  }
  if (query.stage) {
    spec.eq.push({ column: "stage", value: query.stage });
  }
  return spec;
}

/** Display name for a prospect: "First Last", else company, else a fallback. */
export function prospectDisplayName(
  row: Pick<ProspectRow, "first_name" | "last_name" | "company">
): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (row.company?.trim()) return row.company;
  return "Unnamed prospect";
}
