import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { ChatEntryButton } from "@/components/ChatEntryButton";
import { CommitteeRoster } from "@/components/CommitteeRoster";
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

      <ChatEntryButton slug={committee.slug} name={committee.name} />

      {/* The roster is the single membership list now (migration 0057): it shows
          everyone + their roles, lets app admins add/remove/assign roles, and
          emails the committee or a single role. */}
      <CommitteeRoster committee={committee} />
    </div>
  );
}
