import Link from "next/link";
import { ACTIVITIES, AMENITIES, FAMILY_FEST, RESORT } from "@/lib/data";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";

// Northwoods-toned quick nav. Chip classes are literal so Tailwind generates them.
const NAV = [
  { href: "/activities", emoji: "🛶", title: "Activities", body: "Boats, fishing, trails & more.", chip: "bg-lake/12 text-lake" },
  { href: "/dining", emoji: "🍔", title: "Dining", body: "Where & when to eat.", chip: "bg-campfire/12 text-campfire" },
  { href: "/chat", emoji: "💬", title: "Chat", body: "What's happening around the lake.", chip: "bg-primary/12 text-primary" },
  { href: "/family-fest", emoji: "🎉", title: "Family Fest", body: "This year's big week.", chip: "bg-dusk/12 text-dusk" },
];

export default function HomePage() {
  const today = ACTIVITIES.filter((a) => a.category === "Evening" || a.id === "swim").slice(0, 2);

  return (
    <div className="space-y-6 pt-4">
      {/* Official Muskellunge Lake Resort logo. */}
      <header className="overflow-hidden rounded-3xl shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand-logo.jpg"
          alt="Muskellunge Lake Resort — Family Fest · Est. 1987"
          className="block w-full"
        />
      </header>
      <p className="text-center text-sm text-foreground/60">{RESORT.tagline}</p>

      {/* Family Fest — quiet banner most of the year, a takeover hero during
          the event week (see FamilyFestSpotlight). This is what makes the fest
          read as a season of the resort app rather than a separate app. */}
      <FamilyFestSpotlight
        name={FAMILY_FEST.name}
        tagline={FAMILY_FEST.tagline}
        startDate={FAMILY_FEST.startDate}
        endDate={FAMILY_FEST.endDate}
        highlights={FAMILY_FEST.highlights}
      />

      <section className="grid grid-cols-2 gap-3">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
          >
            <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl text-2xl ${n.chip}`}>
              {n.emoji}
            </div>
            <h3 className="mt-2 text-sm font-semibold">{n.title}</h3>
            <p className="mt-0.5 text-xs text-foreground/60">{n.body}</p>
          </Link>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-lake">Good to know</h2>
        <ul className="space-y-2">
          {AMENITIES.slice(0, 4).map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-lake/10 text-lg">
                {a.emoji}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-foreground/50">{a.label}</p>
                <p className="truncate text-sm font-medium">{a.value}</p>
              </div>
            </li>
          ))}
        </ul>
        <Link href="/dining" className="block text-center text-xs font-medium text-lake">
          See all amenities & dining →
        </Link>
      </section>

      <section className="rounded-2xl bg-lake/5 p-4 ring-1 ring-lake/20">
        <h2 className="text-sm font-semibold text-lake">Today by the water</h2>
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
        className="block rounded-2xl bg-primary p-4 text-center text-sm font-semibold text-white shadow-sm"
      >
        📞 Call the front desk
        <span className="block text-xs font-normal text-white/70">{RESORT.frontDesk}</span>
      </a>

      {/* Heritage — a nod to the original resort's business card. */}
      <section className="rounded-2xl border-2 border-double border-border bg-card p-5 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-campfire">
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
