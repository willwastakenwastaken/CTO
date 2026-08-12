// M8a — prospect form / note / stage-change / list-query Zod schemas.
import { describe, expect, it } from "vitest";
import {
  nextActionSchema,
  noteSchema,
  prospectFormSchema,
  prospectListQuerySchema,
  stageChangeSchema,
} from "@/lib/prospects/schema";

describe("prospectFormSchema", () => {
  it("accepts a rich, fully populated prospect", () => {
    const result = prospectFormSchema.safeParse({
      first_name: "John",
      last_name: "Smith",
      title: "Owner",
      email: "john@abcroofing.com",
      phone: "555-0100",
      company: "ABC Roofing",
      website: "https://abcroofing.example",
      industry: "Roofing & Exteriors",
      size: "1-10",
      location: "Chicago, IL",
      stage: "contacted",
      next_action: "Send pricing overview",
      next_action_due_date: "2026-09-01",
      tags: ["inbound", "decision-maker"],
      source: "inbound",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stage).toBe("contacted");
      expect(result.data.tags).toEqual(["inbound", "decision-maker"]);
    }
  });

  it("accepts a minimal prospect (first name only)", () => {
    const result = prospectFormSchema.safeParse({ first_name: "Pat" });
    expect(result.success).toBe(true);
  });

  it("rejects a prospect with no name and no company", () => {
    const result = prospectFormSchema.safeParse({ email: "x@y.com" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "first_name")).toBe(true);
    }
  });

  it("rejects an invalid email when one is provided", () => {
    const result = prospectFormSchema.safeParse({
      first_name: "Pat",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "email")).toBe(true);
    }
  });

  it("accepts a blank email (blank = unknown)", () => {
    const result = prospectFormSchema.safeParse({ first_name: "Pat", email: "" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid website when one is provided", () => {
    const result = prospectFormSchema.safeParse({
      first_name: "Pat",
      website: "not-a-url",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "website")).toBe(true);
    }
  });

  it("rejects a malformed due date", () => {
    const result = prospectFormSchema.safeParse({
      first_name: "Pat",
      next_action_due_date: "2026-13-99",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "next_action_due_date")).toBe(true);
    }
  });

  it("rejects a stage outside the allowed enum", () => {
    const result = prospectFormSchema.safeParse({
      first_name: "Pat",
      stage: "not_a_stage",
    });
    expect(result.success).toBe(false);
  });
});

describe("stageChangeSchema", () => {
  it("accepts a valid transition input", () => {
    const result = stageChangeSchema.safeParse({
      targetStage: "qualified",
      expectedStage: "contacted",
      confirmed: false,
    });
    expect(result.success).toBe(true);
  });

  it("confirmation is optional (defaults to not confirmed)", () => {
    const result = stageChangeSchema.safeParse({
      targetStage: "closed_won",
      expectedStage: "meeting_booked",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid target stage", () => {
    const result = stageChangeSchema.safeParse({
      targetStage: "won",
      expectedStage: "contacted",
    });
    expect(result.success).toBe(false);
  });
});

describe("nextActionSchema", () => {
  it("accepts a next action with a due date", () => {
    const result = nextActionSchema.safeParse({
      next_action: "Book a demo",
      next_action_due_date: "2026-09-15",
    });
    expect(result.success).toBe(true);
  });

  it("accepts clearing both fields (blank = no next action)", () => {
    const result = nextActionSchema.safeParse({
      next_action: "",
      next_action_due_date: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed due date", () => {
    const result = nextActionSchema.safeParse({
      next_action: "Book a demo",
      next_action_due_date: "soon",
    });
    expect(result.success).toBe(false);
  });
});

describe("noteSchema", () => {
  it("requires a title", () => {
    expect(noteSchema.safeParse({ title: "", body: "" }).success).toBe(false);
    expect(noteSchema.safeParse({ title: " ", body: "x" }).success).toBe(false);
  });

  it("accepts a note with title and body", () => {
    const result = noteSchema.safeParse({
      title: "Prefers email over phone",
      body: "Wants a written recap after calls.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a title-only note", () => {
    expect(noteSchema.safeParse({ title: "Decision-maker is the owner" }).success).toBe(true);
  });
});

describe("prospectListQuerySchema", () => {
  it("parses valid search/filter/sort inputs", () => {
    const result = prospectListQuerySchema.safeParse({
      q: "roof",
      stage: "contacted",
      sort: "company",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ q: "roof", stage: "contacted", sort: "company" });
    }
  });

  it("accepts an empty query", () => {
    expect(prospectListQuerySchema.safeParse({}).success).toBe(true);
  });

  it("rejects an invalid stage and an invalid sort", () => {
    expect(prospectListQuerySchema.safeParse({ stage: "bogus" }).success).toBe(false);
    expect(prospectListQuerySchema.safeParse({ sort: "bogus" }).success).toBe(false);
  });
});
