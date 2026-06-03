"use client";

import { useFestSeason } from "@/lib/useFestSeason";
import { FAMILY_FEST } from "@/lib/data";

/**
 * "Order T-Shirts" callout — sits right under the Pay-dues CTA on Home and the
 * Family Fest page (same planning-window timing). Placeholder for now: shirts
 * aren't designed yet, so it shows "T-shirt designs in process!" and isn't
 * tappable. When ready, swap the outer <div> for `<a href="tel:+1...">` and
 * update the subtitle to the order line.
 */
export function TshirtCallout() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  if (!season?.isPlanning) return null;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <span className="text-2xl">👕</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Order T-Shirts</p>
        <p className="text-xs text-foreground/60">T-shirt designs in process!</p>
      </div>
    </div>
  );
}
