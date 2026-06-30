// Work Checklist "did it get done?" follow-up — runs on the mini alongside
// push-sender / apns-sender / birthday-notifier.
//
// When an "Ask for Help" request is linked to a Work Checklist task, the app
// stamps help_requests.work_item_id + followup_at (a future time) and leaves
// followup_sent = false (migration: help_requests.work_item_id / followup_at /
// followup_sent + a partial index). Once followup_at passes, if the linked task
// is STILL open we push the requester "Did it get done?"; either way we stamp
// followup_sent = true so it never re-fires.
//
// Delivery reuses the SAME APNs sender module as apns-sender.js
// (createApnsDelivery → sendToUser), reading device tokens from apns_subscriptions
// and routing per-token sandbox/production.
//
// DORMANT unless SUPABASE_SERVICE_ROLE_KEY + APNS_* are set (same env as
// apns-sender). If the followup columns aren't deployed yet it logs once and
// stops the poll (rather than erroring every interval).

const POLL_MS = Math.max(60 * 1000, Number(process.env.WORK_FOLLOWUP_POLL_MS || 10 * 60 * 1000));

async function start() {
  const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  // Same APNs transport push-sender/apns-sender use (ES256 JWT + http2).
  const { createApnsDelivery } = require("./apns-sender");
  const apns = createApnsDelivery();

  if (!SUPABASE_URL || !SERVICE_KEY || !apns) {
    console.log("[work-followup] dormant (needs SUPABASE_SERVICE_ROLE_KEY + APNS_*, same as apns-sender)");
    return;
  }

  let createClient;
  try {
    ({ createClient } = require("@supabase/supabase-js"));
  } catch (e) {
    console.error("[work-followup] missing @supabase/supabase-js:", e && e.message);
    return;
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let timer = null;

  const tick = async () => {
    const nowIso = new Date().toISOString();
    // Due follow-ups: linked to a task, not yet sent, and past their time.
    const { data: rows, error } = await sb
      .from("help_requests")
      .select("id, user_id, work_item_id, work_items:work_item_id ( status, title )")
      .not("work_item_id", "is", null)
      .eq("followup_sent", false)
      .lte("followup_at", nowIso);

    if (error) {
      // Schema not deployed yet (missing column / no FK relationship) → go quiet
      // instead of erroring on every poll.
      const code = error.code || "";
      if (code === "42703" || code === "PGRST200" || code === "PGRST204" ||
          /does not exist|could not find|relationship|schema cache/i.test(error.message || "")) {
        console.log(`[work-followup] dormant (followup columns not deployed yet: ${error.message})`);
        if (timer) clearInterval(timer);
        return;
      }
      console.error("[work-followup] query error:", error.message);
      return;
    }

    if (!rows || !rows.length) return;

    let pushed = 0;
    let skipped = 0;
    for (const r of rows) {
      // PostgREST may return the embedded row as an object or a 1-element array.
      const wi = Array.isArray(r.work_items) ? r.work_items[0] : r.work_items;
      const status = wi && wi.status;
      const title = (wi && wi.title) || "your task";
      try {
        if (status === "open") {
          await apns.sendToUser(sb, r.user_id, {
            title: "Did it get done?",
            body: `Earlier you asked for help with "${title}". Is it finished?`,
            category: "WORK_FOLLOWUP",
            userInfo: { work_item_id: String(r.work_item_id), request_id: String(r.id) },
          });
          pushed++;
        } else {
          // Task already done (or removed) — send nothing, but still mark it.
          skipped++;
        }
        // Every processed row is stamped so it never fires again.
        await sb.from("help_requests").update({ followup_sent: true }).eq("id", r.id);
      } catch (e) {
        console.error(`[work-followup] row ${r.id} error:`, e && e.message);
      }
    }
    if (pushed || skipped) console.log(`[work-followup] processed ${rows.length} (pushed ${pushed}, already-done ${skipped})`);
  };

  timer = setInterval(() => tick().catch((e) => console.error("[work-followup] tick error:", e && e.message)), POLL_MS);
  await tick().catch((e) => console.error("[work-followup] tick error:", e && e.message));
  console.log(`[work-followup] watching (every ${Math.round(POLL_MS / 60000)} min)`);
}

module.exports = { start };
