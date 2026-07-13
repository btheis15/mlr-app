"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The Family Fest section's in-section sub-nav: parchment pill links to each
 * fest surface, sticky at the top of the content so it's always one tap to hop
 * between Overview / Schedule / Dinners / Pay. (Photos deliberately live only
 * on the Feed tab — no fest photos page.) Rendered by
 * app/family-fest/layout.tsx so every fest page gets it, INCLUDING the
 * schedule/dinner drill-in detail pages (their parent pill stays lit, so the
 * nav doubles as a "you are here"). Hidden on the editor surfaces
 * (planner/master) — those are full-window admin tools with their own chrome.
 *
 * Styling leans on the `.ff-section` re-declared tokens (bg-card, text-primary,
 * ring-border…), so the pills render parchment + heraldic wine here and would
 * render forest-green anywhere else — no hex. Pills are h-11 (44px) tap
 * targets and the row scrolls horizontally on narrow screens.
 */

const LINKS = [
  { href: "/family-fest", label: "Overview" },
  { href: "/family-fest/schedule", label: "Schedule" },
  { href: "/family-fest/dinners", label: "Dinners" },
  { href: "/family-fest/pay", label: "Pay" },
] as const;

/** Editor surfaces that keep their own full-window chrome — no pill nav. */
const HIDDEN_PREFIXES = ["/family-fest/planner", "/family-fest/master"];

function isActive(pathname: string, href: string): boolean {
  if (href === "/family-fest") return pathname === "/family-fest";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function FamilyFestNav() {
  const pathname = usePathname() ?? "/family-fest";
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      aria-label="Family Fest sections"
      // Full-bleed within the layout's px-4, sticky so it rides the top of the
      // viewport as the page scrolls; the translucent parchment + blur keeps
      // content readable as it slides underneath.
      className="sticky top-0 z-30 -mx-4 bg-background/90 backdrop-blur"
    >
      <div className="flex gap-1.5 overflow-x-auto px-4 py-2">
        {LINKS.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`press flex h-11 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold ${
                active
                  ? "bg-primary text-white shadow-sm"
                  : "bg-card text-foreground/70 ring-1 ring-border"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
