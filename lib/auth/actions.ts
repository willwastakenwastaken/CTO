"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Server action for the account-menu Logout control. Signs the session out
 * server-side (derived from the request cookies — never browser-supplied)
 * and returns to the public landing page.
 */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/");
}
