import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { Protected, PrivateName } from "@/components/Guard";
import { SCHEDULE } from "@/lib/data";
import { formatDateLong, formatTime } from "@/lib/format";

// Static export (GitHub Pages) needs every dynamic route enumerated up front.
export function generateStaticParams() {
  return SCHEDULE.map((e) => ({ id: e.id }));
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = SCHEDULE.find((e) => e.id === id);
  if (!event) notFound();

  return (
    <div className="space-y-5 pt-1">
      <BackLink href="/family-fest" label="Family Fest" />

      <header className="space-y-1">
        <p className="text-xs text-foreground/50">
          {formatDateLong(event.day)} · {formatTime(event.start)}
          {event.end ? `–${formatTime(event.end)}` : ""}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="mr-1">{event.emoji}</span>
          {event.title}
        </h1>
        <p className="text-sm text-foreground/60">📍 <Protected label="Sign in for location">{event.location}</Protected></p>
      </header>

      <p className="text-sm leading-relaxed text-foreground/80">{event.description}</p>

      {event.bring && (
        <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">
            What to bring
          </h2>
          <p className="mt-1 text-sm text-foreground/80">{event.bring}</p>
        </section>
      )}

      {event.lead && (
        <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
          <p className="text-[11px] uppercase tracking-wide text-foreground/40">In charge</p>
          <p className="mt-0.5 text-sm font-semibold"><PrivateName name={event.lead.name} /></p>
          <div className="mt-3">
            <Protected label="Sign in to call or text">
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`tel:${event.lead.phone}`}
                  className="press rounded-xl bg-primary/10 py-3 text-center text-sm font-semibold text-primary"
                >
                  📞 Call
                </a>
                <a
                  href={`sms:${event.lead.phone}`}
                  className="press rounded-xl bg-accent/10 py-3 text-center text-sm font-semibold text-accent"
                >
                  💬 Text
                </a>
              </div>
            </Protected>
          </div>
        </section>
      )}
    </div>
  );
}
