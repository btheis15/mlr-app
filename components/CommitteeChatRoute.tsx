"use client";

import { useEffect, useState } from "react";
import { CommitteeChat } from "@/components/CommitteeChat";
import { COMMITTEES } from "@/lib/data";
import { fetchCommitteeBySlug } from "@/lib/committeeAdmin";

/**
 * The channel this route opens, from `?area=`. Read SYNCHRONOUSLY in a
 * `useState` initializer rather than via `useUrlParam` (which resolves in an
 * effect, so the first render would mount the General channel and swap to the
 * requested one a tick later — the very flash this route exists to avoid).
 * Safe to read `window` here because it's only reached on the client: the
 * prerender path takes the `typeof window` branch and yields General, matching
 * the static HTML, and the real value lands on the first client render.
 */
function initialArea(): string | null {
  if (typeof window === "undefined") return null;
  const a = new URLSearchParams(window.location.search).get("area");
  return a && a.trim() ? a : null;
}

/**
 * The standalone committee-chat route (`/committees/<slug>/chat`, opened from
 * the committee page's chat tiles). DB-driven name/emoji (migration 0112) with
 * the in-code seed as the first-paint / offline fallback, so a committee an
 * admin created opens correctly. CommitteeChat resolves membership + messages
 * itself from the slug.
 *
 * `?area=<role>` opens that role's sub-channel (including the reserved `Leads`
 * room, migration 0172) instead of General. This route used to be
 * General-only, which is why the committee page's Leads tile had to deep-link
 * through `/posts?c=&area=Leads` — landing on the Feed's all-chats list first
 * and then jumping into the room, a visible flash and a wrong Back target.
 * Now it's one direct navigation, exactly like the General chat tile.
 */
export function CommitteeChatRoute({ slug }: { slug: string }) {
  const [area] = useState<string | null>(initialArea);
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

  // The header shows which channel you're in, so a Leads/role room doesn't look
  // identical to the committee's General chat.
  const name = area ? `${meta.name} · ${area}` : meta.name;
  return <CommitteeChat slug={slug} name={name} emoji={meta.emoji} area={area} />;
}
