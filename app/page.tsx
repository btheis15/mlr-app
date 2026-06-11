import { FAMILY_FEST, RESORT, SCHEDULE } from "@/lib/data";
import { RowLink } from "@/components/RowLink";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";
import { FestDuesCallout } from "@/components/FestDuesCallout";
import { HomeResortGroups } from "@/components/HomeResortGroups";
import { HomeSignInCTA } from "@/components/HomeSignInCTA";
import { ShareApp } from "@/components/ShareApp";
import { InstallButton } from "@/components/InstallButton";
import { WelcomeCard } from "@/components/WelcomeCard";
import { UpcomingEvents } from "@/components/UpcomingEvents";
import { AskForHelpHomeCard } from "@/components/AskForHelpHomeCard";
import { CollapsibleSection } from "@/components/CollapsibleSection";

/**
 * Home, organized for a 60–70-person, all-ages, mostly-non-technical crowd:
 *   1) WHAT'S HAPPENING up top, front & center — the Family Fest season spotlight
 *      and the nearest event + RSVP (plus the in-season dues / t-shirt CTAs).
 *   2) EVERYTHING ELSE grouped into two clearly-labeled sections (Get involved /
 *      Around the resort) via HomeResortGroups, so it reads as a few sections
 *      instead of a wall of equal cards.
 *   3) QUIET UTILITIES (install, share, help) tucked at the bottom, out of the way.
 */
export default function HomePage() {
  return (
    <div className="space-y-6 pt-4">
      {/* Compact logo band: the logo sits at a reasonable size (≈112px tall, well
          under half its old full-width height), centered on a band of the logo's
          exact green (--color-logo) so the green fills the width seamlessly — no
          more quarter-page header to scroll past. */}
      <header className="flex items-center justify-center overflow-hidden rounded-3xl bg-logo py-3 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand-logo.jpg"
          alt="Muskellunge Lake Resort — Family Fest · Est. 1987"
          className="block h-28 w-auto"
        />
      </header>
      <p className="text-center text-sm text-foreground/60">{RESORT.tagline}</p>

      {/* First visit only: orient newcomers. Guests only: a nudge to sign in. */}
      <WelcomeCard />
      <HomeSignInCTA />

      {/* ── What's happening — kept front & center ──────────────────────────── */}
      {/* Family Fest: quiet banner most of the year, a takeover hero during the
          week. The nearest event + inline RSVP sits right below it. */}
      <FamilyFestSpotlight
        name={FAMILY_FEST.name}
        tagline={FAMILY_FEST.tagline}
        startDate={FAMILY_FEST.startDate}
        endDate={FAMILY_FEST.endDate}
        schedule={SCHEDULE}
      />

      {/* Pay-your-dues CTA, right under the Family Fest spotlight (run-up only,
          self-hides otherwise). T-shirt ordering lives on the Family Fest page. */}
      <FestDuesCallout />

      <UpcomingEvents />

      {/* Ask for Help (BETA) — beta testers only; self-hides for everyone else. */}
      <AskForHelpHomeCard />

      {/* ── Everything else, in collapsed groups (tap to open) ──────────────── */}
      <HomeResortGroups />

      {/* Quiet utilities, collapsed into one group at the bottom. */}
      <CollapsibleSection title="App & help" icon="📲" subtitle="Add to phone · Share · Help">
        <InstallButton />
        <ShareApp />
        <RowLink
          href="/help"
          emoji="❓"
          title="Help & how-to"
          subtitle="New here, or stuck? Start here."
        />
      </CollapsibleSection>

      {/* Heritage, condensed to a single line. */}
      <p className="text-center text-[11px] italic text-foreground/40">
        Est. {RESORT.est} · {RESORT.founders} · {RESORT.town}
      </p>
    </div>
  );
}
