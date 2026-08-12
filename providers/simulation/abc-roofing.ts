// ABC Roofing — deterministic Phase 1 simulation fixture.
//
// SIMULATED: every record produced by this scenario is clearly labeled
// simulated (call_sessions.is_simulated = true; SimulationScenario.simulated
// = true). No real audio, no transcription, no production AI.
//
// Spec flow (SIGNALDESK_SPEC.md "ABC Roofing fixture"):
//   John is busy, explains inconsistent callbacks, admits prospects hire
//   competitors, estimates four or five missed jobs, raises a $500 price
//   concern. SignalDesk explores speed and impact, says LISTEN while pain is
//   explained, then recommends a VALUE QUESTION rather than a discount. John
//   asks about onboarding, wants a solution within 30 days, confirms he is
//   the owner, and says his partner reviews recurring costs. SignalDesk
//   recommends a joint demo; John checks Wednesday; the coach says to confirm
//   without pushing.
//
// Timing is deliberate: the M4 intervention policy enforces a 30s suggestion
// cooldown (and a 90s suggestion TTL), so turn times are spaced so the
// required beats fire: LISTEN @45s, ASK value @75s, SAY (onboarding) @105s,
// DO_NOT_PUSH (joint demo) @200s, DO_NOT_PUSH (confirm Wednesday) @230s.
// The opening pain turns (15s-25s) intentionally fall inside the initial
// cooldown — a real no-intervention / calm-listening stretch.
import type { SimulationScenario } from "@/domain/simulation/types";

export const ABC_ROOFING_SCENARIO_ID = "8f7c4f0e-2f9a-4b3c-9d1e-6a0b2c3d4e5f";

