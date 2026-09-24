/** Shown while the season page reads the league from ESPN, which can take several seconds. */
export default function Loading() {
  return (
    <main className="min-h-dvh bg-bg text-text px-4 py-5 font-sans">
      <div className="mx-auto max-w-2xl space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted">Fantasy War Room</p>
        <p className="rounded-card border border-line bg-panel p-4 text-sm text-muted" role="status">
          Reading your league from ESPN… this can take a few seconds.
        </p>
      </div>
    </main>
  );
}
