"use client";

import { BackLink } from "@/components/BackLink";
import { Protected, PrivateName } from "@/components/Guard";
import { CallTextButtons } from "@/components/CallTextButtons";
import { useFestContent } from "@/lib/useFestContent";
import { formatDateLong, formatTime } from "@/lib/format";
import type { Dinner } from "@/lib/types";

/**
 * One dinner, drilled in — live from the shared content (Planner edits show
 * here), falling back to the seed dinner the static page passed in (which keeps
 * pre-rendered routes working offline / on the Pages mirror).
 */
export function FestDinnerDetail({ id, fallback }: { id: string; fallback: Dinner | null }) {
  const { dinners } = useFestContent({ realtime: true });
  const dinner = dinners.find((d) => d.id === id) ?? fallback;

  if (!dinner) {
    return (
      <div className="space-y-5 pt-1">
        <BackLink href="/family-fest" label="Family Fest" />
        <p className="rounded-2xl bg-card p-4 text-center text-sm text-foreground/60 ring-1 ring-border">
          This dinner isn&rsquo;t on the schedule anymore.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-1">
      <BackLink href="/family-fest" label="Family Fest" />

      <header className="space-y-1">
        <p className="text-xs text-foreground/50">{formatDateLong(dinner.day)}</p>
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="mr-1">{dinner.emoji}</span>
          {dinner.title}
        </h1>
      </header>

      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">
          On the menu
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground/80">{dinner.menu}</p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <DetailTile label="Served" value={formatTime(dinner.time)} sub={<Protected label="Sign in for location">{dinner.location}</Protected>} emoji="🍽️" />
        <DetailTile
          label="Crew preps"
          value={formatTime(dinner.prepTime)}
          sub={<Protected label="Sign in for location">{dinner.prepLocation ?? dinner.location}</Protected>}
          emoji="⏱️"
        />
      </section>

      {dinner.houses.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">
            Houses on crew
          </h2>
          <Protected label="Sign in to see which families are cooking">
            <div className="flex flex-wrap gap-1.5">
              {dinner.houses.map((house) => (
                <span
                  key={house}
                  className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent"
                >
                  {house}
                </span>
              ))}
            </div>
          </Protected>
        </section>
      )}

      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <p className="text-[11px] uppercase tracking-wide text-foreground/40">
          Head chef of the day
        </p>
        <p className="mt-0.5 text-sm font-semibold"><PrivateName name={dinner.chef.name} /></p>
        <div className="mt-3">
          <CallTextButtons phone={dinner.chef.phone} />
        </div>
      </section>
    </div>
  );
}

function DetailTile({
  label,
  value,
  sub,
  emoji,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  emoji: string;
}) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="text-xl">{emoji}</div>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-foreground/40">{label}</p>
      <p className="text-sm font-bold text-primary">{value}</p>
      <p className="text-xs text-foreground/60">{sub}</p>
    </div>
  );
}
