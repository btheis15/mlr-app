/**
 * The single account allowed to touch owner-only infrastructure controls
 * (right now: remotely restarting the mac mini's media server) — deliberately
 * narrower than `profiles.is_admin`, since every app admin doesn't need
 * access to a "restart the server" button. Mirrored server-side by the
 * media-server's own `requireOwner` check (media-server/server.js) — this
 * client-side check only decides whether to SHOW the control; the server
 * re-verifies against the caller's actual signed-in Supabase session either
 * way, so hiding the UI is a convenience, not the real gate.
 */
export const OWNER_EMAIL = "brian.theis15@gmail.com";

export function isOwner(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === OWNER_EMAIL;
}
