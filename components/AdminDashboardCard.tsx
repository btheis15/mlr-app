"use client";

import Link from "next/link";
import { useIdentity } from "@/components/IdentityProvider";

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

  return (
    <Link
      href="/admin"
      className="press flex items-center gap-3 rounded-2xl bg-accent p-4 text-white shadow-sm"
    >
      <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-2xl">
        🛠
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Admin Dashboard</p>
        <p className="mt-0.5 text-xs text-white/80">Manage members, alerts, content &amp; more</p>
      </div>
      <span className="shrink-0 text-lg leading-none text-white/70" aria-hidden>
        ›
      </span>
    </Link>
  );
}
