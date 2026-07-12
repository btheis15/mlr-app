"use client";

import { useState } from "react";
import { getFestSeason } from "@/lib/festSeason";
import type { DuesTier, FestConfigContent } from "@/lib/types";

/**
 * Interactive Family Fest dues table — a +/- stepper per tier instead of just
 * a price list, so paying for e.g. "2 adults" doesn't require doing the math
 * by hand. Every change recomputes the total and hands it up (as the dollar
 * amount + a plain-English note) so `PayView`'s Amount/Note fields — and the
 * Venmo deep link they feed — stay in sync automatically.
 *
 * Tiers split into two groups (`DuesTier.perDay`): flat tiers (one-time/full
 * week) just need a headcount; per-day tiers ALSO need a day count, so they
 * share one "how many days" stepper — the assumption is everyone paying a
 * per-day rate in a single payment is here for the same span. A household
 * with people staying different lengths just does the calculator/Venmo tap
 * once per day-count group (Reset clears it for the next one).
 */
export function FestDuesCalculator({
  dues,
  config,
  onChange,
}: {
  dues: DuesTier[];
  config: FestConfigContent;
  onChange: (amount: string, note: string) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [days, setDays] = useState(1);

  const flatTiers = dues.filter((t) => !t.perDay);
  const dailyTiers = dues.filter((t) => t.perDay);
  const maxDays = Math.max(1, getFestSeason(config.startDate, config.endDate).totalDays);

  const recompute = (nextCounts: Record<string, number>, nextDays: number) => {
    const flatPicked = flatTiers.filter((t) => (nextCounts[t.id] ?? 0) > 0);
    const dailyPicked = dailyTiers.filter((t) => (nextCounts[t.id] ?? 0) > 0);

    const flatTotal = flatPicked.reduce((sum, t) => sum + (nextCounts[t.id] ?? 0) * (t.amount ?? 0), 0);
    const dailyTotal = dailyPicked.reduce((sum, t) => sum + (nextCounts[t.id] ?? 0) * (t.amount ?? 0) * nextDays, 0);
    const total = flatTotal + dailyTotal;

    const parts = [
      ...flatPicked.map((t) => `${nextCounts[t.id]} ${t.label}`),
      ...(dailyPicked.length ? [`${nextDays} day${nextDays === 1 ? "" : "s"}: ${dailyPicked.map((t) => `${nextCounts[t.id]} ${t.label}`).join(", ")}`] : []),
    ];
    onChange(total > 0 ? String(total) : "", parts.length ? `Family Fest — ${parts.join("; ")}` : "Family Fest");
  };

  const setCount = (id: string, next: number) => {
    const updated = { ...counts, [id]: Math.max(0, Math.min(99, next)) };
    setCounts(updated);
    recompute(updated, days);
  };

  const setDayCount = (next: number) => {
    const clamped = Math.max(1, Math.min(maxDays, next));
    setDays(clamped);
    recompute(counts, clamped);
  };

  const reset = () => {
    setCounts({});
    setDays(1);
    onChange("", "Family Fest");
  };

  const flatTotal = flatTiers.reduce((sum, t) => sum + (counts[t.id] ?? 0) * (t.amount ?? 0), 0);
  const dailyTotal = dailyTiers.reduce((sum, t) => sum + (counts[t.id] ?? 0) * (t.amount ?? 0) * days, 0);
  const total = flatTotal + dailyTotal;
  const anySelected = Object.values(counts).some((n) => n > 0);
  const dailyHasPricing = dailyTiers.some((t) => t.amount != null);

  return (
    <div className="rounded-2xl bg-primary/10 p-4">
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-primary">
        Family Fest dues
      </p>
      <p className="mt-1 text-center text-[11px] text-foreground/50">
        Use +/- for how many you&rsquo;re paying for — the total fills in below.
      </p>

      {flatTiers.length > 0 && (
        <ul className="mt-3 divide-y divide-border/60">
          {flatTiers.map((tier) => (
            <DuesRow key={tier.id} tier={tier} count={counts[tier.id] ?? 0} onCount={(n) => setCount(tier.id, n)} />
          ))}
        </ul>
      )}

      {dailyHasPricing && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <p className="text-xs font-semibold text-foreground/60">Paying by the day?</p>
          <p className="mt-0.5 text-[11px] text-foreground/45">
            Only for someone not staying the whole week. Set the days once — it applies to everyone below.
          </p>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
            <span className="text-sm font-medium">Number of days</span>
            <Stepper
              count={days}
              min={1}
              onDec={() => setDayCount(days - 1)}
              onInc={() => setDayCount(days + 1)}
              decLabel="Fewer days"
              incLabel="More days"
            />
          </div>
          <ul className="mt-2 divide-y divide-border/60">
            {dailyTiers.map((tier) => (
              <DuesRow key={tier.id} tier={tier} count={counts[tier.id] ?? 0} onCount={(n) => setCount(tier.id, n)} perDaySuffix />
            ))}
          </ul>
        </div>
      )}

      {(anySelected || total > 0) && (
        <div className="mt-3 space-y-2">
          <div className="flex items-baseline justify-between rounded-xl bg-background px-3 py-2.5 ring-1 ring-border">
            <span className="text-sm font-semibold text-foreground/70">Your total</span>
            <span className="text-lg font-bold text-primary">${total}</span>
          </div>
          <button
            type="button"
            onClick={reset}
            className="press w-full text-center text-xs font-medium text-foreground/50 underline underline-offset-2"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

function DuesRow({
  tier,
  count,
  onCount,
  perDaySuffix,
}: {
  tier: DuesTier;
  count: number;
  onCount: (next: number) => void;
  perDaySuffix?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground/80">
          {tier.label}
          {tier.note && <span className="text-foreground/50"> · {tier.note}</span>}
        </p>
        <p className="text-xs font-bold text-primary">
          {tier.amount != null ? `$${tier.amount}${perDaySuffix ? "/day" : ""}` : "TBD"}
        </p>
      </div>
      {tier.amount != null && (
        <Stepper
          count={count}
          min={0}
          onDec={() => onCount(count - 1)}
          onInc={() => onCount(count + 1)}
          decLabel={`Fewer — ${tier.label}`}
          incLabel={`More — ${tier.label}`}
        />
      )}
    </li>
  );
}

function Stepper({
  count,
  min,
  onDec,
  onInc,
  decLabel,
  incLabel,
}: {
  count: number;
  min: number;
  onDec: () => void;
  onInc: () => void;
  decLabel: string;
  incLabel: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <button
        type="button"
        onClick={onDec}
        disabled={count <= min}
        aria-label={decLabel}
        className="press flex min-h-11 min-w-11 items-center justify-center rounded-full bg-background text-lg font-semibold leading-none ring-1 ring-border disabled:opacity-30"
      >
        –
      </button>
      <span className="w-4 text-center text-sm font-bold tabular-nums" aria-live="polite">
        {count}
      </span>
      <button
        type="button"
        onClick={onInc}
        aria-label={incLabel}
        className="press flex min-h-11 min-w-11 items-center justify-center rounded-full bg-primary text-lg font-semibold leading-none text-white"
      >
        +
      </button>
    </div>
  );
}
