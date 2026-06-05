import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { Protected, PrivateName } from "@/components/Guard";
import { CallTextButtons } from "@/components/CallTextButtons";
import { DINNERS } from "@/lib/data";
import { formatDateLong } from "@/lib/format";

// Static export (GitHub Pages) needs every dynamic route enumerated up front.
export function generateStaticParams() {
  return DINNERS.map((d) => ({ id: d.id }));
}

export default async function DinnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dinner = DINNERS.find((d) => d.id === id);
  if (!dinner) notFound();

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
        <DetailTile label="Served" value={dinner.time} sub={<Protected label="Sign in for location">{dinner.location}</Protected>} emoji="🍽️" />
        <DetailTile
          label="Crew preps"
          value={dinner.prepTime}
          sub={<Protected label="Sign in for location">{dinner.prepLocation ?? dinner.location}</Protected>}
          emoji="⏱️"
        />
      </section>

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
