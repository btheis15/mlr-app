// Data + helpers for the "Email members" tool (components/EmailMembersComposer
// and its hosts). The flow is hand-off, not send: we gather recipients, build a
// `mailto:` link, and let the admin's own mail app (Apple Mail, Gmail, …) draft
// and send. Recipients come from the gated RPCs in migration 0028, which return
// each member's shared contact_email or — as a fallback — their login email.

import { supabase } from "@/lib/supabase";

/** A person we can email: their id, display name, and best email. */
export interface Recipient {
  id: string;
  name: string;
  email: string;
}

/** Load result. `needsMigration` is true when the RPC isn't there yet (0028
 *  hasn't been run) so the UI can show the standard MigrationHint instead of an
 *  error. `error` carries any other failure message. */
export interface RecipientResult {
  recipients: Recipient[];
  needsMigration: boolean;
  error: string | null;
}

// A missing SECURITY DEFINER function surfaces as PostgREST "function not found"
// (PGRST202) or a schema-cache miss — that means 0028 hasn't been applied.
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "PGRST202" || /could not find the function|schema cache/i.test(err.message ?? "");
}

function toResult(data: unknown, error: { code?: string; message?: string } | null): RecipientResult {
  if (error) {
    return { recipients: [], needsMigration: isMissingFunction(error), error: error.message ?? "Couldn't load recipients." };
  }
  const recipients = ((data ?? []) as { id: string; name: string | null; email: string | null }[])
    .filter((r) => r.email)
    .map((r) => ({ id: r.id, name: r.name?.trim() || "Member", email: r.email!.trim() }));
  return { recipients, needsMigration: false, error: null };
}

/** Every member (app admins only — the RPC enforces it). */
export async function fetchAllRecipients(): Promise<RecipientResult> {
  const sb = supabase;
  if (!sb) return { recipients: [], needsMigration: false, error: null };
  const { data, error } = await sb.rpc("all_member_recipients");
  return toResult(data, error);
}

/** One committee's roster (its Lead or an app admin — the RPC enforces it). */
export async function fetchCommitteeRecipients(committeeId: string): Promise<RecipientResult> {
  const sb = supabase;
  if (!sb) return { recipients: [], needsMigration: false, error: null };
  const { data, error } = await sb.rpc("committee_member_recipients", { cid: committeeId });
  return toResult(data, error);
}

/**
 * Build a `mailto:` link that drops everyone into the **To** field (addresses
 * are already visible across the app, so no BCC — this also lets people
 * reply-all). Emails are de-duplicated and comma-joined in the path; the
 * subject (if any) is URL-encoded as a query param, matching the app's other
 * mailto links (CommitteeJoin, FestStatus).
 */
export function mailtoUrl(emails: string[], subject?: string): string {
  const to = Array.from(new Set(emails.map((e) => e.trim()).filter(Boolean))).join(",");
  const s = subject?.trim();
  return `mailto:${to}${s ? `?subject=${encodeURIComponent(s)}` : ""}`;
}

/** Above this many recipients, some mail apps truncate or refuse the mailto —
 *  the composer nudges toward "Copy addresses" as a fallback. */
export const MAILTO_WARN_COUNT = 50;
