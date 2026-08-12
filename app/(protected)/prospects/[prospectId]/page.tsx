export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ prospectId: string }>;
}) {
  const { prospectId } = await params;
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Prospect Command Center</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Prospect {prospectId} — identity, pipeline stage, next action, Opportunity Fit, brief, and
        Start AI-Assisted Call action arrive in a later milestone.
      </p>
    </div>
  );
}
