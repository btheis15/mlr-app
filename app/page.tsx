import Link from "next/link";
import { FAMILY_FEST, RESORT, SCHEDULE } from "@/lib/data";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";

/**
 * Home is intentionally lean — the resort identity, the Family Fest season
 * headline, the front-desk call. The bottom tab bar (Photos, Family Fest, Chat,
 * Profile) handles the rest; Activities & Dining aren't tabs, so they get the
 * two quick links here.
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
        schedule={SCHEDULE}
      />

      {/* Activities & Dining aren't bottom tabs, so they get quick links here. */}
      <section className="grid grid-cols-2 gap-3">
        <Link
          href="/activities"
          className="rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
        >
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-lake/12 text-2xl text-lake">
            🛶
          </span>
          <h3 className="mt-2 text-sm font-semibold">Activities</h3>
          <p className="mt-0.5 text-xs text-foreground/60">Boats, fishing, trails &amp; more.</p>
        </Link>
        <Link
          href="/dining"
          className="rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
        >
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-campfire/12 text-2xl text-campfire">
            🍔
          </span>
          <h3 className="mt-2 text-sm font-semibold">Dining</h3>
          <p className="mt-0.5 text-xs text-foreground/60">Where &amp; when to eat, WiFi, check-in.</p>
        </Link>
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
