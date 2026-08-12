export default function ProspectDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Prospect Command Center</h1>
      <p className="mt-1 text-sm text-muted-foreground" role="status" aria-live="polite">
        Loading prospect…
      </p>
    </div>
  );
}
