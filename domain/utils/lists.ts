// List compaction for onboarding lists (objections, guardrails, tags) and
// other editable JSONB arrays. Blank entries are never persisted; duplicates
// are collapsed case-insensitively; an optional cap bounds the list.

export interface CompactListOptions {
  /** Collapse case-insensitive duplicates, keeping the first (default true). */
  dedupe?: boolean;
  /** Maximum number of entries to keep (default: no cap). */
  max?: number;
}

/**
 * Trims entries, drops blanks, optionally dedupes (case-insensitive, first
 * occurrence wins) and caps the length. Always returns a fresh array.
 */
export function compactStringList(
  items: readonly (string | null | undefined)[],
  options: CompactListOptions = {}
): string[] {
  const { dedupe = true, max } = options;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item?.trim() ?? "";
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (dedupe && seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (max !== undefined && result.length >= max) break;
  }
  return result;
}

/** Drops blank/whitespace-only entries from a list of strings. */
export function dropBlankStrings(
  items: readonly (string | null | undefined)[]
): string[] {
  return items.filter((i): i is string => typeof i === "string" && i.trim().length > 0);
}
