// Admin actions that must run on the Mac mini (they use the service_role key /
// GoTrue admin API, which can't be exposed to the browser): inviting a member
// and — while the two-admin override window is open — setting a member's email
// for them. Mirrors lib/media.ts's "POST to MEDIA_URL with the user's Bearer
// token" pattern; the mini re-checks admin + the unlock window server-side.

import { MEDIA_URL } from "@/lib/media";

async function postAdmin(path: string, token: string, body: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${MEDIA_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(msg);
  }
}

/** Invite a new member: pre-creates a named account and emails them a sign-in code. */
export const inviteMember = (name: string, email: string, token: string) =>
  postAdmin("/admin/invite", token, { name, email });

/** Set a member's email for them. Only succeeds while the override window is open. */
export const setMemberEmail = (userId: string, newEmail: string, token: string) =>
  postAdmin("/admin/set-email", token, { userId, newEmail });
