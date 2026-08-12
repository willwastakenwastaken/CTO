export default async function CallReviewPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { callId } = await params;
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Call review</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Call {callId} — evidence-based review (Purchase Intent, summary, next action, coaching
        observations, pipeline recommendation with Apply) — placeholder.
      </p>
    </main>
  );
}
