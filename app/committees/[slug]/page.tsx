import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { CommitteeJoin } from "@/components/CommitteeJoin";
import { ChatEntryButton } from "@/components/ChatEntryButton";
import { AdminJoinRequests } from "@/components/AdminJoinRequests";
import { CommitteeMembers } from "@/components/CommitteeMembers";
import { CommitteeEmailMembers } from "@/components/CommitteeEmailMembers";
import { Protected, PrivateName } from "@/components/Guard";
import { CommitteeBadge } from "@/components/CommitteeBadge";
import { CommitteeMemberContact } from "@/components/CommitteeMemberContact";
import { COMMITTEES, FAMILY_FEST_AREAS } from "@/lib/data";
import type { CommitteeMember } from "@/lib/types";

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

  // Family Fest carries per-person role areas → lay the roster out grouped by
  // area (with each area's Lead pinned on top) rather than as a flat list.
  const isRoleBased = committee.members.some((m) => m.roles && m.roles.length > 0);

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

      <ChatEntryButton slug={committee.slug} name={committee.name} />

      <AdminJoinRequests slug={committee.slug} name={committee.name} />

      <CommitteeMembers slug={committee.slug} name={committee.name} />

      <CommitteeEmailMembers slug={committee.slug} name={committee.name} />

      <CommitteeJoin committee={committee} />

      {committee.members.length === 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">Members</h2>
          <p className="rounded-2xl bg-card p-4 text-sm text-foreground/55 ring-1 ring-border">
            No members yet — this roster is still being filled in.
          </p>
        </section>
      ) : isRoleBased ? (
        // Role-based committee (Family Fest): grouped by area so it's clear who
        // owns what — and who leads each area (the Lead is pinned to the top).
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">Roles & who&rsquo;s on them</h2>
          {FAMILY_FEST_AREAS.map((area) => {
            const inArea = committee.members
              .map((m) => ({ m, lead: m.roles?.includes(`${area} · Lead`) ?? false }))
              .filter(({ m }) => m.roles?.some((r) => r === area || r === `${area} · Lead`))
              .sort((a, b) => Number(b.lead) - Number(a.lead));
            if (!inArea.length) return null;
            const lead = inArea.find((x) => x.lead);
            return (
              <div key={area} className="space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">{area}</h3>
                  {lead && (
                    <span className="shrink-0 text-[11px] text-foreground/50">
                      Lead: <span className="font-semibold text-primary"><PrivateName name={lead.m.name} /></span>
                    </span>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {inArea.map(({ m, lead: isLead }) => (
                    <li key={m.name} className="flex items-center gap-2">
                      <span className="text-sm"><PrivateName name={m.name} /></span>
                      <CommitteeBadge name={m.name} />
                      {isLead && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          Lead
                        </span>
                      )}
                      <span className="ml-auto">
                        <CommitteeMemberContact email={m.email} phone={m.phone} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ) : (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">Members</h2>
          <ul className="space-y-2">
            {committee.members.map((m: CommitteeMember) => (
              <li key={m.name} className="rounded-2xl bg-card p-4 ring-1 ring-border">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold"><PrivateName name={m.name} /><CommitteeBadge name={m.name} /></p>
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
                  <CommitteeMemberContact email={m.email} phone={m.phone} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-center text-xs text-foreground/40">
        Contact buttons appear as members link their accounts.
      </p>
    </div>
  );
}
