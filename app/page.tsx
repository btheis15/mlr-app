import Link from "next/link";
import { FAMILY_FEST, RESORT, SCHEDULE } from "@/lib/data";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";
import { FestDuesCallout } from "@/components/FestDuesCallout";
import { TshirtCallout } from "@/components/TshirtCallout";
import { HomePreFestCards } from "@/components/HomePreFestCards";
import { HomeSignInCTA } from "@/components/HomeSignInCTA";
import { ShareApp } from "@/components/ShareApp";

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

      {/* Guests only: a front-page nudge to sign in (no need to find Profile). */}
      <HomeSignInCTA />

      {/* Easy, visible way for anyone to share the app with family. */}
      <ShareApp />

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

      {/* Pay-your-dues CTA, prominent during the run-up. */}
      <FestDuesCallout />

      {/* Order T-Shirts — right under dues (placeholder until designs land). */}
      <TshirtCallout />

      {/* Year-round resort cards (run-up to the fest; hidden during the week). */}
      <HomePreFestCards />

      {/* Local Places — the nearby favorites: tee times at Inshalla (handed off
          to our in-app booking) plus the bars & grills we order from. Year-round. */}
      <Link
        href="/local-places"
        className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
      >
        <span
          aria-hidden
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lake/12 text-2xl"
        >
          📍
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Local Places</h3>
          <p className="mt-0.5 text-xs text-foreground/60">
            Book a tee time, order pizza, and more nearby.
          </p>
        </div>
        <span className="ml-1 text-lg leading-none text-foreground/30">›</span>
      </Link>

      {/* Heritage, condensed to a single line. */}
      <p className="text-center text-[11px] italic text-foreground/40">
        Est. {RESORT.est} · {RESORT.founders} · {RESORT.town}
      </p>
    </div>
  );
}
