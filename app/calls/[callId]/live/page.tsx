export default async function LiveCallPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { callId } = await params;
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Live call</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Call {callId} — simulated live-call workspace placeholder. The focused header,
        recommendation hero (e.g. PRICE CONCERN / ASK NEXT), Listening state, transcript,
        and compact deal state arrive in a later milestone.
      </p>
    </main>
  );
}
