// Helpers for the little "committee" name badge. The source of truth for who's
// on a committee is the static roster in lib/data (COMMITTEES) — keyed by a
// display name. Match that against a profile/display name so the badge lights up
// next to people throughout the app as they're linked to real accounts.

import { COMMITTEES } from "@/lib/data";

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[.,]/g, "").split(/\s+/).filter(Boolean);
}

/** Does a roster display name match a candidate (profile) name? Roster names are
 *  often short ("Brian", "Rob H", "Michelle B") while a profile is the fuller
 *  name ("Brian Theis", "Michelle Birkholz"). We match when every roster token
 *  is a prefix of the profile token in the same position — so the badge lights
 *  up as people link real accounts, without the names having to be identical. */
function nameMatches(rosterName: string, candidate: string): boolean {
  const r = tokens(rosterName);
  const c = tokens(candidate);
  if (!r.length || !c.length || r.length > c.length) return false;
  return r.every((tok, i) => c[i].startsWith(tok));
}

export interface CommitteeTag {
  slug: string;
  name: string;
  emoji: string;
}

/** Committees a person (by display name) belongs to, for the name badge. */
export function committeesForName(name: string | null | undefined): CommitteeTag[] {
  if (!name) return [];
  return COMMITTEES.filter((c) => c.members.some((m) => nameMatches(m.name, name))).map((c) => ({
    slug: c.slug,
    name: c.name,
    emoji: c.emoji,
  }));
}
