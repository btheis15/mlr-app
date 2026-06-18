// Seed moderation_blocklist from a public profanity dataset (LDNOOBW) so the
// text gate's word list is maintained from public data, not hand-curated.
// Idempotent — upserts on the unique `pattern`. Re-run anytime to refresh.
//
//   cd media-server && node seed-blocklist.js
//
// IMPORTANT: run the whole-word matching update for moderate_content_text FIRST
// (see the SQL handed over with this change). Without it, the gate substring-
// matches and a public list would over-flag innocent words (bass, hello, …).
// With whole-word matching, list terms only trip on the actual word.

require("dotenv").config();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const LIST_URL =
  process.env.BLOCKLIST_URL ||
  "https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en";

(async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in media-server/.env");
    process.exit(1);
  }
  console.log(`Fetching public bad-words list:\n  ${LIST_URL}`);
  const res = await fetch(LIST_URL);
  if (!res.ok) {
    console.error(`Fetch failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const raw = await res.text();
  const terms = [
    ...new Set(
      raw
        .split(/\r?\n/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 3) // skip 1–2 char noise
    ),
  ];
  console.log(`Loaded ${terms.length} unique terms (≥3 chars).`);

  const rows = terms.map((pattern) => ({ pattern, note: "public list (LDNOOBW)" }));
  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/moderation_blocklist`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) {
      console.error(`Batch at ${i} failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      process.exit(1);
    }
    done += chunk.length;
    console.log(`  upserted ${done}/${rows.length}`);
  }
  console.log("✓ Blocklist seeded from the public list.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
