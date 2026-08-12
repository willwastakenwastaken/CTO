import { describe, expect, it } from "vitest";
import {
  computeOpportunityFit,
  OPPORTUNITY_FIT_MIN_SCORED_DIMENSIONS,
  OPPORTUNITY_FIT_SCORING_VERSION,
} from "@/domain/scoring/opportunity-fit";

describe("opportunity fit — insufficient data", () => {
  it("returns INSUFFICIENT_DATA when nothing is knowable", () => {
    const result = computeOpportunityFit({});
    expect(result.score).toBeNull();
    expect(result.label).toBe("insufficient_data");
    expect(result.sufficient).toBe(false);
    expect(result.insufficientReason).toContain(String(OPPORTUNITY_FIT_MIN_SCORED_DIMENSIONS));
    expect(result.scoringVersion).toBe(OPPORTUNITY_FIT_SCORING_VERSION);
  });

  it("returns INSUFFICIENT_DATA with only one scorable dimension", () => {
    const result = computeOpportunityFit({
      industry: "Roofing",
      idealCustomer: { industries: ["Roofing"] },
    });
    expect(result.score).toBeNull();
    expect(result.label).toBe("insufficient_data");
  });

  it("is NOT a likelihood-to-buy: never labels without data", () => {
    const result = computeOpportunityFit({});
    expect(result.label).not.toMatch(/intent|likelihood|probability/i);
  });
});

describe("opportunity fit — dimensions and weights", () => {
  const ideal = {
    industries: ["Roofing"],
    sizes: ["1-10"],
    geographies: ["Chicago"],
  };

  it("scores a strong full-match prospect at 100", () => {
    const result = computeOpportunityFit({
      industry: "Roofing & Exteriors",
      companySize: "1-10",
      location: "Chicago, IL",
      idealCustomer: ideal,
      geographyRelevant: true,
      verifiedNeedIndicators: ["Slow callbacks confirmed", "Missed jobs estimated"],
    });
    expect(result.sufficient).toBe(true);
    expect(result.score).toBe(100);
    expect(result.label).toBe("strong");
  });

  it("reports per-dimension reasons with the scoring version", () => {
    const result = computeOpportunityFit({
      industry: "Roofing",
      companySize: "50-200",
      location: "Chicago",
      idealCustomer: ideal,
      geographyRelevant: true,
      verifiedNeedIndicators: [],
    });
    expect(result.score).not.toBeNull();
    expect(result.scoringVersion).toBe(OPPORTUNITY_FIT_SCORING_VERSION);
    const industry = result.dimensionReasons.find((r) => r.dimension === "industry");
    const size = result.dimensionReasons.find((r) => r.dimension === "company size");
    expect(industry?.score).toBe(100);
    expect(size?.score).toBe(40); // known but outside ideal sizes
    expect(result.dimensionReasons.every((r) => r.reason.length > 0)).toBe(true);
  });

  it("renormalizes weights when geography is not relevant", () => {
    const withGeo = computeOpportunityFit({
      industry: "Roofing",
      companySize: "1-10",
      location: "Chicago",
      idealCustomer: ideal,
      geographyRelevant: true,
      verifiedNeedIndicators: ["Need confirmed"],
    });
    const withoutGeo = computeOpportunityFit({
      industry: "Roofing",
      companySize: "1-10",
      location: "Chicago",
      idealCustomer: ideal,
      geographyRelevant: false,
      verifiedNeedIndicators: ["Need confirmed"],
    });
    expect(withoutGeo.score).not.toBeNull();
    expect(withoutGeo.score).toBeGreaterThan(0);
    expect(withoutGeo.score).not.toBe(withGeo.score); // geography weight moved elsewhere
  });

  it("an explicit ideal-customer mismatch drags the score down", () => {
    const match = computeOpportunityFit({
      industry: "Roofing",
      companySize: "1-10",
      idealCustomer: ideal,
      idealCustomerMatch: true,
    });
    const mismatch = computeOpportunityFit({
      industry: "Plumbing", // outside ideal industries
      companySize: "50-200", // outside ideal sizes
      idealCustomer: ideal,
      idealCustomerMatch: false,
    });
    expect(match.score).not.toBeNull();
    expect(mismatch.score).not.toBeNull();
    expect(mismatch.score).toBeLessThan(match.score as number);
    expect(mismatch.label).toBe("poor");
  });

  it("labels map to score bands", () => {
    const strong = computeOpportunityFit({ industry: "Roofing", companySize: "1-10", idealCustomer: ideal, idealCustomerMatch: true, verifiedNeedIndicators: ["x"] });
    const weak = computeOpportunityFit({ industry: "Roofing", companySize: "50-200", idealCustomer: ideal, idealCustomerMatch: false });
    expect(strong.label).toBe("strong");
    expect(weak.label).toBe("weak");
    expect(strong.score).toBeGreaterThanOrEqual(0);
    expect(strong.score).toBeLessThanOrEqual(100);
    expect(strong.score).toBeGreaterThan(weak.score as number);
  });
});
