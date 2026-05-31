export default function HomePage() {
  return (
    <div className="space-y-6 pt-6">
      <header className="space-y-2">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-2xl font-bold text-primary">
          M
        </div>
        <h1 className="text-2xl font-bold tracking-tight">MLR App</h1>
        <p className="text-foreground/60">
          A fresh mobile-first PWA, ready to become whatever MLR needs to be.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <Card emoji="📊" title="Activity" body="Your feed and recent events." />
        <Card emoji="👤" title="Profile" body="Account and preferences." />
        <Card emoji="⚡" title="Fast" body="Next.js 16 + Turbopack." />
        <Card emoji="📲" title="Installable" body="Add to Home Screen on iOS." />
      </section>

      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <h2 className="text-sm font-semibold text-accent">Next up</h2>
        <p className="mt-1 text-sm text-foreground/70">
          This is a scaffold with the stack, theme, and PWA plumbing in place.
          Tell me what MLR App is and I&rsquo;ll build out the real features.
        </p>
      </section>
    </div>
  );
}

function Card({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="text-2xl">{emoji}</div>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-foreground/60">{body}</p>
    </div>
  );
}
