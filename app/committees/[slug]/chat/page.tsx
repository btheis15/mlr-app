import { CommitteeChatRoute } from "@/components/CommitteeChatRoute";
import { committeeSlugParams } from "@/lib/committeeParams";

// Prerendered for every seed ∪ live DB committee (migration 0112) via
// generateStaticParams; dynamicParams serves brand-new slugs at runtime too,
// without waiting for the next deploy. The screen's name/emoji are
// DB-resolved client-side, and membership + messages load from Supabase
// inside CommitteeChat.
export const dynamicParams = true;
export async function generateStaticParams() {
  return committeeSlugParams();
}

export default async function CommitteeChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommitteeChatRoute slug={slug} />;
}
