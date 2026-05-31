import Link from "next/link";
import { ACTIVITIES, AMENITIES, FAMILY_FEST, RESORT } from "@/lib/data";
import { daysUntil } from "@/lib/format";

export default function HomePage() {
  const today = ACTIVITIES.filter((a) => a.category === "Evening" || a.id === "swim").slice(0, 2);

  return (
    <div className="space-y-6 pt-4">
      <header className="space-y-2">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-2xl">
          🌲
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{RESORT.name}</h1>
        <p className="text-foreground/60">{RESORT.tagline}</p>
      </header>

      {/* Family Fest banner — the embedded "app within the app". */}
      <Link
        href="/family-fest"
        className="block rounded-2xl bg-gradient-to-br from-primary/20 to-accent/15 p-4 ring-1 ring-primary/30"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">
              🎉 {FAMILY_FEST.name}
            </p>
            <p className="mt-1 text-sm font-semibold">{FAMILY_FEST.tagline}</p>
            <p className="mt-0.5 text-xs text-foreground/60">
              Starts {daysUntil(FAMILY_FEST.startDate)} →
            </p>
          </div>
          <span className="text-3xl">🎆</span>
        </div>
      </Link>

      <section className="grid grid-cols-2 gap-3">
        <NavCard href="/activities" emoji="🎣" title="Activities" body="Boats, fishing, trails & more." />
        <NavCard href="/dining" emoji="🍽️" title="Dining" body="Where & when to eat." />
        <NavCard href="/chat" emoji="💬" title="Chat" body="What's happening around the lake." />
        <NavCard href="/family-fest" emoji="🎉" title="Family Fest" body="This year's big week." />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-accent">Good to know</h2>
        <ul className="space-y-2">
          {AMENITIES.slice(0, 4).map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border"
            >
              <span className="text-lg">{a.emoji}</span>
              <div className="min-w-0">
                <p className="text-xs text-foreground/50">{a.label}</p>
                <p className="truncate text-sm font-medium">{a.value}</p>
              </div>
            </li>
          ))}
        </ul>
        <Link href="/dining" className="block text-center text-xs text-primary">
          See all amenities & dining →
        </Link>
      </section>

      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <h2 className="text-sm font-semibold text-accent">Today by the water</h2>
        <ul className="mt-2 space-y-2">
          {today.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              <span className="text-lg">{a.emoji}</span>
              <div>
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-foreground/50">{a.hours}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <a
        href={`tel:${RESORT.phone}`}
        className="block rounded-2xl bg-card p-4 text-center text-sm ring-1 ring-border"
      >
        📞 Call the front desk
        <span className="block text-xs text-foreground/50">{RESORT.frontDesk}</span>
      </a>
    </div>
  );
}

function NavCard({
  href,
  emoji,
  title,
  body,
}: {
  href: string;
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <Link href={href} className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="text-2xl">{emoji}</div>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-foreground/60">{body}</p>
    </Link>
  );
}
