import { describe, expect, it } from "vitest";
import {
  assertUuid,
  InvalidUuidError,
  isUuid,
  requireUuid,
  UUID_DISCIPLINE,
} from "@/domain/utils/uuid";
import { formatDuration, toDurationSeconds } from "@/domain/utils/format";
import { compactStringList, dropBlankStrings } from "@/domain/utils/lists";
import { nextUuid } from "./helpers";

describe("uuid helpers", () => {
  it("accepts canonical UUID strings", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuid(nextUuid())).toBe(true);
    expect(isUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(true); // case-insensitive
  });

  it("rejects non-UUID values (never Number(id)/parseInt(id))", () => {
    for (const bad of ["123", "abc", "", "550e8400", "550e8400-e29b-41d4-a716", 42, null, undefined, {}, "550e8400-e29b-41d4-a716-44665544000g"]) {
      expect(isUuid(bad)).toBe(false);
    }
    // The discipline constant documents the rule.
    expect(UUID_DISCIPLINE).toContain("never Number(id)");
  });

  it("assertUuid returns the id and throws InvalidUuidError otherwise", () => {
    const id = nextUuid();
    expect(assertUuid(id)).toBe(id);
    expect(requireUuid(id, "prospectId")).toBe(id);
    expect(() => assertUuid("nope")).toThrow(InvalidUuidError);
    expect(() => requireUuid(12345, "callId")).toThrowError(/UUID/);
    try {
      assertUuid("nope", "prospectId");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidUuidError);
      expect((error as InvalidUuidError).category).toBe("INVALID_UUID");
      expect((error as InvalidUuidError).message).toContain("prospectId");
    }
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(999)).toBe("0s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(750_000)).toBe("12m 30s");
    expect(formatDuration(3_723_000)).toBe("1h 02m");
  });

  it("clamps negative and non-finite input", () => {
    expect(formatDuration(-5_000)).toBe("0s");
    expect(formatDuration(Number.NaN)).toBe("0s");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0s");
  });

  it("converts to whole seconds for the DB column", () => {
    expect(toDurationSeconds(750_000)).toBe(750);
    expect(toDurationSeconds(-1)).toBe(0);
  });
});

describe("compactStringList", () => {
  it("trims, drops blanks, and dedupes case-insensitively", () => {
    expect(
      compactStringList(["  Price  ", "price", "", "   ", "No time", null, undefined, "no time"])
    ).toEqual(["Price", "No time"]);
  });

  it("keeps first occurrence when deduping", () => {
    expect(compactStringList(["Price", "price concern", "PRICE"])).toEqual([
      "Price",
      "price concern",
    ]);
  });

  it("honors max and disables dedupe on request", () => {
    expect(compactStringList(["a", "b", "a", "c"], { max: 2 })).toEqual(["a", "b"]);
    expect(compactStringList(["a", "A"], { dedupe: false })).toEqual(["a", "A"]);
  });

  it("dropBlankStrings removes only blanks", () => {
    expect(dropBlankStrings(["a", "", "  ", "b", null])).toEqual(["a", "b"]);
  });
});
