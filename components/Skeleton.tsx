// Loading placeholders that mirror the card layout instead of a bare
// "Loading…" line — the page keeps its shape while data arrives (no layout
// jump), which reads far more native. Pure markup (server-safe); light-mode
// tints only, per the theme rules.

function Bar({ className }: { className: string }) {
  return <div className={`rounded-md bg-foreground/8 ${className}`} />;
}

/** One pulsing card the size/shape of a list card (EventCard, cabin card…). */
export function SkeletonCard() {
  return (
    <div className="animate-pulse space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 shrink-0 rounded-xl bg-foreground/8" />
        <div className="min-w-0 flex-1 space-y-2">
          <Bar className="h-3.5 w-2/3" />
          <Bar className="h-3 w-2/5" />
        </div>
      </div>
      <Bar className="h-9 w-full rounded-xl" />
    </div>
  );
}

/** A stack of pulsing cards for whole-page loading states. */
export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
