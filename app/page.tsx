import { RESORT } from "@/lib/data";
import { RowLink } from "@/components/RowLink";
import { HomeSpotlight } from "@/components/HomeSpotlight";
import { HouseHubCard } from "@/components/HouseHubCard";
import { HomeQuickActions } from "@/components/HomeQuickActions";
import { WorkChecklist } from "@/components/WorkChecklist";
import { HomeSignInCTA } from "@/components/HomeSignInCTA";
import { ShareApp } from "@/components/ShareApp";
import { InstallButton } from "@/components/InstallButton";
import { WelcomeCard } from "@/components/WelcomeCard";
import { UpcomingEvents } from "@/components/UpcomingEvents";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { WeatherCard } from "@/components/WeatherCard";
import { WhosUpNorthCard } from "@/components/WhosUpNorthCard";
import { ActivePollCard } from "@/components/ActivePollCard";
import { BirthdaysCard } from "@/components/BirthdaysCard";
import { OnThisDayCard } from "@/components/OnThisDayCard";

/**
 * Home, organized for a 60–70-person, all-ages, mostly-non-technical crowd:
 *   1) WHAT'S HAPPENING up top, front & center — the Family Fest season spotlight
 *      and the nearest event + RSVP (plus in-season call-outs like dues).
 *   2) QUICK ACTIONS right after — an always-visible grid of the six places
 *      people go (Events · Committees · People · Ask for Help · Local Places ·
 *      Cabin Stay), no accordion to open.
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
          Stacking keeps this to one card tall so the quick-actions grid below
          stays in view. See HomeSpotlight / CalloutStack. */}
      <HomeSpotlight />

      <UpcomingEvents />

      {/* Work Checklist — kept directly under the Family Fest summary card. Its
          own expandable card (collapsed by default so the list stays tucked away
          until you open it). */}
      <WorkChecklist />

      {/* ── Quick actions — every destination, always visible ────────────────── */}
      {/* Replaced the two default-collapsed accordions (Communication / Around
          the resort) that buried Events, People, Cabin Stay, Ask for Help, Local
          Places and Committees behind an extra tap. Tagged data-fit-anchor
          (inside the component) so the hero logo sizes to land it above the
          tab bar — see lib/appLogoFit.ts. */}
      <HomeQuickActions />

      {/* ── Life Up North — light, self-hiding garnish cards ──────────────── */}
      {/* Every one of these renders nothing when it has nothing to say (guest,
          no data, table not migrated yet), so Home never grows an empty box. */}
      <WeatherCard />
      <WhosUpNorthCard />
      <ActivePollCard />
      <BirthdaysCard />

      {/* Your house — a single tap to your house's calendar, chat & to-do list.
          Self-hides for guests and anyone not assigned to a house. Sits near the
          bottom, just above the App & help utilities. */}
      <HouseHubCard />

      {/* A photo memory from a prior year, same time of year. Members only. */}
      <OnThisDayCard />

      {/* Quiet utilities, collapsed into one group at the bottom.
          Tagged data-fit-anchor-empty: when Home has no upcoming events, the
          hero logo anchors on this group (the first thing past the quick-action
          grid — HouseHubCard above self-hides for most people) instead of
          ballooning to fill the freed space — see lib/appLogoFit.ts. */}
      <div data-fit-anchor-empty>
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
      </div>

      {/* Heritage, condensed to a single line. The resort has been in the family
          since 1959 (1987 — when Family Fest began — lives on the Family Fest tab). */}
      <p className="text-center text-[11px] italic text-foreground/40">
        In the family since {RESORT.familySince} · {RESORT.founders} · {RESORT.town}
      </p>
    </div>
  );
}
