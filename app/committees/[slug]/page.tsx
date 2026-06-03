import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { CommitteeJoin } from "@/components/CommitteeJoin";
import { Protected, PrivateName } from "@/components/Guard";
import { COMMITTEES } from "@/lib/data";

// Static export (GitHub Pages) needs every dynamic route enumerated up front.
export function generateStaticParams() {
  return COMMITTEES.map((c) => ({ slug: c.slug }));
}

export default async function CommitteePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const committee = COMMITTEES.find((c) => c.slug === slug);
  if (!committee) notFound();

  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/committees" label="Committees" />

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="mr-1">{committee.emoji}</span>
          {committee.name}
        </h1>
        <p className="text-sm text-foreground/60">{committee.description}</p>
      </header>

      <CommitteeJoin committee={committee} />

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">Members</h2>
        <ul className="space-y-2">
          {committee.members.map((m) => (
            <li key={m.email} className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold"><PrivateName name={m.name} /></p>
                {m.role && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {m.role}
                  </span>
                )}
              </div>
              {m.roles && m.roles.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.roles.map((r) => (
                    <span
                      key={r}
                      className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2">
                <Protected label="Sign in to contact">
                  <div className="grid grid-cols-3 gap-2">
                    <a
                      href={`mailto:${m.email}`}
                      className="press rounded-xl bg-primary/10 py-2 text-center text-xs font-semibold text-primary"
                    >
                      ✉️ Email
                    </a>
                    <a
                      href={`tel:${m.phone}`}
                      className="press rounded-xl bg-primary/10 py-2 text-center text-xs font-semibold text-primary"
                    >
                      📞 Call
                    </a>
                    <a
                      href={`sms:${m.phone}`}
                      className="press rounded-xl bg-accent/10 py-2 text-center text-xs font-semibold text-accent"
                    >
                      💬 Text
                    </a>
                  </div>
                </Protected>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-center text-xs text-foreground/40">
        Placeholder roster — real members &amp; contacts coming soon.
      </p>
    </div>
  );
}
