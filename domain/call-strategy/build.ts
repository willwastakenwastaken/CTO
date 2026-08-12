// Call Strategy builder — a pure, deterministic function that turns the Sales
// Profile + prospect rows into the pre-call brief. No I/O, no randomness, no
// fabrication:
//
//  * context          — the prospect's own saved fields, honestly labeled;
//                       unknown fields stay null ("—" in the UI).
//  * angle            — overlaps between the prospect's industry/size/location/
//                       tags and the profile's ideal customer / benefits /
//                       differentiators / description. Nothing inferable -> an
//                       honest "no angle yet" state, never invented.
//  * painHypotheses   — problem sentences from problems_solved, included ONLY
//                       when the prospect record or an ideal-customer fit
//                       supports them. Every item is labeled a hypothesis.
//  * objective        — profile.call_goal, or an honest neutral default.
//  * opener           — deterministic template from benefits/preferred_cta +
//                       the prospect's real name. No fake personalization.
//  * discoveryQuestions — bounded (<= 5), deterministic order: profile-derived
//                       first, then clearly-labeled standard discovery
//                       questions. Grammar-safe templates (topics embedded as
//                       noun phrases, lead-ins stripped deterministically).
//  * objectionsToExpect — the profile's objections (up to 3), with any
//                       guardrail that demonstrably relates (word overlap).
//  * close            — preferred_cta verbatim (it IS the rep's instruction),
//                       or a neutral template when absent.
//
// When no Sales Profile exists the builder returns the onboarding-required
// state; the UI then links to /settings/sales-profile.
import { parseIdealCustomer } from "@/lib/prospects/ideal-customer";
import {
  callStrategySchema,
  type AnglePoint,
  type CallStrategyProfileInput,
  type CallStrategyProspectInput,
  type CallStrategyReady,
  type CallStrategyResult,
  type DiscoveryQuestion,
  type ExpectedObjection,
  type PainHypothesis,
} from "@/domain/call-strategy/types";

const MAX_PAIN_HYPOTHESES = 4;
const MAX_EXPECTED_OBJECTIONS = 3;
const MAX_DISCOVERY_QUESTIONS = 5;

// ---------------------------------------------------------------------------
// Text helpers (deterministic)
// ---------------------------------------------------------------------------

/** Trims + nulls a free-text value (blank = unknown). */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Splits free text into sentence-ish fragments on ; . and newlines. */
function sentences(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/[.;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

/** Lead-in phrases stripped from problem/benefit sentences so the remaining
 * topic reads as a noun phrase (e.g. "We help contractors win more jobs" ->
 * "contractors win more jobs"). Longest first so longer phrases win. */
const LEAD_INS = [
  "the problem we solve is",
  "we help our customers with",
  "we help customers with",
  "we help our clients with",
  "we help clients with",
  "we solve the problem of",
  "our customers struggle with",
  "our clients struggle with",
  "customers struggle with",
  "clients struggle with",
  "our customers deal with",
  "our clients deal with",
  "customers deal with",
  "clients deal with",
  "our customers face",
  "our clients face",
  "customers face",
  "the problem is",
  "we solve",
  "we fix",
  "we provide",
  "we offer",
  "we deliver",
  "our product",
  "our service",
  "your business gets",
  "you get",
].sort((a, b) => b.length - a.length);

/** Lowercases the first letter ("Faster callbacks" -> "faster callbacks")
 * because topics are embedded mid-sentence. */
function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/** First sentence of a field with lead-ins stripped, as an embedded topic. */
function topicOf(text: string | null | undefined): string | null {
  const first = sentences(text)[0];
  if (!first) return null;
  let topic = first;
  const lowered = first.toLowerCase();
  for (const lead of LEAD_INS) {
    if (lowered.startsWith(lead)) {
      topic = first.slice(lead.length).trim();
      break;
    }
  }
  topic = topic.replace(/[.!?]+$/, "").trim();
  return topic ? lowercaseFirst(topic) : null;
}

/** Words (>= 3 chars) of a piece of text, lowercased + deduped. */
function words(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3)
    ),
  ];
}

/** Loose substring/word overlap — the honest "could relate" test. */
function relates(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la.includes(lb) || lb.includes(la)) return true;
  const wa = words(a);
  const wb = words(b);
  return wa.some((w) => wb.includes(w));
}

/** Company-size comparison: normalize to digits/signs ("1-10 employees" ==
 * "1-10"). */
function sizeKey(value: string): string {
  return value.toLowerCase().replace(/[^0-9+\-]/g, "");
}

// ---------------------------------------------------------------------------
// Section builders (each returns Zod-shaped data)
// ---------------------------------------------------------------------------

