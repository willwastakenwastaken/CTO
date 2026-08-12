// M8b — Call Strategy builder: a pure, deterministic pre-call brief.
// Covered: full profile + rich prospect (every section populated), sparse
// prospect (honest empty sections, no invented pain hypotheses), no profile
// (onboarding-required state), and Zod output validation on every path.
import { describe, expect, it } from "vitest";
import { buildCallStrategy } from "@/domain/call-strategy/build";
import { callStrategySchema } from "@/domain/call-strategy/types";
import type {
  CallStrategyProfileInput,
  CallStrategyProspectInput,
} from "@/domain/call-strategy/types";

const FULL_PROFILE: CallStrategyProfileInput = {
  name: "Roofing Practice",
  product_name: "RoofScout",
  description: "Done-for-you roofing lead follow-up",
  benefits: "Faster callbacks",
  problems_solved: "Inconsistent callbacks; slow follow-up on inbound leads",
  differentiators: "Local crews",
  ideal_customer: "Roofing companies, 1-10 employees, Chicago",
  call_goal: "Confirm pain and timeline",
  preferred_cta: "a quick conversation about their callbacks",
  objections: ["price", "implementation", "partner approval"],
  guardrails: ["no unauthorized discounts", "no implementation commitments"],
};

const RICH_PROSPECT: CallStrategyProspectInput = {
  first_name: "John",
  last_name: "Smith",
  title: "Owner",
  company: "ABC Roofing",
  industry: "Roofing & Exteriors",
  size: "1-10",
  location: "Chicago, IL",
  tags: ["roofing"],
  source: "inbound",
};

describe("buildCallStrategy — full profile + rich prospect", () => {
  const result = buildCallStrategy({ profile: FULL_PROFILE, prospect: RICH_PROSPECT });

  it("returns the ready state with all sections populated", () => {
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.profileName).toBe("Roofing Practice");
    expect(result.context.name).toBe("John Smith");
    expect(result.context.summary).toBe(
      "John Smith · Owner at ABC Roofing · Roofing & Exteriors · 1-10 · Chicago, IL"
    );
    expect(result.context.tags).toEqual(["roofing"]);
  });

  it("builds an angle only from actual overlaps (industry/size/location/tag)", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.angle.present).toBe(true);
    const labels = result.angle.points.map((p) => p.label);
    expect(labels).toContain("Industry match");
    expect(labels).toContain("Company size match");
    expect(labels).toContain("Location match");
    expect(labels).toContain("Tag match: roofing");
    expect(result.angle.summary).toContain("John Smith looks like a fit");
  });

  it("labels pain hypotheses and only includes ones the record supports", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.painHypotheses.length).toBe(2);
    for (const h of result.painHypotheses) {
      expect(h.hypothesis.length).toBeGreaterThan(0);
      // Support must name a real reason (ideal-customer fit here).
      expect(h.support).toContain("ideal customer");
    }
  });

  it("uses the profile's call goal as the objective", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.objective).toEqual({
      text: "Confirm pain and timeline",
      source: "profile",
    });
  });

  it("builds a deterministic opener from benefits + preferred CTA + real name", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.opener.greeting).toBe("Hi John,");
    expect(result.opener.hook).toBe("I'm reaching out because faster callbacks.");
    expect(result.opener.cta).toBe(
      "Would you be open to a quick conversation about their callbacks?"
    );
    expect(result.opener.source).toBe("profile");
    expect(result.opener.note).toBeNull();
    expect(result.opener.text).toContain("Hi John,");
    expect(result.opener.text).toContain("faster callbacks");
  });

  it("returns a bounded (3-5), deterministic discovery question list", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.discoveryQuestions.length).toBe(5);
    expect(result.discoveryQuestions[0].question).toBe(
      "What's the impact of inconsistent callbacks on your business right now?"
    );
    expect(result.discoveryQuestions[1].question).toBe(
      "What have you tried so far to address slow follow-up on inbound leads?"
    );
    expect(result.discoveryQuestions[2].question).toBe(
      "What difference would faster callbacks make for you?"
    );
    expect(result.discoveryQuestions[3].question).toBe(
      "How are roofing companies handling this today?"
    );
    // The last two are clearly-labeled standard questions (deterministic).
    const bases = result.discoveryQuestions.map((q) => q.basis);
    expect(bases).toContain("Standard discovery");
    expect(new Set(bases).size).toBeGreaterThan(1);
  });

  it("lists up to three objections with only relevant guardrails attached", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.objectionsToExpect).toEqual([
      { objection: "price", relatedGuardrail: null },
      { objection: "implementation", relatedGuardrail: "no implementation commitments" },
      { objection: "partner approval", relatedGuardrail: null },
    ]);
    expect(result.guardrails).toEqual([
      "no unauthorized discounts",
      "no implementation commitments",
    ]);
  });

  it("uses the preferred CTA as the close instruction", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.close).toEqual({
      instruction: "a quick conversation about their callbacks",
      source: "profile",
      note: null,
    });
  });

  it("is deterministic: the same inputs produce identical output", () => {
    const again = buildCallStrategy({ profile: FULL_PROFILE, prospect: RICH_PROSPECT });
    expect(again).toEqual(result);
  });
});

