"use client";

import { useEffect, useState } from "react";
import { useDemoDate } from "@/lib/DemoDateProvider";

/**
 * Live countdown to a target date. Ticks in real time normally; when a demo
 * date is being simulated (Profile → "see as if it's this day") it shows a
 * static countdown from that date instead. Starts null until mounted to avoid a
 * hydration mismatch on the time-sensitive numbers.
 */
export function Countdown({ target }: { target: string }) {
  const { demoDate, now: demoNow } = useDemoDate();
  const [realNow, setRealNow] = useState<number | null>(null);

  useEffect(() => {
    if (demoDate) return; // simulating a date → static, no ticking
    setRealNow(Date.now());
    const id = setInterval(() => setRealNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [demoDate]);

  const now = demoDate ? (demoNow?.getTime() ?? null) : realNow;
  const targetMs = new Date(`${target}T15:00:00`).getTime();
  const diff = now == null ? 0 : Math.max(0, targetMs - now);

  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);

  if (now != null && diff === 0) {
    // Reaching zero means the target moment has arrived — but only say so on the
    // target DAY itself. `diff` is clamped at 0, so a target in the past also
    // reads as zero, and this banner used to announce "Family Fest is on" for a
    // fest that had finished weeks earlier — the whole reason the season model
    // now has a distinct "concluded" phase (lib/festSeason.ts). Callers should
    // never render a countdown to a past date; this just makes it impossible for
    // the component to claim something untrue if one does.
    const targetDay = new Date(targetMs);
    const nowDay = new Date(now);
    const sameDay =
      targetDay.getFullYear() === nowDay.getFullYear() &&
      targetDay.getMonth() === nowDay.getMonth() &&
      targetDay.getDate() === nowDay.getDate();
    if (!sameDay) return null;
    return (
      <div className="rounded-2xl bg-primary/10 py-3 text-center text-sm font-bold text-primary">
        🎉 Family Fest is on — welcome Up North!
      </div>
    );
  }

  // Pre-mount, `now` is still null — show a stable placeholder (not a real
  // "00 / 00 / 00") so the countdown doesn't flash a fake zero for a frame.
  const pending = now == null;

  return (
    <div className="grid grid-cols-3 gap-2">
      <Unit value={days} label="days" pending={pending} />
      <Unit value={hours} label="hrs" pending={pending} />
      <Unit value={mins} label="min" pending={pending} />
    </div>
  );
}

function Unit({
  value,
  label,
  pending,
}: {
  value: number;
  label: string;
  pending: boolean;
}) {
  return (
    <div className="rounded-xl bg-background py-2 text-center ring-1 ring-border">
      <div className="text-xl font-bold tabular-nums text-accent">
        {pending ? "——" : value.toString().padStart(2, "0")}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-foreground/50">
        {label}
      </div>
    </div>
  );
}
