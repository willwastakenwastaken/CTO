import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">SignalDesk</h1>
      <p className="max-w-xl text-muted-foreground">
        An AI sales copilot that tells you what to ask, say, or do next — before,
        during, and after a sales conversation.
      </p>
      <p className="text-sm text-muted-foreground">
        Phase 1 is a fully simulated practice experience — no real calls, no
        transcription, no live AI.
      </p>
      <div className="flex gap-3">
        <Link
          href="/signup"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="inline-flex h-10 items-center justify-center rounded-lg border px-5 text-sm font-medium"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
