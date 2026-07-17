import { CommitteeChatRoute } from "@/components/CommitteeChatRoute";
import { committeeSlugParams } from "@/lib/committeeParams";

// Static export needs every dynamic route enumerated — seed ∪ live DB
// committees (migration 0112). dynamicParams serves brand-new slugs at runtime
// on Vercel; the screen's name/emoji are DB-resolved client-side, and
// membership + messages load from Supabase inside CommitteeChat.
export const dynamicParams = true;
export async function generateStaticParams() {
  return committeeSlugParams();
}

export default async function CommitteeChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommitteeChatRoute slug={slug} />;
}
