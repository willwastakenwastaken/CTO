import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (Phase 1 placeholder).
 *
 * This is the single place a browser-side Supabase client will be created.
 * Never expose a service-role key here — only the anon key (safe for the browser)
 * guarded by RLS. Phase 1 does not wire real Supabase yet; callers must provide
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before use.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example."
    );
  }

  return createBrowserClient(url, anonKey);
}
