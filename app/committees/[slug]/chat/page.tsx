import { notFound } from "next/navigation";
import { COMMITTEES } from "@/lib/data";
import { CommitteeChat } from "@/components/CommitteeChat";

// Static export (GitHub Pages) needs every dynamic route enumerated up front —
// same as the committee detail page. The committee's name/emoji come from the
// seed so the screen has them without a round-trip; membership + messages load
// client-side from Supabase inside CommitteeChat.
export function generateStaticParams() {
  return COMMITTEES.map((c) => ({ slug: c.slug }));
}
export const dynamicParams = false;

export default async function CommitteeChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const committee = COMMITTEES.find((c) => c.slug === slug);
  if (!committee) notFound();
  return <CommitteeChat slug={committee.slug} name={committee.name} emoji={committee.emoji} />;
}
