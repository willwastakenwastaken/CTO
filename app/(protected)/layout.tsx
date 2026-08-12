import type { ReactNode } from "react";
import Link from "next/link";

const PRIMARY_NAV = [
  { href: "/home", label: "Home" },
  { href: "/prospects", label: "Prospects" },
  { href: "/calls", label: "Calls" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/coach", label: "Coach" },
];

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1">
      <aside className="hidden w-56 shrink-0 border-r bg-muted/40 px-4 py-6 md:block">
        <p className="px-2 text-sm font-semibold">SignalDesk</p>
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
          <p className="px-2 text-xs uppercase tracking-wide text-muted-foreground">Account</p>
          <Link
            href="/settings"
            className="mt-2 block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Settings
          </Link>
          <span className="mt-1 block px-2 py-1.5 text-sm text-muted-foreground">
            Logout (coming soon)
          </span>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
