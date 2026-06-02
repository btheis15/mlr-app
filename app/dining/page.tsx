import { AMENITIES, DINING } from "@/lib/data";

export default function DiningPage() {
  return (
    <div className="space-y-6 pt-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Dining & amenities</h1>
        <p className="text-sm text-foreground/60">Where to eat and the good-to-knows.</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-campfire">Eat &amp; drink</h2>
        <ul className="space-y-2">
          {DINING.map((d, i) => (
            <li
              key={d.id}
              className="rise flex gap-3 rounded-2xl bg-card p-4 ring-1 ring-border"
              style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
            >
              <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-campfire/12 text-2xl">
                {d.emoji}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{d.name}</h3>
                <p className="text-xs text-foreground/50">{d.hours}</p>
                <p className="mt-1 text-xs text-foreground/70">{d.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-lake">Amenities</h2>
        <ul className="space-y-2">
          {AMENITIES.map((a, i) => (
            <li
              key={a.id}
              className="rise flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border"
              style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-lake/10 text-lg">
                {a.emoji}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-foreground/50">{a.label}</p>
                <p className="text-sm font-medium">{a.value}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
