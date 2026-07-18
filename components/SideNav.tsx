"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FAMILY_FEST } from "@/lib/data";
import { useFestSeason } from "@/lib/useFestSeason";
import { useUnreadNotifications } from "@/lib/hooks";
import { useAppImages } from "@/lib/useAppImages";
import { siteImageSrc } from "@/lib/appImages";
import { Icon, type IconName } from "@/components/Icon";

/**
 * Desktop-only left navigation rail ("Lodge Sidebar", proposal A). Hidden below
 * `lg` (< 1024px), where the mobile bottom `TabBar` owns navigation instead —
 * the two never overlap (`SideNav` is `hidden lg:flex`, `TabBar` is
 * `lg:hidden`). It's a sibling of `#app-scroll` (like `TabBar`), fixed to the
 * viewport, so the app's single-scroll-container invariant is untouched.
 *
 * The PRIMARY group mirrors the mobile TabBar's routes/labels (minus Profile,
 * which is pinned to the rail's foot) so the two nav surfaces can't drift; the
 * SECONDARY "More" group surfaces the destinations that are only reachable from
 * Home tiles on mobile (Events, People, Committees, …), which there's finally
 * room for on a wide screen. Live-dot (Family Fest season) + unread badge
 * (Activity) reuse the exact same hooks as TabBar.
 */

const PRIMARY: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/posts", label: "Feed", icon: "feed" },
  { href: "/family-fest", label: "Family Fest", icon: "fest" },
  { href: "/notifications", label: "Activity", icon: "bell" },
];

const SECONDARY: { href: string; label: string; icon: IconName }[] = [
  { href: "/events", label: "Events", icon: "calendar" },
  { href: "/people", label: "People", icon: "people" },
  { href: "/committees", label: "Committees", icon: "users" },
  { href: "/polls", label: "Polls", icon: "question" },
  { href: "/local-places", label: "Local Places", icon: "pin" },
  { href: "/help-requests", label: "Ask for Help", icon: "hand" },
  { href: "/request-stay", label: "Cabin Stay", icon: "cabin" },
];

const PROFILE = { href: "/profile", label: "Profile", icon: "person" as IconName };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function LiveDot() {
  return (
    <span className="absolute -right-1.5 -top-0.5 flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fest/70" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-fest" />
    </span>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} new`}
      className="absolute -right-2.5 -top-1 flex min-w-[1.05rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-[1.05rem] text-white ring-2 ring-card"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function SideLink({
  href,
  label,
  icon,
  active,
  fest,
  children,
}: {
  href: string;
  label: string;
  icon: IconName;
  active: boolean;
  fest?: boolean;
  children?: React.ReactNode;
}) {
  // The Family Fest item wears the fest's heraldic wine so it reads as its own
  // theme; the rest use the resort's forest green — mirrors TabBar's coloring.
  const color = fest
    ? active
      ? "bg-fest/10 font-semibold text-fest"
      : "text-fest/70 hover:bg-fest/5"
    : active
      ? "bg-primary/10 font-semibold text-primary"
      : "text-foreground/70 hover:bg-primary/5";
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`press flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${color}`}
    >
      <span className="relative shrink-0">
        <Icon name={icon} size={22} strokeWidth={active ? 2.4 : 1.8} className="block" />
        {children}
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function SideNav() {
  const pathname = usePathname();
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  const unread = useUnreadNotifications();
  const images = useAppImages();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-card lg:flex"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Brand logo — the green cabin mark, always visible on desktop (on mobile
          it lives in the Home-only AppHeader instead). */}
      <Link
        href="/"
        aria-label="Muskellunge Lake Resort — Home"
        className="press flex items-center justify-center border-b border-border px-6 py-5"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={siteImageSrc(images, "home_logo")}
          alt="Muskellunge Lake Resort"
          className="block h-14 w-auto max-w-full"
        />
      </Link>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        {PRIMARY.map((tab) => {
          const active = isActive(pathname, tab.href);
          const isFest = tab.href === "/family-fest";
          const live = isFest && (season?.isLive || season?.isWrap);
          const isNotif = tab.href === "/notifications";
          return (
            <SideLink key={tab.href} href={tab.href} label={tab.label} icon={tab.icon} active={active} fest={isFest}>
              {live && <LiveDot />}
              {isNotif && unread > 0 && <Badge count={unread} />}
            </SideLink>
          );
        })}

        <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-faint">
          More
        </p>
        {SECONDARY.map((item) => (
          <SideLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(pathname, item.href)}
          />
        ))}
      </div>

      {/* Profile pinned to the foot, like a desktop account row. */}
      <div
        className="border-t border-border px-3 py-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <SideLink href={PROFILE.href} label={PROFILE.label} icon={PROFILE.icon} active={isActive(pathname, PROFILE.href)} />
      </div>
    </nav>
  );
}
