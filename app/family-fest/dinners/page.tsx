"use client";

import Link from "next/link";
import { useFestContent } from "@/lib/useFestContent";
import { formatDateLong, formatTime } from "@/lib/format";

/**
 * Dinners — the index the sub-nav's Dinners pill lands on. One row per night
 * (previously these were only reachable inside the Overview's day accordions),
 * each linking to the existing dinners/[id] detail page (menu, crew houses,
 * head chef). Content comes from the shared DB via useFestContent (seed
 * fallback offline) — static-export safe, all client-side.
 */
export default function FestDinnersPage() {
  const { dinners } = useFestContent({ realtime: true });
  const sorted = [...dinners].sort((a, b) => a.day.localeCompare(b.day));

  return (
    <div className="space-y-4 pt-1">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Dinners</h1>
        <p className="text-sm text-foreground/60">
          One big family dinner every night — tap a night for the menu, the crew, and
          the head chef.
        </p>
      </header>

      {sorted.length === 0 ? (
        <p className="rounded-2xl bg-card p-4 text-sm text-foreground/60 ring-1 ring-border">
          No dinners on the books yet — check back soon.
        </p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((d, i) => (
            <li key={d.id} style={{ "--i": Math.min(i, 8) } as React.CSSProperties} className="rise">
              <Link
                href={`/family-fest/dinners/${d.id}`}
                className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border"
              >
                <span className="text-2xl" aria-hidden>
                  {d.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{d.title}</p>
                  <p className="text-xs text-foreground/55">
                    {formatDateLong(d.day)} · {formatTime(d.time)}
                  </p>
                </div>
                <span className="shrink-0 text-foreground/40" aria-hidden>
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
