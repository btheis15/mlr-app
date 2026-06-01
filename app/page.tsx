import { FAMILY_FEST, RESORT, SCHEDULE } from "@/lib/data";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";

/**
 * Home is intentionally lean — the resort identity, the Family Fest season
 * headline, and the front-desk call. (Future resort sections — Work Weekends,
 * Prep needed, Committees, etc. — will get their cards here.)
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

      <a
        href={`tel:${RESORT.phone}`}
        className="block rounded-2xl bg-primary p-4 text-center text-sm font-semibold text-white shadow-sm"
      >
        📞 Call the front desk
        <span className="block text-xs font-normal text-white/70">{RESORT.frontDesk}</span>
      </a>

      {/* Heritage, condensed to a single line. */}
      <p className="text-center text-[11px] italic text-foreground/40">
        Est. {RESORT.est} · {RESORT.founders} · {RESORT.town}
      </p>
    </div>
  );
}
