import { CommitteeDetail } from "@/components/CommitteeDetail";
import { committeeSlugParams } from "@/lib/committeeParams";

// Static export (GitHub Pages) needs every dynamic route enumerated up front.
// We union the in-code seed with the live DB committees at build time so an
// admin-created committee (migration 0112) gets a real page too; on Vercel
// (non-export) `dynamicParams` also serves any brand-new slug at runtime. The
// page content itself is DB-driven (CommitteeDetail), so it's correct for any
// committee that resolves.
//
// `dynamicParams: true` is incompatible with `output: "export"` (a hard
// Next.js build error — the segment-config export must be a literal boolean,
// so it can't be made conditional on an env var in this file). The GitHub
// Pages workflow sed-patches this line to `false` right before the static
// build (see .github/workflows/pages.yml) — a committee created after that
// build just waits for the next Pages deploy; Vercel is untouched and keeps
// serving brand-new slugs immediately.
export const dynamicParams = true;
export async function generateStaticParams() {
  return committeeSlugParams();
}

export default async function CommitteePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommitteeDetail slug={slug} />;
}
