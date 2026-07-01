import { RESORT } from "@/lib/data";
import { RowLink } from "@/components/RowLink";
import { HomeSpotlight } from "@/components/HomeSpotlight";
import { HomeCommunication, HomeAroundResort } from "@/components/HomeResortGroups";
import { HomeSignInCTA } from "@/components/HomeSignInCTA";
import { ShareApp } from "@/components/ShareApp";
import { InstallButton } from "@/components/InstallButton";
import { WelcomeCard } from "@/components/WelcomeCard";
import { UpcomingEvents } from "@/components/UpcomingEvents";
import { CollapsibleSection } from "@/components/CollapsibleSection";

/**
 * Home, organized for a 60–70-person, all-ages, mostly-non-technical crowd:
 *   1) WHAT'S HAPPENING up top, front & center — the Family Fest season spotlight
 *      and the nearest event + RSVP (plus in-season call-outs like dues).
 *   2) GET INVOLVED right after the events (the most important ask), then the
 *      Ask-for-Help / People tiles, then the quieter "Around the resort" group.
 *   3) QUIET UTILITIES (install, share, help) tucked at the bottom, out of the way.
 */
export default function HomePage() {
  return (
    <div className="space-y-5 pt-1">
      {/* The MLR wordmark now lives in the persistent top app chrome
          (components/AppHeader.tsx), centered with the profile photo at the
          top-left — so it's no longer repeated here at the top of Home. */}

      {/* First visit only: orient newcomers. Guests only: a nudge to sign in. */}
      <WelcomeCard />
      <HomeSignInCTA />

      {/* ── What's happening — kept front & center ──────────────────────────── */}
      {/* Family Fest spotlight (quiet banner → planning → live takeover) is the
          permanent base; temporary call-outs stack ON TOP as swipe-away cards.
          Stacking keeps this to one card tall so the Ask-for-Help row below
          stays in view. See HomeSpotlight / CalloutStack. */}
      <HomeSpotlight />

      <UpcomingEvents />

      {/* ── Communication — People, Committees, Ask for Help ─────────────────── */}
      <HomeCommunication />

      {/* ── Around the resort — Events, Cabin Stay, Local Places, Work Checklist ── */}
      <HomeAroundResort />

      {/* Quiet utilities, collapsed into one group at the bottom. */}
      <CollapsibleSection title="App & help" icon="📲" subtitle="Take the tour · Add to phone · Share · Help">
        <RowLink
          href="/guide"
          emoji="🧭"
          title="Take a quick tour"
          subtitle="See the app screen by screen."
        />
        <InstallButton />
        <ShareApp />
        <RowLink
          href="/help"
          emoji="❓"
          title="Help & how-to"
          subtitle="New here, or stuck? Start here."
        />
      </CollapsibleSection>

      {/* Heritage, condensed to a single line. The resort has been in the family
          since 1959 (1987 — when Family Fest began — lives on the Family Fest tab). */}
      <p className="text-center text-[11px] italic text-foreground/40">
        In the family since {RESORT.familySince} · {RESORT.founders} · {RESORT.town}
      </p>
    </div>
  );
}
