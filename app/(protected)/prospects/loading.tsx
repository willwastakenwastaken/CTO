export default function ProspectsLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Prospects</h1>
      <p className="mt-1 text-sm text-muted-foreground" role="status" aria-live="polite">
        Loading prospects…
      </p>
    </div>
  );
}
