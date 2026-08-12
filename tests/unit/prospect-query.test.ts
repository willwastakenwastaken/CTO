// M8a — /prospects list query builder: search / filter / sort predicates.
import { describe, expect, it } from "vitest";
import {
  buildProspectListSpec,
  DEFAULT_SORT,
  prospectDisplayName,
} from "@/lib/prospects/query";

describe("buildProspectListSpec", () => {
  it("defaults to newest-first (created_at desc) with no predicates", () => {
    expect(buildProspectListSpec({})).toEqual({
      ilike: [],
      eq: [],
      order: { column: "created_at", ascending: false },
    });
    expect(DEFAULT_SORT).toBe("created");
  });

  it("searches name, company, and email case-insensitively", () => {
    const spec = buildProspectListSpec({ q: "Roof" });
    expect(spec.ilike).toEqual([
      { column: "first_name", pattern: "%Roof%" },
      { column: "last_name", pattern: "%Roof%" },
      { column: "company", pattern: "%Roof%" },
      { column: "email", pattern: "%Roof%" },
    ]);
    // Supabase .ilike() is case-insensitive; the builder must not rely on the
    // client having lowercased the query.
    expect(spec.ilike.every((p) => p.pattern.includes("Roof"))).toBe(true);
  });

  it("whitespace-only search produces no predicates", () => {
    const spec = buildProspectListSpec({ q: "   " });
    expect(spec.ilike).toEqual([]);
  });

  it("filters by stage with an exact match", () => {
    const spec = buildProspectListSpec({ stage: "contacted" });
    expect(spec.eq).toEqual([{ column: "stage", value: "contacted" }]);
  });

  it("maps each sort to the right ordered column", () => {
    expect(buildProspectListSpec({ sort: "name" }).order).toEqual({
      column: "first_name",
      ascending: true,
    });
    expect(buildProspectListSpec({ sort: "company" }).order).toEqual({
      column: "company",
      ascending: true,
    });
    expect(buildProspectListSpec({ sort: "created" }).order).toEqual({
      column: "created_at",
      ascending: false,
    });
    expect(buildProspectListSpec({ sort: "last_contact" }).order).toEqual({
      column: "last_contact_at",
      ascending: false,
    });
    expect(buildProspectListSpec({ sort: "due" }).order).toEqual({
      column: "next_action_due_date",
      ascending: true,
    });
  });

  it("combines search, filter, and sort into one spec", () => {
    const spec = buildProspectListSpec({ q: "acme", stage: "qualified", sort: "due" });
    expect(spec.ilike.length).toBe(4);
    expect(spec.eq).toEqual([{ column: "stage", value: "qualified" }]);
    expect(spec.order).toEqual({ column: "next_action_due_date", ascending: true });
  });
});

describe("prospectDisplayName", () => {
  it("prefers the full name", () => {
    expect(
      prospectDisplayName({ first_name: "John", last_name: "Smith", company: "ABC Roofing" })
    ).toBe("John Smith");
  });

  it("falls back to the company when there is no name", () => {
    expect(
      prospectDisplayName({ first_name: null, last_name: "", company: "ABC Roofing" })
    ).toBe("ABC Roofing");
  });

  it("never fabricates a name when nothing is known", () => {
    expect(prospectDisplayName({ first_name: null, last_name: null, company: "  " })).toBe(
      "Unnamed prospect"
    );
  });
});
