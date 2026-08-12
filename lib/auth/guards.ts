/**
 * Pure path-guard helpers shared by proxy.ts and server layouts.
 *
 * Kept free of Next/Supabase imports so Vitest can unit-test them directly.
 */

/** Routes that require an authenticated session (match prefix or exact path). */
export const PROTECTED_PREFIXES = [
  "/home",
  "/prospects",
  "/calls",
  "/pipeline",
  "/coach",
  "/settings",
] as const;

/** Public auth entry points. Authenticated users are sent away from these. */
export const PUBLIC_AUTH_PATHS = ["/login", "/signup", "/forgot-password"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.some((path) => pathname === path);
}

/**
 * Login URL that remembers where the user was headed, e.g.
 * `/calls/practice` -> `/login?next=%2Fcalls%2Fpractice`.
 */
export function loginRedirectUrl(pathname: string): string {
  return `/login?next=${encodeURIComponent(pathname)}`;
}

/**
 * Validates the `next` query param used after login. Only internal absolute
 * paths are allowed (no protocol-relative URLs, no open redirects).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/home";
}
