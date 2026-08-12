// Call session domain types.
// IDs are UUID strings everywhere — never Number(id), parseInt(id), or
// timestamps as record identity. Statuses MUST match
// migrations/001_initial_schema.sql (public.call_status).

export const SESSION_STATUSES = [
  "prepared",
  "live",
  "processing",
  "completed",
  "cancelled",
  "failed",
] as const;
export type CallSessionStatus = (typeof SESSION_STATUSES)[number];
