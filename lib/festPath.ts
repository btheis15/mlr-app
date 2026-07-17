// Shared "are we inside the Family Fest section" check — used by anything that
// needs to re-apply the .ff-section parchment theme outside the normal DOM
// subtree (Sheet.tsx's portal, FestThemeSync's <html> toggle), so there's one
// source of truth for the route prefix instead of a copy-pasted startsWith.
export function isFamilyFestPath(pathname: string | null | undefined): boolean {
  return pathname?.startsWith("/family-fest") ?? false;
}
