// Apple Intelligence wording check for EVERYTHING people write — Feed posts,
// comments, and committee / house / event chat (migration 0222).
//
// This replaced the keyword blocklist. A word list can't read a sentence: it held
// posts for containing a fragment, and it would never catch something hurtful
// written in ordinary words. Each item is now judged IN CONTEXT by the same
// moderateText() (moderation.js → the mini's local `fm serve`) the post composer
// already used — and that composer check was the ONLY place Apple Intelligence
// ran; comments and chat had nothing but the word list.
//
// How it runs (no client latency — nobody waits on the model to send a message):
//   • realtime INSERT/UPDATE on the five tables → check that row now;
//   • a sweep every SWEEP_MS over the last LOOKBACK_HOURS → catches anything
//     missed while the mini was off, realtime dropped, or the model was out.
// Flagged → ai_hold_content() holds it (status 'pending') and logs the model's
// reason, which Admin → Content review shows. Same post-moderation shape as photos
// and video: visible for the few seconds the check takes, then held.
//
// ai_text_checks records the hash of the text each item was judged on, so an
// unchanged item is never re-checked — in particular an admin's APPROVE (which is
// an UPDATE) doesn't get the item re-held. An edit changes the hash and is
// re-judged. FAIL-OPEN: if the model can't answer, nothing is recorded and the
// next sweep tries again.

const crypto = require("crypto");
const { moderateText } = require("./moderation");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ENABLED = process.env.MOD_ENABLED !== "0" && process.env.MOD_ENABLED !== "false" && process.env.TEXT_MODERATION !== "off";
const SWEEP_MS = Number(process.env.TEXT_MOD_SWEEP_MS || 10 * 60 * 1000);
const LOOKBACK_HOURS = Number(process.env.TEXT_MOD_LOOKBACK_HOURS || 48);

const SOURCES = [
  { type: "post", table: "posts", hasDeleted: false },
  { type: "comment", table: "post_comments", hasDeleted: false },
  { type: "committee_message", table: "committee_messages", hasDeleted: true },
  { type: "house_message", table: "house_messages", hasDeleted: true },
  { type: "event_chat_message", table: "event_chat_messages", hasDeleted: true },
];

let sb = null;
const queue = [];
const queued = new Set();
let draining = false;
let checksReady = true; // false pre-0222: nothing to record against

const hashOf = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);

// Which rows are worth judging. A post the composer already held (pending) is
// still judged once, purely so its reason gets on record; anything else that
// isn't visible has already been decided by an admin or another hold.
function wants(src, row) {
  const text = (row.text || "").trim();
  if (!text) return false;
  if (src.hasDeleted && row.deleted_at) return false;
  if (row.status === "visible") return true;
  return src.type === "post" && row.status === "pending";
}

function enqueue(src, row) {
  if (!wants(src, row)) return;
  const key = `${src.type}:${row.id}`;
  if (queued.has(key)) return;
  queued.add(key);
  queue.push({ src, row, key });
  drain();
}

async function alreadyChecked(src, id, hash) {
  if (!checksReady) return false;
  const { data, error } = await sb
    .from("ai_text_checks")
    .select("text_hash")
    .eq("entity_type", src.type)
    .eq("entity_id", id)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01") checksReady = false;
    return false;
  }
  return !!data && data.text_hash === hash;
}

async function checkOne({ src, row }) {
  const text = row.text.trim();
  const hash = hashOf(text);
  if (await alreadyChecked(src, row.id, hash)) return;

  const v = await moderateText(text);
  if (!v) return; // couldn't check — leave it unrecorded so the sweep retries

  if (v.flagged) {
    const { error } = await sb.rpc("ai_hold_content", {
      p_entity_type: src.type,
      p_entity_id: row.id,
      p_reason: v.reason || null,
      p_category: v.category || null,
    });
    if (error) {
      console.error(`[text-mod] hold ${src.type} ${row.id} failed: ${error.message}`);
      return; // don't record — retry next sweep
    }
    console.log(`[text-mod] held ${src.type} ${row.id} (${v.category}: ${v.reason})`);
  }

  if (checksReady) {
    const { error } = await sb.from("ai_text_checks").upsert({
      entity_type: src.type,
      entity_id: row.id,
      text_hash: hash,
      flagged: !!v.flagged,
      checked_at: new Date().toISOString(),
    });
    if (error && error.code === "42P01") checksReady = false;
  }
}

// One at a time: fm serve is a single local model, and a burst of chat should
// queue rather than pile concurrent requests onto it.
async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try {
        await checkOne(job);
      } catch (e) {
        console.error(`[text-mod] ${job.key}: ${e && e.message}`);
      } finally {
        queued.delete(job.key);
      }
    }
  } finally {
    draining = false;
  }
}

async function sweep() {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  for (const src of SOURCES) {
    const cols = `id, text, status${src.hasDeleted ? ", deleted_at" : ""}`;
    const { data, error } = await sb.from(src.table).select(cols).gte("created_at", since).limit(2000);
    if (error) {
      console.error(`[text-mod] sweep ${src.table}: ${error.message}`);
      continue;
    }
    for (const row of data || []) enqueue(src, row);
  }
}

async function start() {
  if (!ENABLED) {
    console.log("[text-mod] disabled (MOD_ENABLED off or TEXT_MODERATION=off)");
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.log("[text-mod] dormant (set SUPABASE_SERVICE_ROLE_KEY to enable)");
    return;
  }
  const { createClient } = require("@supabase/supabase-js");
  sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Realtime can silently drop; resubscribe like push-sender / alert-mailer. The
  // sweep is the backstop for anything missed in between.
  let channel = null;
  let reconnecting = false;
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("text-moderation");
    for (const src of SOURCES) {
      for (const event of ["INSERT", "UPDATE"]) {
        channel = channel.on("postgres_changes", { event, schema: "public", table: src.table }, (e) =>
          enqueue(src, e.new || {}),
        );
      }
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[text-mod] listening (posts + comments + committee/house/event chat) — Apple Intelligence, no word list");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.warn(`[text-mod] realtime ${status} — resubscribing`);
        if (!reconnecting) {
          reconnecting = true;
          setTimeout(() => { reconnecting = false; subscribe(); }, 5000);
        }
      }
    });
  }
  subscribe();

  const runSweep = () => sweep().catch((e) => console.error(`[text-mod] sweep: ${e && e.message}`));
  setTimeout(runSweep, 30 * 1000);
  setInterval(runSweep, SWEEP_MS).unref();
}

module.exports = { start };
