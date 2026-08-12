// M8a — ideal-customer parser: honest derivation of structured reference data
// from the Sales Profile's free-text ideal_customer field.
import { describe, expect, it } from "vitest";
import { parseIdealCustomer } from "@/lib/prospects/ideal-customer";

describe("parseIdealCustomer", () => {
  it("returns null for no text", () => {
    expect(parseIdealCustomer(null)).toBeNull();
    expect(parseIdealCustomer("")).toBeNull();
    expect(parseIdealCustomer("   ")).toBeNull();
  });

  it("splits comma-separated industries and size tokens", () => {
    const result = parseIdealCustomer("Roofing, 1-10 employees, Construction");
    expect(result).toEqual({
      industries: ["Roofing", "Construction"],
      sizes: ["1-10"],
    });
  });

  it("handles newlines and semicolons as separators", () => {
    const result = parseIdealCustomer("Roofing; 11-50\nConsulting");
    expect(result?.industries).toEqual(["Roofing", "Consulting"]);
    expect(result?.sizes).toEqual(["11-50"]);
  });

  it("normalizes size tokens to the numeric range", () => {
    const result = parseIdealCustomer("500+ staff, 1-10 people, 25 employees");
    expect(result?.sizes).toEqual(["500+", "1-10", "25"]);
  });

  it("treats a single descriptive sentence as one industry keyword (no false split)", () => {
    const result = parseIdealCustomer("Roofing contractors with 1-10 employees in Chicago");
    expect(result?.industries).toEqual(["Roofing contractors with 1-10 employees in Chicago"]);
    expect(result?.sizes).toBeUndefined();
  });

  it("dedupes case-insensitively", () => {
    const result = parseIdealCustomer("Roofing, roofing, Roofing");
    expect(result?.industries).toEqual(["Roofing"]);
  });

  it("treats an unparseable token as an industry keyword (never a false size)", () => {
    // "???" can't be a size, so it becomes an industry keyword — the scorer
    // only matches when a prospect's industry actually contains it, so no
    // score is ever fabricated from garbage.
    const result = parseIdealCustomer("???");
    expect(result?.industries).toEqual(["???"]);
    expect(result?.sizes).toBeUndefined();
  });
});
