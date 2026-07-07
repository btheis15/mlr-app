// Committee name-matching helper. The source of truth for who's on a committee
// is the static roster in lib/data (COMMITTEES) — keyed by a display name. Match
// that against a profile/display name so a roster slot can be linked to a real
// account as people sign up.

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[.,]/g, "").split(/\s+/).filter(Boolean);
}

/** Does a roster display name match a candidate (profile) name? The two can be
 *  abbreviated in *either* direction — a roster "Michelle B" vs a profile
 *  "Michelle Birkholz", or a roster "Keith Thibodeau" vs a profile "Keith T".
 *  So we compare position by position over the shorter token list and accept a
 *  token pair when either side is a prefix of the other. This lets the link /
 *  badge survive most display-name choices without matching unrelated people. */
export function nameMatches(rosterName: string, candidate: string): boolean {
  const r = tokens(rosterName);
  const c = tokens(candidate);
  if (!r.length || !c.length) return false;
  const n = Math.min(r.length, c.length);
  for (let i = 0; i < n; i++) {
    if (!(r[i].startsWith(c[i]) || c[i].startsWith(r[i]))) return false;
  }
  return true;
}
