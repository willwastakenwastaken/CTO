// UUID-safety helpers.
// HARD RULE: IDs are UUID strings everywhere. NEVER Number(id), parseInt(id),
// or timestamps/indexes as record identity. These helpers exist so every
// boundary validates UUIDs and no code path can silently coerce an id.

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