function buildContext(prospect: CallStrategyProspectInput): CallStrategyReady["context"] {
  const first = clean(prospect.first_name);
  const last = clean(prospect.last_name);
  const company = clean(prospect.company);
  const title = clean(prospect.title);
  const name = [first, last].filter(Boolean).join(" ").trim() || company || "Unnamed prospect";

  const parts = [
    first || last ? name : null,
    title && company ? `${title} at ${company}` : title ?? company,
    clean(prospect.industry),
    clean(prospect.size),
    clean(prospect.location),
  ].filter(Boolean);

  return {
    name,
    company,
    title,
    industry: clean(prospect.industry),
    size: clean(prospect.size),
    location: clean(prospect.location),
    tags: prospect.tags.map((t) => t.trim()).filter(Boolean),
    source: clean(prospect.source),
    summary: parts.length > 0 ? parts.join(" · ") : null,
  };
}

function buildAngle(
  profile: CallStrategyProfileInput,
  prospect: CallStrategyProspectInput
): { angle: CallStrategyReady["angle"]; idealFit: boolean } {
  const ideal = parseIdealCustomer(profile.ideal_customer);
  const idealText = clean(profile.ideal_customer)?.toLowerCase() ?? "";
  const industry = clean(prospect.industry);
  const size = clean(prospect.size);
  const location = clean(prospect.location);
  const tags = prospect.tags.map((t) => t.trim()).filter(Boolean);

  const points: AnglePoint[] = [];
  let idealFit = false;

  if (industry && (ideal?.industries ?? []).some((i) => relates(industry, i))) {
    points.push({
      label: "Industry match",
      detail: `“${industry}” aligns with your stated ideal customer.`,
    });
    idealFit = true;
  }
  if (size && (ideal?.sizes ?? []).some((s) => sizeKey(size) === sizeKey(s))) {
    points.push({
      label: "Company size match",
      detail: `“${size}” fits your ideal company size.`,
    });
    idealFit = true;
  }
  if (location && idealText && relates(location, idealText)) {
    points.push({
      label: "Location match",
      detail: `“${location}” is inside your target geography.`,
    });
    idealFit = true;
  }
  const profileText = [
    profile.benefits,
    profile.differentiators,
    profile.description,
    profile.ideal_customer,
    profile.product_name,
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
  for (const tag of tags) {
    if (tag.length >= 2 && profileText.includes(tag.toLowerCase())) {
      points.push({
        label: `Tag match: ${tag}`,
        detail: `This prospect is tagged “${tag}”, which your profile mentions.`,
      });
    }
  }

  if (points.length > 0) {
    const who =
      [clean(prospect.first_name), clean(prospect.last_name)].filter(Boolean).join(" ").trim() ||
      clean(prospect.company) ||
      "This prospect";
    return {
      angle: {
        present: true,
        summary: `${who} looks like a fit: ${points.map((p) => p.label).join(", ")}.`,
        points,
        note: null,
      },
      idealFit,
    };
  }

  const hasProspectSignals =
    Boolean(industry || size || location) || tags.length > 0;
  const note = hasProspectSignals
    ? "No angle yet — this prospect's industry, size, location, or tags don't overlap with your ideal customer or profile content."
    : "No angle yet — this prospect has no industry, size, location, or tags recorded to compare against your profile.";
  return { angle: { present: false, summary: null, points: [], note }, idealFit: false };
}

function buildPainHypotheses(
  profile: CallStrategyProfileInput,
  prospect: CallStrategyProspectInput,
  idealFit: boolean
): PainHypothesis[] {
  const pains = sentences(profile.problems_solved);
  if (pains.length === 0) return [];

  const signals: Array<{ kind: string; value: string }> = [];
  const industry = clean(prospect.industry);
  const size = clean(prospect.size);
  if (industry) signals.push({ kind: "industry", value: industry });
  if (size) signals.push({ kind: "company size", value: size });
  for (const tag of prospect.tags.map((t) => t.trim()).filter(Boolean)) {
    signals.push({ kind: "tag", value: tag });
  }

  const out: PainHypothesis[] = [];
  const used = new Set<string>();
  for (const pain of pains) {
    if (out.length >= MAX_PAIN_HYPOTHESES) break;
    const direct = signals.find((s) => relates(pain, s.value));
    if (direct) {
      out.push({
        hypothesis: pain,
        support: `This prospect's ${direct.kind} (“${direct.value}”) relates to this problem area.`,
      });
      used.add(pain);
    }
  }
  // A prospect that fits the ideal customer is a weaker but honest support:
  // these are the companies the problem usually shows up for.
  if (idealFit) {
    for (const pain of pains) {
      if (out.length >= MAX_PAIN_HYPOTHESES) break;
      if (used.has(pain)) continue;
      out.push({
        hypothesis: pain,
        support:
          "This prospect fits your ideal customer — a profile where this problem typically shows up.",
      });
    }
  }
  return out;
}

function buildObjective(profile: CallStrategyProfileInput): CallStrategyReady["objective"] {
  const goal = clean(profile.call_goal);
  if (goal) return { text: goal, source: "profile" };
  return {
    text: "Discover whether this prospect is a fit and agree on a clear next step.",
    source: "default",
  };
}

function buildOpener(
  profile: CallStrategyProfileInput,
  prospect: CallStrategyProspectInput
): CallStrategyReady["opener"] {
  const firstName = clean(prospect.first_name);
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const hookTopic = topicOf(profile.benefits);
  const hook = hookTopic ? `I'm reaching out because ${hookTopic}.` : null;
  const ctaText = clean(profile.preferred_cta);
  const cta = ctaText ? `Would you be open to ${lowercaseFirst(ctaText)}?` : null;

  const product = clean(profile.product_name);
  const fallbackLine = product
    ? `I'm reaching out to see whether ${product} could be useful to you.`
    : "I'm reaching out to see whether we could be useful to you.";
  const text = [greeting, hook ?? fallbackLine, cta].filter(Boolean).join(" ");
  const fromProfile = Boolean(hook || cta);
  return {
    text,
    greeting,
    hook,
    cta,
    source: fromProfile ? "profile" : "template",
    note: fromProfile
      ? null
      : "No benefits or preferred call to action recorded — using a neutral opener.",
  };
}

function buildDiscoveryQuestions(
  profile: CallStrategyProfileInput
): DiscoveryQuestion[] {
  const questions: DiscoveryQuestion[] = [];

  // Profile-derived first: up to 2 problem-area questions, then benefits, then
  // the ideal customer's industry. Topics are embedded as noun phrases so the
  // templates stay grammatical for free text.
  const pains = sentences(profile.problems_solved).slice(0, 2);
  pains.forEach((pain, index) => {
    const topic = topicOf(pain) ?? lowercaseFirst(pain);
    questions.push(
      index === 0
        ? {
            question: `What's the impact of ${topic} on your business right now?`,
            basis: "From your problems solved",
          }
        : {
            question: `What have you tried so far to address ${topic}?`,
            basis: "From your problems solved",
          }
    );
  });
  const benefitTopic = topicOf(profile.benefits);
  if (benefitTopic) {
    questions.push({
      question: `What difference would ${benefitTopic} make for you?`,
      basis: "From your benefits",
    });
  }
  const ideal = parseIdealCustomer(profile.ideal_customer);
  const idealIndustry = ideal?.industries?.[0];
  if (idealIndustry) {
    questions.push({
      question: `How are ${lowercaseFirst(idealIndustry)} handling this today?`,
      basis: "From your ideal customer",
    });
  }

  // Clearly-labeled standard discovery questions (universally valid, make no
  // claim about this prospect). Order is deterministic.
  questions.push(
    { question: "What are you using today to handle this?", basis: "Standard discovery" },
    { question: "Who else is involved in decisions like this?", basis: "Standard discovery" },
    { question: "What's your timeline for a decision?", basis: "Standard discovery" }
  );
  return questions.slice(0, MAX_DISCOVERY_QUESTIONS);
}

function buildObjections(profile: CallStrategyProfileInput): ExpectedObjection[] {
  const objections = profile.objections.map((o) => o.trim()).filter(Boolean);
  const guardrails = profile.guardrails.map((g) => g.trim()).filter(Boolean);
  return objections.slice(0, MAX_EXPECTED_OBJECTIONS).map((objection) => {
    const related = guardrails.find((g) => relates(objection, g)) ?? null;
    return { objection, relatedGuardrail: related };
  });
}

function buildClose(profile: CallStrategyProfileInput): CallStrategyReady["close"] {
  const cta = clean(profile.preferred_cta);
  if (cta) return { instruction: cta, source: "profile", note: null };
  return {
    instruction: "Propose one clear next step and ask whether it works for them.",
    source: "template",
    note: "No preferred call to action recorded — using a neutral close.",
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const EMPTY_PROSPECT: CallStrategyProspectInput = {
  first_name: null,
  last_name: null,
  title: null,
  company: null,
  industry: null,
  size: null,
  location: null,
  tags: [],
  source: null,
};

/**
 * Builds the deterministic pre-call brief. `profile` null -> the
 * onboarding-required state (the UI links to /settings/sales-profile). The
 * result always passes callStrategySchema (parsed defensively — an invariant
 * the tests assert).
 */
export function buildCallStrategy(input: {
  profile: CallStrategyProfileInput | null;
  prospect: CallStrategyProspectInput | null;
}): CallStrategyResult {
  const { profile } = input;
  const prospect = input.prospect ?? EMPTY_PROSPECT;

  if (!profile) {
    return callStrategySchema.parse({
      state: "onboarding_required",
      reason: "Complete your Sales Profile to generate a call strategy.",
    });
  }

  const { angle, idealFit } = buildAngle(profile, prospect);
  const ready: CallStrategyReady = {
    state: "ready",
    profileName: clean(profile.name),
    context: buildContext(prospect),
    angle,
    painHypotheses: buildPainHypotheses(profile, prospect, idealFit),
    objective: buildObjective(profile),
    opener: buildOpener(profile, prospect),
    discoveryQuestions: buildDiscoveryQuestions(profile),
    objectionsToExpect: buildObjections(profile),
    guardrails: profile.guardrails.map((g) => g.trim()).filter(Boolean),
    close: buildClose(profile),
  };
  return callStrategySchema.parse(ready);
}
