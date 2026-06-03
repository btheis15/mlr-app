/**
 * Privacy helpers for the "sign in to see sensitive info" wall. Pure functions
 * only (no React) so they're usable from server or client. The UI primitives
 * that consume these live in components/Guard.tsx.
 */

/**
 * First name only — what a guest (not signed in) sees in place of a full name,
 * so family last names aren't exposed to anyone browsing. "Cathy Hofer" →
 * "Cathy". Falls back to the whole string if there's nothing to split.
 */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || name;
}
