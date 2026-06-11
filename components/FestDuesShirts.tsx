"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { FAMILY_FEST } from "@/lib/data";

/**
 * Family Fest "Pay Dues" + "Order T-Shirts" as a tidy side-by-side square pair —
 * lives on the Family Fest page (Home keeps just the Pay-dues row under the
 * spotlight). Shown during the planning run-up, like the standalone callouts it
 * replaces. Pay Dues is the filled CTA (heraldic wine inside the .ff-section);
 * T-shirts is a placeholder until designs land (not yet tappable).
 */
export function FestDuesShirts() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  if (!season?.isPlanning) return null;

  return (
    <div className="grid grid-cols-2 gap-3">
      <Link
        href="/family-fest/pay"
        className="press flex flex-col rounded-2xl bg-primary p-4 text-white shadow-sm"
      >
        <span className="text-2xl" aria-hidden>💸</span>
        <span className="mt-2 text-sm font-semibold">Pay Dues</span>
        <span className="mt-0.5 text-xs text-white/80">
          {FAMILY_FEST.dues.perAdult} / adult {FAMILY_FEST.dues.per}
        </span>
      </Link>

      <div className="flex flex-col rounded-2xl bg-card p-4 ring-1 ring-border">
        <span className="text-2xl" aria-hidden>👕</span>
        <span className="mt-2 text-sm font-semibold">Order T-Shirts</span>
        <span className="mt-0.5 text-xs text-foreground/60">Designs in process!</span>
      </div>
    </div>
  );
}
