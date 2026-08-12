// M9a — Settings data mapping: account info + Sales Profile status, mapped
// from stored auth/profile rows. Missing values stay null — never invented.
import { describe, expect, it } from "vitest";
import { mapAccountInfo, salesProfileStatus } from "@/lib/dashboard/settings";

describe("mapAccountInfo", () => {
  it("maps stored email/display name/timezone onto the Account card", () => {
    expect(
      mapAccountInfo({
        email: "alex@signaldesk.test",
        displayName: "Alex Rivera",
        timezone: "America/New_York",
      })
    ).toEqual({
      email: "alex@signaldesk.test",
      displayName: "Alex Rivera",
      timezone: "America/New_York",
    });
  });

  it("trims whitespace and never fabricates missing values", () => {
    expect(
      mapAccountInfo({
        email: "  alex@signaldesk.test  ",
        displayName: "",
        timezone: null,
      })
    ).toEqual({
      email: "alex@signaldesk.test",
      displayName: null,
      timezone: null,
    });
    expect(mapAccountInfo({ email: undefined, displayName: "  ", timezone: undefined })).toEqual({
      email: null,
      displayName: null,
      timezone: null,
    });
  });
});

describe("salesProfileStatus", () => {
  it("reports complete only for the stored complete onboarding state", () => {
    const complete = salesProfileStatus("complete");
    expect(complete.status).toBe("complete");
    expect(complete.label).toBe("Complete");
    expect(complete.description).toContain("complete");
    expect(complete.description).toContain("edit it any time");
  });

  it("reports needs completion for any other (or missing) state", () => {
    for (const state of ["not_started", null, undefined, ""]) {
      const info = salesProfileStatus(state);
      expect(info.status).toBe("needs_completion");
      expect(info.label).toBe("Needs completion");
      expect(info.description).toContain("unlocks live coaching");
    }
  });
});
