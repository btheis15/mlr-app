import { CommitteeDetail } from "@/components/CommitteeDetail";
import { committeeSlugParams } from "@/lib/committeeParams";

// We union the in-code seed with the live DB committees at build time so an
// admin-created committee (migration 0112) gets a prerendered page too;
// `dynamicParams` also serves any brand-new slug at runtime without waiting
// for the next deploy. The page content itself is DB-driven (CommitteeDetail),
// so it's correct for any committee that resolves.
export const dynamicParams = true;
export async function generateStaticParams() {
  return committeeSlugParams();
}

export default async function CommitteePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommitteeDetail slug={slug} />;
}
