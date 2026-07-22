"use client";

import Link from "next/link";
import { useIdentity } from "@/components/IdentityProvider";
import { Icon } from "@/components/Icon";
import { haptic } from "@/lib/haptics";

/**
 * Home card that jumps straight to the admin dashboard (/admin) — quick access
 * for admins without a trip through Profile. Self-hides for everyone else.
 * Mirrors HouseHubCard's horizontal card treatment (sits right under it), in
 * accent (chestnut) rather than primary so the two don't blur together.
 * Profile → Admin (app/profile/page.tsx) still keeps its own RowLink to
 * /admin — this is a second, faster entry point, not a replacement.
 */
export function AdminDashboardCard() {
  const { isAdmin } = useIdentity();
  // Admin-only — `isAdmin` already reads false while an admin is previewing
  // as a member/guest (IdentityProvider's effectiveAdmin), so this also hides
  // during "View as" with no extra check needed.
  if (!isAdmin) return null;

  // One card, two tunnels (mirrors HouseHubCard): the body opens the full
  // dashboard, and the Alerts button jumps straight to Alerts & Notifications —
  // the most-used admin tool. Two sibling Links (a Link can't nest in a Link).
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-accent p-3 pl-4 text-white shadow-sm">
      <Link href="/admin" className="press flex min-w-0 flex-1 items-center gap-3 py-1">
        <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-2xl">
          🛠
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Admin Dashboard</p>
          <p className="mt-0.5 text-xs text-white/80">Manage members, alerts, content &amp; more</p>
        </div>
      </Link>
      <Link
        href="/admin/alerts"
        onClick={() => haptic("light")}
        aria-label="Alerts & notifications"
        className="press flex shrink-0 flex-col items-center gap-0.5 rounded-xl bg-white/15 px-3 py-2 text-[11px] font-semibold"
      >
        <Icon name="bell" size={20} strokeWidth={2} />
        Alerts
      </Link>
    </div>
  );
}
