// UUID-safety helpers.
// HARD RULE: IDs are UUID strings everywhere. NEVER Number(id), parseInt(id),
// or timestamps/indexes as record identity. These helpers exist so every
// boundary validates UUIDs and no code path can silently coerce an id.
import { createHash } from "node:crypto";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deterministic UUID v4-shaped string derived from the given parts (SHA-256,
 * hex-sliced into 8-4-4-4-12 with the version/variant nibbles set). Same
 * inputs -> same UUID, every runtime. Used by the simulation engine so that
 * replaying an advance regenerates the SAME segment/event/suggestion ids:
 * idempotent upserts (onConflict: "id") then make a replay a no-op instead of
 * duplicating rows. IDs are still plain UUID strings — never numeric.
 */
export function uuidFromParts(...parts: string[]): string {
  const hex = createHash("sha256").update(parts.join("::")).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/** True when `value` is a canonical UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export class InvalidUuidError extends Error {
  readonly category = "INVALID_UUID" as const;
  constructor(value: unknown, name = "id") {
    super(
      `Invalid UUID for "${name}": ${String(value)}. IDs are UUID strings — ` +
        `never convert them with Number()/parseInt().`
    );
    this.name = "InvalidUuidError";
  }
}

/**
 * Returns the value when it is a valid UUID string, otherwise throws
 * InvalidUuidError. Use at every route/action boundary.
 */
export function assertUuid(value: unknown, name = "id"): string {
  if (!isUuid(value)) throw new InvalidUuidError(value, name);
  return value;
}

/** Alias for assertUuid — same behavior, explicit name. */
export function requireUuid(value: unknown, name = "id"): string {
  return assertUuid(value, name);
}

/**
 * NEVER call this: Number(id) is forbidden for record identity. This exists
 * only to be referenced in lint/audit documentation.
 */
export const UUID_DISCIPLINE = "IDs are UUID strings; never Number(id)/parseInt(id).";
