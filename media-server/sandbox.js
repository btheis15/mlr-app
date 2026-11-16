// App Review sandbox guard (migration 0226). Accounts in public.sandboxed_accounts
// (the App Store review account) must never cause a push/email to other members.
// The senders run as service role (bypass RLS), so each handler checks the actor
// here. One cached `select user_id` per ~5 min; FAILS OPEN (false + one log) if the
// query errors (e.g. sender deployed before the migration).
const TTL_MS = 5 * 60 * 1000;
let cache = { ids: new Set(), at: 0 };
let warned = false;

async function isSandboxed(sb, userId) {
  if (!userId) return false;
  if (Date.now() - cache.at > TTL_MS) {
    try {
      const { data, error } = await sb.from("sandboxed_accounts").select("user_id");
      if (error) throw error;
      cache = { ids: new Set((data || []).map((r) => r.user_id)), at: Date.now() };
    } catch (err) {
      if (!warned) { warned = true; console.error("[sandbox] lookup failed, failing open:", err && err.message); }
      cache = { ids: new Set(), at: Date.now() };
    }
  }
  return cache.ids.has(userId);
}

module.exports = { isSandboxed };
