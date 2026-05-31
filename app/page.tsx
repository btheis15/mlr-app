import Link from "next/link";
import { FAMILY_FEST, RESORT } from "@/lib/data";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";

// Northwoods-toned quick nav. Chip classes are literal so Tailwind generates them.
const NAV = [
  { href: "/activities", emoji: "🛶", title: "Activities", body: "Boats, fishing, trails & more.", chip: "bg-lake/12 text-lake" },
  { href: "/dining", emoji: "🍔", title: "Dining", body: "Where & when to eat.", chip: "bg-campfire/12 text-campfire" },
  { href: "/chat", emoji: "💬", title: "Chat", body: "What's happening around the lake.", chip: "bg-primary/12 text-primary" },
  { href: "/family-fest", emoji: "🎉", title: "Family Fest", body: "This year's big week.", chip: "bg-dusk/12 text-dusk" },
];

/**
 * Home is intentionally lean — the resort identity, the Family Fest season
 * headline, a tidy quick-nav, and the front-desk call. The detail (full
 * amenities, dining, activity hours, heritage) lives on its own tabs/pages, so
 * the front page never feels overwhelming.
 */
export default function HomePage() {
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

      <a
        href={`tel:${RESORT.phone}`}
        className="block rounded-2xl bg-primary p-4 text-center text-sm font-semibold text-white shadow-sm"
      >
        📞 Call the front desk
        <span className="block text-xs font-normal text-white/70">{RESORT.frontDesk}</span>
      </a>

      {/* Heritage, condensed to a single line (the full story lives on Dining). */}
      <p className="text-center text-[11px] italic text-foreground/40">
        Est. {RESORT.est} · {RESORT.founders} · {RESORT.town}
      </p>
    </div>
  );
}
