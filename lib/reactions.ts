// Emoji reactions, shared by the posts feed and committee chat. Both store
// reactions as (item-id, user_id, emoji) rows; only the table and the item's
// foreign-key column differ.

import { supabase } from "@/lib/supabase";

/**
 * Toggle my reaction on an item. If my `current` emoji equals the tapped one,
 * it's removed; otherwise it's upserted (switching emoji or adding one).
 * `idColumn` is the item foreign key — "post_id" or "message_id". The caller
 * refetches afterward to pick up the change (incl. everyone else's via realtime).
 */
export async function toggleReaction(opts: {
  table: string;
  idColumn: string;
  itemId: string;
  userId: string;
  emoji: string;
  current: string | null;
}): Promise<void> {
  const sb = supabase;
  if (!sb) return;
  const { table, idColumn, itemId, userId, emoji, current } = opts;
  if (current === emoji) {
    await sb.from(table).delete().eq(idColumn, itemId).eq("user_id", userId);
  } else {
    await sb
      .from(table)
      .upsert({ [idColumn]: itemId, user_id: userId, emoji }, { onConflict: `${idColumn},user_id` });
  }
}

/** Tally reaction rows into [emoji, count] pairs, most-used first. */
export function reactionCounts(reactions: { emoji: string }[]): [string, number][] {
  const counts: Record<string, number> = {};
  for (const r of reactions) counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
