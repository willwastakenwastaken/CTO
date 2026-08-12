import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">
        Ready to sell?
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        What should you do next? The dashboard arrives in a later milestone —
        for now, start a practice call or pick a prospect.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {/* /calls/practice enforces the Sales Profile onboarding gate. */}
        <Link
          href="/calls/practice"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          Start a Call
        </Link>
        <Link
          href="/prospects"
          className="inline-flex h-10 items-center justify-center rounded-lg border px-5 text-sm font-medium hover:bg-muted"
        >
          Choose Prospect
        </Link>
      </div>
    </div>
  );
}
