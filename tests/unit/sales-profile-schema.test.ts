import { describe, expect, it } from "vitest";

import {
  accountSettingsSchema,
  compactList,
  forgotPasswordSchema,
  GUARDRAIL_EXAMPLES,
  loginSchema,
  OBJECTION_DEFAULTS,
  salesProfileSchema,
  signupSchema,
  textOrNull,
} from "@/lib/sales-profile/schema";

describe("spec defaults", () => {
  it("offers the spec's eight objection defaults", () => {
    expect([...OBJECTION_DEFAULTS]).toEqual([
      "price",
      "existing vendor",
      "not interested",
      "need to think",
      "partner approval",
      "no time",
      "bad timing",
      "send information",
    ]);
  });

  it("offers the spec's five guardrail examples", () => {
    expect([...GUARDRAIL_EXAMPLES]).toEqual([
      "no unauthorized discounts",
      "no ROI guarantees",
      "no legal claims",
      "no invented features",
      "no implementation commitments",
    ]);
  });
});

describe("salesProfileSchema", () => {
  const valid = {
    product_name: "RoofGuard CRM",
    description: "A simple CRM for roofing contractors.",
    pricing: "per-seat monthly",
    ideal_customer: "Roofing companies with 5-50 employees",
    benefits: "Fewer missed callbacks",
    problems_solved: "Slow inbound follow-up",
    differentiators: "Built for roofers",
    call_goal: "Qualify and book a demo",
    preferred_cta: "Book a demo",
    sales_process: "Discovery, demo, proposal",
    objections: ["price", "no time"],
    guardrails: ["no unauthorized discounts", "no ROI guarantees"],
  };

  it("accepts a complete profile", () => {
    const result = salesProfileSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires product_name", () => {
    expect(salesProfileSchema.safeParse({ ...valid, product_name: "" }).success).toBe(false);
    expect(salesProfileSchema.safeParse({ ...valid, product_name: "   " }).success).toBe(false);
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.product_name;
    expect(salesProfileSchema.safeParse(rest).success).toBe(false);
  });

  it("treats every other field as optional — blank stays blank, never fiction", () => {
    const minimal = { product_name: "RoofGuard CRM" };
    const result = salesProfileSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.objections).toBeUndefined();
      expect(result.data.guardrails).toBeUndefined();
    }
  });

  it("allows empty strings in list fields (rows the user left blank)", () => {
    const result = salesProfileSchema.safeParse({
      ...valid,
      guardrails: ["no ROI guarantees", ""],
    });
    expect(result.success).toBe(true);
  });

  it("rejects too many list entries", () => {
    const objections = Array.from({ length: 25 }, (_, i) => `objection ${i}`);
    expect(salesProfileSchema.safeParse({ ...valid, objections }).success).toBe(false);
  });

  it("rejects over-long list entries and product names", () => {
    expect(
      salesProfileSchema.safeParse({
        ...valid,
        guardrails: ["x".repeat(201)],
      }).success
    ).toBe(false);
    expect(
      salesProfileSchema.safeParse({ ...valid, product_name: "x".repeat(121) }).success
    ).toBe(false);
  });
});

describe("auth schemas", () => {
  it("signupSchema validates email, password length and display name", () => {
    expect(signupSchema.safeParse({ display_name: "Alex", email: "a@b.com", password: "password1" }).success).toBe(true);
    expect(signupSchema.safeParse({ display_name: "", email: "a@b.com", password: "password1" }).success).toBe(false);
    expect(signupSchema.safeParse({ display_name: "Alex", email: "not-an-email", password: "password1" }).success).toBe(false);
    expect(signupSchema.safeParse({ display_name: "Alex", email: "a@b.com", password: "short" }).success).toBe(false);
    expect(signupSchema.safeParse({ display_name: "Alex", email: "a@b.com", password: "" }).success).toBe(false);
  });

  it("loginSchema requires email and password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "password1" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "nope", password: "password1" }).success).toBe(false);
  });

  it("forgotPasswordSchema validates the email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
    expect(forgotPasswordSchema.safeParse({ email: "" }).success).toBe(false);
  });

  it("accountSettingsSchema keeps display name and timezone optional", () => {
    expect(accountSettingsSchema.safeParse({}).success).toBe(true);
    expect(accountSettingsSchema.safeParse({ display_name: "", timezone: "" }).success).toBe(true);
    expect(accountSettingsSchema.safeParse({ display_name: "Alex", timezone: "America/New_York" }).success).toBe(true);
    expect(accountSettingsSchema.safeParse({ display_name: "x".repeat(81) }).success).toBe(false);
    expect(accountSettingsSchema.safeParse({ timezone: "x".repeat(65) }).success).toBe(false);
  });
});

describe("compactList and textOrNull", () => {
  it("drops blanks, trims, and dedupes case-insensitively", () => {
    expect(compactList([" Price ", "", "  ", null, "price", "no time", undefined])).toEqual([
      "Price",
      "no time",
    ]);
    expect(compactList([])).toEqual([]);
    expect(compactList(null)).toEqual([]);
    expect(compactList(undefined)).toEqual([]);
  });

  it("textOrNull converts blank/whitespace to null", () => {
    expect(textOrNull("  Value  ")).toBe("Value");
    expect(textOrNull("")).toBeNull();
    expect(textOrNull("   ")).toBeNull();
    expect(textOrNull(null)).toBeNull();
    expect(textOrNull(undefined)).toBeNull();
  });
});
