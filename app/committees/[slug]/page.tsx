import { CommitteeDetail } from "@/components/CommitteeDetail";
import { committeeSlugParams } from "@/lib/committeeParams";

// Static export (GitHub Pages) needs every dynamic route enumerated up front.
// We union the in-code seed with the live DB committees at build time so an
// admin-created committee (migration 0112) gets a real page too; on Vercel
// (non-export) `dynamicParams` also serves any brand-new slug at runtime. The
// page content itself is DB-driven (CommitteeDetail), so it's correct for any
// committee that resolves.
//
// NOTE: `dynamicParams: true` is incompatible with `output: export`, so the
// GitHub Pages build flips this to `false` before building (see the
// "static-export-safe" step in .github/workflows/pages.yml, alongside the
// existing `rm -rf app/api`). Keep it a *static* boolean here (Next can't parse
// a computed value) and `true` so Vercel resolves admin-created slugs at
// runtime.
export const dynamicParams = true;
export async function generateStaticParams() {
  return committeeSlugParams();
}

export default async function CommitteePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommitteeDetail slug={slug} />;
}
