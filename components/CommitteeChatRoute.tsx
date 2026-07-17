"use client";

import { useEffect, useState } from "react";
import { CommitteeChat } from "@/components/CommitteeChat";
import { COMMITTEES } from "@/lib/data";
import { fetchCommitteeBySlug } from "@/lib/committeeAdmin";

/**
 * The standalone committee-chat route (`/committees/<slug>/chat`, opened from
 * the committee page's "Open chat" button). DB-driven name/emoji (migration
 * 0112) with the in-code seed as the first-paint / offline fallback, so a
 * committee an admin created opens correctly. CommitteeChat resolves membership
 * + messages itself from the slug.
 */
export function CommitteeChatRoute({ slug }: { slug: string }) {
  const seed = COMMITTEES.find((c) => c.slug === slug);
  const [meta, setMeta] = useState<{ name: string; emoji: string }>(
    { name: seed?.name ?? "Committee", emoji: seed?.emoji ?? "🌲" },
  );
  useEffect(() => {
    let alive = true;
    fetchCommitteeBySlug(slug).then((c) => {
      if (alive && c) setMeta({ name: c.name, emoji: c.emoji });
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  return <CommitteeChat slug={slug} name={meta.name} emoji={meta.emoji} />;
}