describe("buildCallStrategy — sparse prospect (honest empty sections)", () => {
  const sparse: CallStrategyProspectInput = {
    first_name: "Pat",
    last_name: null,
    title: null,
    company: "Pat's Roofing",
    industry: null,
    size: null,
    location: null,
    tags: [],
    source: null,
  };
  const result = buildCallStrategy({ profile: FULL_PROFILE, prospect: sparse });

  it("keeps profile-driven sections populated", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.objective.source).toBe("profile");
    expect(result.discoveryQuestions.length).toBeGreaterThanOrEqual(3);
    expect(result.objectionsToExpect.length).toBe(3);
    expect(result.close.source).toBe("profile");
  });

  it("shows honest unknowns in context (no placeholder data)", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.context.name).toBe("Pat");
    expect(result.context.company).toBe("Pat's Roofing");
    expect(result.context.title).toBeNull();
    expect(result.context.industry).toBeNull();
    expect(result.context.size).toBeNull();
    expect(result.context.location).toBeNull();
    expect(result.context.tags).toEqual([]);
    expect(result.context.source).toBeNull();
    expect(result.context.summary).toBe("Pat · Pat's Roofing");
  });

  it("returns an honest no-angle state — never fabricates an angle", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.angle.present).toBe(false);
    expect(result.angle.points).toEqual([]);
    expect(result.angle.summary).toBeNull();
    expect(result.angle.note).toContain("no industry, size, location, or tags");
  });

  it("does NOT invent pain hypotheses without supporting prospect data", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.painHypotheses).toEqual([]);
  });

  it("greets with the real name — never fake personalization", () => {
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.opener.greeting).toBe("Hi Pat,");
  });

  it("falls back to a neutral opener only when the profile is empty", () => {
    const bareProfile: CallStrategyProfileInput = {
      name: null,
      product_name: null,
      description: null,
      benefits: null,
      problems_solved: null,
      differentiators: null,
      ideal_customer: null,
      call_goal: null,
      preferred_cta: null,
      objections: [],
      guardrails: [],
    };
    const bare = buildCallStrategy({ profile: bareProfile, prospect: sparse });
    if (bare.state !== "ready") throw new Error("expected ready");
    expect(bare.opener.source).toBe("template");
    expect(bare.opener.note).toContain("neutral");
    expect(bare.objective.source).toBe("default");
    expect(bare.close.source).toBe("template");
    expect(bare.angle.present).toBe(false);
    expect(bare.painHypotheses).toEqual([]);
    expect(bare.objectionsToExpect).toEqual([]);
  });
});

describe("buildCallStrategy — no Sales Profile", () => {
  it("returns the onboarding-required state with a clear reason", () => {
    const result = buildCallStrategy({ profile: null, prospect: RICH_PROSPECT });
    expect(result.state).toBe("onboarding_required");
    if (result.state !== "onboarding_required") throw new Error("expected state");
    expect(result.reason).toContain("Complete your Sales Profile");
  });
});

describe("buildCallStrategy — Zod output validation", () => {
  it("every builder result parses the callStrategySchema", () => {
    const cases = [
      buildCallStrategy({ profile: FULL_PROFILE, prospect: RICH_PROSPECT }),
      buildCallStrategy({ profile: FULL_PROFILE, prospect: null }),
      buildCallStrategy({
        profile: FULL_PROFILE,
        prospect: { first_name: "X", last_name: null, title: null, company: null, industry: null, size: null, location: null, tags: [], source: null },
      }),
      buildCallStrategy({ profile: null, prospect: RICH_PROSPECT }),
      buildCallStrategy({ profile: null, prospect: null }),
    ];
    for (const result of cases) {
      expect(callStrategySchema.safeParse(result).success).toBe(true);
    }
  });

  it("the schema rejects a malformed shape (never trusted silently)", () => {
    const parsed = callStrategySchema.safeParse({
      state: "ready",
      profileName: "X",
      context: { name: "N" }, // missing required fields
    });
    expect(parsed.success).toBe(false);
  });
});
