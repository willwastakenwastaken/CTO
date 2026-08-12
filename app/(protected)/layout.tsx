import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ensureProfileForUser } from "@/lib/auth/profile";
import { loginRedirectUrl } from "@/lib/auth/guards";
import { signOut } from "@/lib/auth/actions";

const PRIMARY_NAV = [
  { href: "/home", label: "Home" },
  { href: "/prospects", label: "Prospects" },
  { href: "/calls", label: "Calls" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/coach", label: "Coach" },
];

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createServerSupabaseClient();

  // Server-side session check (the proxy guards first; this is defense in
  // depth for direct renders). user_id is always derived from the session —
  // never trusted from the browser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(loginRedirectUrl("/home"));
  }

  // Backstop: guarantee a profiles row exists (email-confirmation signups may
  // not have one yet). Never overwrites an existing row.
  await ensureProfileForUser(supabase, user);

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const accountLabel = profile?.display_name?.trim() || user.email || "Account";

  return (
    <div className="flex min-h-full flex-1">
      <aside className="hidden w-56 shrink-0 border-r bg-muted/40 px-4 py-6 md:block">
        <Link href="/home" className="px-2 text-sm font-semibold">
          SignalDesk
        </Link>
        <nav className="mt-6 flex flex-col gap-1" aria-label="Primary">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-10 border-t pt-4">
          <p className="truncate px-2 text-sm font-medium" title={accountLabel}>
            {accountLabel}
          </p>
          <p className="px-2 text-xs uppercase tracking-wide text-muted-foreground">
            Account
          </p>
          <Link
            href="/settings"
            className="mt-2 block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Settings
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Log out
            </button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
