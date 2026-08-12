import { describe, expect, it } from "vitest";
import {
  compareEventPrecedence,
  DEFAULT_EVENT_CATEGORY,
  EVENT_IMPORTANCE_HINT,
  EVENT_PRIORITY,
  EVENT_TYPES,
  sortEventsByPrecedence,
} from "@/domain/events/taxonomy";
import { makeEvent } from "./helpers";

describe("event taxonomy", () => {
  it("exposes exactly the nine spec event types", () => {
    expect(EVENT_TYPES).toEqual([
      "OBJECTION",
      "QUESTION",
      "BUYING_SIGNAL",
      "PRICE_DISCUSSION",
      "COMPETITOR_MENTION",
      "PAIN_DISCOVERED",
      "AUTHORITY_SIGNAL",
      "TIMELINE_SIGNAL",
      "MISSED_DISCOVERY",
    ]);
    expect(Object.keys(EVENT_PRIORITY).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("orders priority per the spec preference list", () => {
    // timely prospect questions > high-priority objections > LISTEN > buying
    // signals > missed discovery
    expect(EVENT_PRIORITY.QUESTION).toBeGreaterThan(EVENT_PRIORITY.OBJECTION);
    expect(EVENT_PRIORITY.OBJECTION).toBeGreaterThan(EVENT_PRIORITY.PRICE_DISCUSSION);
    expect(EVENT_PRIORITY.PRICE_DISCUSSION).toBeGreaterThan(EVENT_PRIORITY.PAIN_DISCOVERED);
    expect(EVENT_PRIORITY.PAIN_DISCOVERED).toBeGreaterThan(EVENT_PRIORITY.BUYING_SIGNAL);
    expect(EVENT_PRIORITY.BUYING_SIGNAL).toBeGreaterThan(EVENT_PRIORITY.MISSED_DISCOVERY);
    expect(EVENT_PRIORITY.MISSED_DISCOVERY).toBeGreaterThan(EVENT_PRIORITY.COMPETITOR_MENTION);
  });

  it("assigns every event type a default category", () => {
    for (const type of EVENT_TYPES) {
      expect(["positive", "negative", "neutral"]).toContain(DEFAULT_EVENT_CATEGORY[type]);
      expect(EVENT_IMPORTANCE_HINT[type]).toBeGreaterThanOrEqual(0);
      expect(EVENT_IMPORTANCE_HINT[type]).toBeLessThanOrEqual(10);
    }
  });
});

describe("event precedence ordering", () => {
  it("sorts by priority first", () => {
    const question = makeEvent("QUESTION", "prospect", "How does onboarding work?", { relativeTimeMs: 200_000 });
    const objection = makeEvent("OBJECTION", "prospect", "That is too expensive.", { relativeTimeMs: 100_000 });
    const sorted = sortEventsByPrecedence([objection, question]);
    expect(sorted[0].type).toBe("QUESTION");
    expect(compareEventPrecedence(question, objection)).toBeLessThan(0);
  });

  it("breaks priority ties by importance", () => {
    const low = makeEvent("OBJECTION", "prospect", "a", { importance: 3 });
    const high = makeEvent("OBJECTION", "prospect", "b", { importance: 9 });
    expect(compareEventPrecedence(high, low)).toBeLessThan(0);
  });

  it("breaks importance ties by recency (most recent first)", () => {
    const older = makeEvent("BUYING_SIGNAL", "prospect", "a", { importance: 6, relativeTimeMs: 100_000 });
    const newer = makeEvent("BUYING_SIGNAL", "prospect", "b", { importance: 6, relativeTimeMs: 250_000 });
    expect(compareEventPrecedence(newer, older)).toBeLessThan(0);
    const sorted = sortEventsByPrecedence([older, newer]);
    expect(sorted[0]).toBe(newer);
  });

  it("does not mutate the input array", () => {
    const events = [makeEvent("QUESTION", "prospect", "q"), makeEvent("OBJECTION", "prospect", "o")];
    const copy = [...events];
    sortEventsByPrecedence(events);
    expect(events).toEqual(copy);
  });
});
