// Derives structured ideal-customer reference data from the Sales Profile's
// free-text `ideal_customer` field (e.g. "Roofing, 1-10 employees, Chicago").
//
// This is an HONEST derivation, not fabrication: the tokens are the user's own
// words, split on commas/semicolons/newlines; size tokens are recognized by a
// numeric pattern; everything else is treated as an industry keyword. The
// Opportunity Fit module then only scores dimensions when the prospect's own
// fields actually match (or demonstrably miss) these keywords. When the text
// has no parseable structure, the module returns insufficient data rather
// than guessing.
import type { OpportunityFitIdealCustomer } from "@/domain/scoring/opportunity-fit";

/** A token is a company size when it (mostly) consists of a numeric range,
 * optionally followed by a people-word. e.g. "1-10", "11-50 employees",
 * "500+", "25 staff". */
const SIZE_TOKEN_RE =
  /^\s*\d{1,3}(\s*[-–]\s*\d{1,3})?\+?\s*(employees?|people|staff|heads?|seats?)?\s*$/i;

/** Extracts the normalized size value from a matching token ("1-10 employees"
 * -> "1-10", "500+ staff" -> "500+"). */
function normalizeSize(token: string): string | null {
  const match = token.match(/^\s*((?:\d{1,3}\s*[-–]\s*\d{1,3}|\d{1,3})\+?)/);
  if (!match) return null;
  return match[1].replace(/\s+/g, "");
}

function pushUnique(list: string[], value: string): void {
  const key = value.toLowerCase();
  if (!list.some((existing) => existing.toLowerCase() === key)) {
    list.push(value);
  }
}

/**
 * Parses the ideal-customer description into { industries, sizes }. Returns
 * null when nothing parseable is present (the scorer then leaves those
 * dimensions unscored — never fabricated).
 */
export function parseIdealCustomer(
  text: string | null | undefined
): OpportunityFitIdealCustomer | null {
  if (!text) return null;
  const industries: string[] = [];
  const sizes: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const token = raw.trim();
    if (!token) continue;
    if (SIZE_TOKEN_RE.test(token)) {
      const size = normalizeSize(token);
      if (size) pushUnique(sizes, size);
    } else {
      pushUnique(industries, token);
    }
  }
  if (industries.length === 0 && sizes.length === 0) return null;
  return {
    industries: industries.length > 0 ? industries : undefined,
    sizes: sizes.length > 0 ? sizes : undefined,
  };
}