export const abcRoofingScenario: SimulationScenario = {
  id: ABC_ROOFING_SCENARIO_ID,
  label: "ABC Roofing — practice call",
  simulated: true,
  prospectName: "John Smith",
  prospectCompany: "ABC Roofing",
  summary:
    "ABC Roofing is losing four or five jobs a year to slow callbacks. John (owner) raises a $500/month price concern; the rep quantifies value before defending price. John wants a solution live within 30 days and checked Wednesday for a joint demo with his partner.",
  callObjective: "Discover the impact of slow callbacks and qualify next steps.",
  guardrails: ["no unauthorized discounts", "no ROI guarantees"],
  turns: [
    {
      key: "greeting",
      speaker: "rep",
      text: "Hi John, this is Alex from SignalDesk. Thanks for taking a few minutes — is now still a good time?",
      relativeTimeMs: 0,
    },
    {
      key: "busy-but-takes-call",
      speaker: "prospect",
      text: "Yeah, I've got about twenty minutes before my next callback.",
      relativeTimeMs: 5_000,
    },
    {
      key: "opening-question",
      speaker: "rep",
      text: "Great — to start, how do new customer inquiries reach you these days?",
      relativeTimeMs: 10_000,
    },
    {
      key: "slow-callbacks",
      speaker: "prospect",
      text: "Mostly the website and some referrals. But honestly, we're slow to get back to people — sometimes it takes a couple of days to return a call.",
      relativeTimeMs: 15_000,
      events: [{ type: "PAIN_DISCOVERED", metadata: { facet: "pain" } }],
      stage: "discovery",
    },
    {
      key: "competitors",
      speaker: "prospect",
      text: "A couple of times, folks got frustrated waiting and hired another roofer before I ever called them back.",
      relativeTimeMs: 20_000,
      events: [{ type: "COMPETITOR_MENTION" }],
    },
    {
      key: "missed-jobs",
      speaker: "prospect",
      text: "I figure that's four or five jobs we've lost this year because of it.",
      relativeTimeMs: 25_000,
      events: [{ type: "PAIN_DISCOVERED", metadata: { facet: "impact" } }],
    },
    {
      key: "ask-permission",
      speaker: "rep",
      text: "That's useful — mind if I ask a couple of questions about how callbacks affect your business?",
      relativeTimeMs: 35_000,
    },
    {
      key: "elaborate-pain",
      speaker: "prospect",
      text: "Sure. And when we do finally reach people, a lot of them have already made up their mind.",
      relativeTimeMs: 45_000,
      events: [{ type: "PAIN_DISCOVERED", metadata: { facet: "pain" } }],
    },
    {
      key: "second-call",
      speaker: "prospect",
      text: "I'd say half the time we're the second company they talk to.",
      relativeTimeMs: 55_000,
    },
    {
      key: "price-concern",
      speaker: "prospect",
      text: "We'd love to fix it, but your price — five hundred a month — is more than I was expecting. Is there any flexibility?",
      relativeTimeMs: 75_000,
      events: [
        {
          type: "PRICE_DISCUSSION",
          metadata: { objectionType: "price", isConcern: true },
        },
      ],
      suggestionText: "About how much is one new customer worth to the business?",
      suggestionReason: "Quantify value before defending price.",
    },
    {
      key: "rep-value-question",
      speaker: "rep",
      text: "I hear you. Before we get to that — about how much is one new customer worth to the business over the first year?",
      relativeTimeMs: 85_000,
    },
    {
      key: "value-answer",
      speaker: "prospect",
      text: "Each new customer is worth five to eight thousand to us in the first year.",
      relativeTimeMs: 95_000,
    },
    {
      key: "onboarding-question",
      speaker: "prospect",
      text: "How does onboarding actually work? Would it take long to get set up?",
      relativeTimeMs: 105_000,
      events: [{ type: "QUESTION" }],
    },
    {
      key: "rep-onboarding-answer",
      speaker: "rep",
      text: "Onboarding is straightforward — we get you live within a week, and the first calls are guided.",
      relativeTimeMs: 115_000,
    },
    {
      key: "timeline-30-days",
      speaker: "prospect",
      text: "We'd want a solution live within 30 days — by mid-month at the latest.",
      relativeTimeMs: 120_000,
      events: [{ type: "TIMELINE_SIGNAL" }],
    },
    {
      key: "rep-decision-question",
      speaker: "rep",
      text: "Understood. Who's involved in the decision on something like this?",
      relativeTimeMs: 130_000,
    },
    {
      key: "owner",
      speaker: "prospect",
      text: "I'm the owner — the final call is mine.",
      relativeTimeMs: 135_000,
      events: [{ type: "AUTHORITY_SIGNAL" }],
      stage: "qualification",
    },
    {
      key: "partner-costs",
      speaker: "prospect",
      text: "My partner handles the books, so she reviews the recurring costs.",
      relativeTimeMs: 140_000,
      events: [{ type: "AUTHORITY_SIGNAL" }],
    },
    {
      key: "rep-explore-value",
      speaker: "rep",
      text: "And if we could fix the callback problem, what would that mean for the business?",
      relativeTimeMs: 150_000,
    },
    {
      key: "buying-signal-demo",
      speaker: "prospect",
      text: "Honestly, cutting our callback time alone would be worth it to us.",
      relativeTimeMs: 200_000,
      events: [{ type: "BUYING_SIGNAL" }],
      suggestionText:
        "Acknowledge the signal, then propose a joint demo with his partner — a 30-minute walkthrough of how SignalDesk handles a real inbound flow.",
      suggestionReason: "Buying signal — confirm interest and propose the next step without pushing.",
      stage: "closing",
    },
    {
      key: "rep-proposes-demo",
      speaker: "rep",
      text: "Great — would a 30-minute demo with you and your partner work next week?",
      relativeTimeMs: 210_000,
    },
    {
      key: "check-with-partner",
      speaker: "prospect",
      text: "Let me check with my partner and get back to you.",
      relativeTimeMs: 215_000,
    },
    {
      key: "wednesday-check",
      speaker: "prospect",
      text: "Wednesday works for both of us — let's get it on the books.",
      relativeTimeMs: 230_000,
      events: [{ type: "BUYING_SIGNAL", metadata: { nextStepCommitment: true } }],
      suggestionText: "Confirm Wednesday without pushing — don't oversell; let them come to you.",
      suggestionReason: "Next-step commitment — confirm without pushing.",
    },
  ],
};
