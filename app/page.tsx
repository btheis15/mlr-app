import Link from "next/link";
import { ACTIVITIES, AMENITIES, FAMILY_FEST, RESORT } from "@/lib/data";
import { daysUntil } from "@/lib/format";

export default function HomePage() {
  const today = ACTIVITIES.filter((a) => a.category === "Evening" || a.id === "swim").slice(0, 2);

  return (
    <div className="space-y-6 pt-4">
      {/* Logo-style brand badge — white on forest green, echoing the official
          Muskellunge Lake Resort mark (cabin in the pines, EST 1987). */}
      <header className="rounded-3xl bg-primary px-5 py-6 text-center text-white shadow-sm">
        <div className="text-3xl">🌲</div>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70">
          {RESORT.heritageTagline}
        </p>
        <h1 className="font-script text-[2.75rem] leading-[1.05]">Muskellunge Lake</h1>
        <p className="-mt-1 text-sm font-bold uppercase tracking-[0.4em] text-white/90">
          Resort
        </p>
        <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-white/60">
          Est. {RESORT.est} · {RESORT.town}
        </p>
      </header>
      <p className="text-center text-sm text-foreground/60">{RESORT.tagline}</p>

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

      {/* Heritage — a nod to the original resort's business card. */}
      <section className="rounded-2xl border-2 border-double border-border bg-card p-5 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-foreground/50">
          {RESORT.heritageTagline}
        </p>
        <p className="font-script mt-2 text-2xl text-primary">Muskellunge Lake Resort</p>
        <p className="text-[11px] uppercase tracking-[0.25em] text-foreground/40">
          Light Housekeeping Cabins
        </p>
        <p className="mt-3 text-xs leading-relaxed text-foreground/60">
          {RESORT.heritageNote}
        </p>
        <p className="mt-3 text-xs italic text-foreground/50">
          Est. {RESORT.est} · {RESORT.founders}
        </p>
      </section>
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
