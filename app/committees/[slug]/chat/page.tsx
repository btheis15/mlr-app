import { CommitteeChatRoute } from "@/components/CommitteeChatRoute";
import { committeeSlugParams } from "@/lib/committeeParams";

// Static export needs every dynamic route enumerated — seed ∪ live DB
// committees (migration 0112). dynamicParams serves brand-new slugs at runtime
// on Vercel; the screen's name/emoji are DB-resolved client-side, and
// membership + messages load from Supabase inside CommitteeChat.
//
// `dynamicParams: true` is incompatible with `output: "export"` (a hard
// Next.js build error — the segment-config export must be a literal boolean,
// so it can't be made conditional on an env var in this file). The GitHub
// Pages workflow sed-patches this line to `false` right before the static
// build (see .github/workflows/pages.yml) — Vercel is unaffected and keeps
// serving brand-new slugs immediately.
export const dynamicParams = true;
export async function generateStaticParams() {
  return committeeSlugParams();
}

export default async function CommitteeChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommitteeChatRoute slug={slug} />;
}
