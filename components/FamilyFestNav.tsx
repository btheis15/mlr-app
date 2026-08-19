"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGroup, motion } from "framer-motion";
import { useFestContent } from "@/lib/useFestContent";
import { useFestSeason } from "@/lib/useFestSeason";

/**
 * The Family Fest section's in-section sub-nav: parchment pill links to each
 * fest surface, sticky at the top of the content so it's always one tap to hop
 * between Overview / Dinners / Pay / Past Years. (Photos deliberately live only
 * on the Feed tab — no fest photos page.) The pill set is SEASON-AWARE — see
 * CONCLUDED_LINKS below. There's deliberately no "Schedule" pill — the
 * Overview page already renders the full week via FestWeek, so a separate
 * Schedule tab was showing the exact same accordion a second time; the
 * standalone `/family-fest/schedule` index + `schedule/[id]` detail routes are
 * left in place (harmless, reachable by direct link) but nothing in the nav
 * points at them anymore. Rendered by app/family-fest/layout.tsx so every fest
 * page gets it, INCLUDING the dinner drill-in detail page (its parent pill
 * stays lit, so the nav doubles as a "you are here"). Hidden on the editor
 * surfaces (planner/master) — those are full-window admin tools with their
 * own chrome.
 *
 * Styling leans on the `.ff-section` re-declared tokens (bg-card, text-primary,
 * ring-border…), so the pills render parchment + heraldic wine here and would
 * render forest-green anywhere else — no hex. Pills are h-11 (44px) tap
 * targets and the row scrolls horizontally on narrow screens.
 */

const LINKS = [
  { href: "/family-fest", label: "Overview" },
  { href: "/family-fest/dinners", label: "Dinners" },
  { href: "/family-fest/pay", label: "Pay" },
  { href: "/family-fest/past", label: "Past Years" },
] as const;

/**
 * Once the current fest is CONCLUDED, the nav drops to Overview + Past Years.
 * Dinners and Pay are both about a week that's coming: a menu for a dinner that
 * was served three weeks ago, and a dues calculator for a fest nobody can still
 * attend, are exactly the kind of stale surface that made the section feel like
 * it hadn't noticed the fest was over. Both come straight back the moment a new
 * year's dates exist — the whole nav is derived from the season, not toggled by
 * hand. (Each route still works if typed/linked directly; the nav just stops
 * pointing at them.)
 */
const CONCLUDED_LINKS = LINKS.filter(
  (l) => l.href === "/family-fest" || l.href === "/family-fest/past",
);

/** Editor surfaces that keep their own full-window chrome — no pill nav. */
const HIDDEN_PREFIXES = ["/family-fest/planner", "/family-fest/master"];

function isActive(pathname: string, href: string): boolean {
  if (href === "/family-fest") return pathname === "/family-fest";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function FamilyFestNav() {
  const pathname = usePathname() ?? "/family-fest";
  // Rides the shared `festContent` SWR cache — the hub/dinners/pay pages all
  // read the same key, so this is a deduped read, not an extra fetch per nav.
  const { config } = useFestContent();
  const season = useFestSeason(config.startDate, config.endDate);
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  // `season` is null until mounted (SSR-safe): show the full set, matching the
  // server render, and let the concluded set swap in a tick later.
  const links = season?.isConcluded ? CONCLUDED_LINKS : LINKS;

  return (
    <nav
      aria-label="Family Fest sections"
      // Full-bleed within the layout's px-4, sticky so it rides the top of the
      // viewport as the page scrolls; the translucent parchment + blur keeps
      // content readable as it slides underneath.
      className="sticky top-0 z-30 -mx-4 bg-background/90 backdrop-blur"
    >
      <LayoutGroup id="ff-nav">
        <div className="flex gap-1.5 overflow-x-auto px-4 py-2">
          {links.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`press relative flex h-11 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold ${
                  active ? "text-white" : "bg-card text-foreground/70 ring-1 ring-border"
                }`}
              >
                {/* Shared-element pill glides between pills as the route changes
                    (framer layoutId). The persistent layout mounts this nav once,
                    so the pill animates across navigations instead of teleporting. */}
                {active && (
                  <motion.span
                    layoutId="ff-nav-pill"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    className="absolute inset-0 rounded-full bg-primary shadow-sm"
                    aria-hidden
                  />
                )}
                <span className="relative z-10">{l.label}</span>
              </Link>
            );
          })}
        </div>
      </LayoutGroup>
    </nav>
  );
}
