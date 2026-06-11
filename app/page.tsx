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
      {/* No banner — the app-open splash carries the logo. A compact forest-green
          script wordmark keeps the resort's identity + green character on Home
          without eating the top of the screen. */}
      <header className="pt-1 text-center">
        <h1 className="font-script text-3xl leading-tight text-primary">{RESORT.name}</h1>
        <p className="mt-1 text-sm text-foreground/55">{RESORT.tagline}</p>
      </header>

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
