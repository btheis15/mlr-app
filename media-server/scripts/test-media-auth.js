#!/usr/bin/env node
/**
 * Regression tests for media-auth.js token signing/verification.
 *
 * WHY THIS FILE EXISTS: turning MEDIA_AUTH on caused a fleet-wide outage — every photo
 * in the app 403'd — because generating a dedicated MEDIA_TOKEN_SECRET silently ROTATED
 * away from the SUPABASE_SERVICE_ROLE_KEY fallback that already-issued tokens were
 * signed with, and single-key verification rejected all of them. The multi-key
 * acceptance that prevents a repeat is invisible until it fails, and it fails as a
 * total media outage. So it gets tests.
 *
 * Run: node media-server/scripts/test-media-auth.js
 * Exits non-zero on failure, so it can gate a deploy.
 *
 * Deliberately dependency-free (no jest/vitest in this repo) and it never prints a key.
 */
const path = require("path");
const crypto = require("crypto");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const AUTH_PATH = path.join(__dirname, "..", "media-auth.js");

/** Load media-auth.js fresh under a given env (it reads process.env at module scope). */
function loadWith(env) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  delete require.cache[require.resolve(AUTH_PATH)];
  const mod = require(AUTH_PATH);
  return {
    mod,
    restore() {
      for (const k of Object.keys(saved)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      delete require.cache[require.resolve(AUTH_PATH)];
    },
  };
}

/** Mint a token the same way the module does, for an arbitrary key/window. */
function mint(key, windowIndex, ttlMs) {
  const w = windowIndex === undefined ? Math.floor(Date.now() / ttlMs) : windowIndex;
  const sig = crypto.createHmac("sha256", key).update(`media:${w}`).digest("base64url").slice(0, 43);
  return `${w}.${sig}`;
}

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL  ${name}\n        got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const KEY_A = "primary-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "legacy-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const KEY_SRK = "service-role-key-cccccccccccccccccccccccccc";
const KEY_EVIL = "attacker-key-dddddddddddddddddddddddddddddd";

// ── 1. Single key: the basics ────────────────────────────────────────────────────
{
  const { mod, restore } = loadWith({
    MEDIA_TOKEN_SECRET: KEY_A,
    SUPABASE_SERVICE_ROLE_KEY: undefined,
    MEDIA_TOKEN_SECRETS_LEGACY: undefined,
    MEDIA_AUTH: "on",
  });
  const ttl = mod.TTL_MS;
  const now = Math.floor(Date.now() / ttl);

  check("issued token verifies", mod.verifyToken(mod.issueToken().token), true);
  check("current window verifies", mod.verifyToken(mint(KEY_A, now, ttl)), true);
  check("previous window verifies", mod.verifyToken(mint(KEY_A, now - 1, ttl)), true);
  check("two windows old rejected", mod.verifyToken(mint(KEY_A, now - 2, ttl)), false);
  check("future window rejected", mod.verifyToken(mint(KEY_A, now + 1, ttl)), false);
  check("wrong key rejected", mod.verifyToken(mint(KEY_EVIL, now, ttl)), false);
  check("empty rejected", mod.verifyToken(""), false);
  check("null rejected", mod.verifyToken(null), false);
  check("no separator rejected", mod.verifyToken("abcdef"), false);
  check("non-numeric window rejected", mod.verifyToken(`abc.${"x".repeat(43)}`), false);
  check("truncated signature rejected", mod.verifyToken(`${now}.short`), false);
  check(
    "signature of a DIFFERENT window rejected (no cross-window replay)",
    mod.verifyToken(`${now}.${mint(KEY_A, now - 1, ttl).split(".")[1]}`),
    false
  );
  restore();
}

// ── 2. The outage scenario: adopting a dedicated secret must not break old tokens ─
{
  const { mod, restore } = loadWith({
    MEDIA_TOKEN_SECRET: KEY_A, // newly adopted dedicated key
    SUPABASE_SERVICE_ROLE_KEY: KEY_SRK, // what tokens were ALREADY signed with
    MEDIA_TOKEN_SECRETS_LEGACY: undefined,
    MEDIA_AUTH: "on",
  });
  const ttl = mod.TTL_MS;
  const now = Math.floor(Date.now() / ttl);

  check("new primary key verifies", mod.verifyToken(mint(KEY_A, now, ttl)), true);
  check(
    "⭐ pre-existing service-role-signed token STILL verifies (the outage)",
    mod.verifyToken(mint(KEY_SRK, now, ttl)),
    true
  );
  check("service-role token, previous window", mod.verifyToken(mint(KEY_SRK, now - 1, ttl)), true);
  check("service-role token, too stale", mod.verifyToken(mint(KEY_SRK, now - 2, ttl)), false);
  check("attacker key still rejected", mod.verifyToken(mint(KEY_EVIL, now, ttl)), false);
  check("issues with the PRIMARY, not the fallback", mod.issueToken().token, mint(KEY_A, now, ttl));
  restore();
}

// ── 3. Explicit legacy list (a real rotation) ────────────────────────────────────
{
  const { mod, restore } = loadWith({
    MEDIA_TOKEN_SECRET: KEY_A,
    SUPABASE_SERVICE_ROLE_KEY: undefined,
    MEDIA_TOKEN_SECRETS_LEGACY: `${KEY_B} , ${KEY_SRK}`, // whitespace tolerated
    MEDIA_AUTH: "on",
  });
  const ttl = mod.TTL_MS;
  const now = Math.floor(Date.now() / ttl);

  check("primary verifies", mod.verifyToken(mint(KEY_A, now, ttl)), true);
  check("first legacy verifies", mod.verifyToken(mint(KEY_B, now, ttl)), true);
  check("second legacy verifies", mod.verifyToken(mint(KEY_SRK, now, ttl)), true);
  check("unlisted key rejected", mod.verifyToken(mint(KEY_EVIL, now, ttl)), false);
  check("legacy keys are ACCEPTED not ISSUED", mod.issueToken().token, mint(KEY_A, now, ttl));
  restore();
}

// ── 4. Enforcement flag + always-public paths ───────────────────────────────────
{
  const off = loadWith({ MEDIA_AUTH: "off", MEDIA_TOKEN_SECRET: KEY_A });
  check("MEDIA_AUTH=off disables enforcement", off.mod.ENABLED, false);
  off.restore();

  const on = loadWith({ MEDIA_AUTH: "ON", MEDIA_TOKEN_SECRET: KEY_A });
  check("MEDIA_AUTH is case-insensitive", on.mod.ENABLED, true);
  check("/privacy always public", on.mod.isAlwaysPublic("/privacy"), true);
  check("/assets/* always public", on.mod.isAlwaysPublic("/assets/venmo.png"), true);
  check("a media path is NOT always public", on.mod.isAlwaysPublic("/posts/2026-06/x.jpg"), false);
  check(
    "a path merely CONTAINING /assets/ is not exempt (no substring bypass)",
    on.mod.isAlwaysPublic("/posts/nope/assets/x.jpg"),
    false
  );
  on.restore();
}

// ── 4b. Path traversal (a REAL bypass, found by an adversarial audit probe) ──────
//
// `GET /f/assets/%2e%2e/posts/2026-06/<uuid>.jpg` returned 200 with NO token and the
// full private photo: requireMediaToken is mounted at /f, so req.path was
// `/assets/%2e%2e/…`, which satisfied the old startsWith("/assets/") exemption and
// skipped the token check — then express.static normalized `..` and served the file.
{
  const { mod, restore } = loadWith({ MEDIA_TOKEN_SECRET: KEY_A, MEDIA_AUTH: "on" });
  const unsafe = [
    ["the actual exploit", "/assets/%2e%2e/posts/2026-06/x.jpg"],
    ["plain dot-dot", "/assets/../posts/2026-06/x.jpg"],
    ["double-encoded", "/assets/%252e%252e/posts/x.jpg"],
    ["triple-encoded", "/assets/%25252e%25252e/posts/x.jpg"],
    ["uppercase encoding", "/assets/%2E%2E/posts/x.jpg"],
    ["encoded slash after dot-dot", "/assets/..%2fposts/x.jpg"],
    ["encoded dot-dot + encoded slash", "/assets/%2e%2e%2fposts/x.jpg"],
    ["dot-dot at end", "/posts/2026-06/.."],
    ["dot-dot at start", "/../media-server/.env"],
    ["bare dot-dot", "/.."],
    ["backslash separator", "/assets/..\\posts/x.jpg"],
    ["NUL byte", "/posts/x.jpg\u0000.txt"],
    ["malformed percent-encoding", "/posts/%zz/x.jpg"],
    ["deep traversal", "/a/b/c/../../../../../etc/passwd"],
  ];
  for (const [name, p] of unsafe) check(`traversal rejected: ${name}`, mod.pathIsSafe(p), false);

  // Must not break real paths — a false positive here is a media outage.
  const safe = [
    ["normal photo", "/posts/2026-06/abc-123.jpg"],
    ["thumbnail", "/posts/2026-06/abc-123_thumb.jpg"],
    ["preserved original", "/posts/2026-07/abc_orig.mov"],
    ["dropbox item", "/dropbox/0000fe57-2026-4000-8000-000000000001/2026-08/a.jpg"],
    ["hls segment", "/posts/2026-07/vid_hls/720p/seg00001.ts"],
    ["hls master", "/posts/2026-07/vid_hls/master.m3u8"],
    ["chat media", "/chat/beautification/2026-08/x.jpg"],
    ["legacy flat url", "/abc-123.jpg"],
    ["multiple dots in filename", "/posts/2026-06/a.b.c.jpg"],
    ["dot-dot INSIDE a filename (not a segment)", "/posts/2026-06/a..b.jpg"],
    ["encoded space in filename", "/posts/2026-06/my%20photo.jpg"],
    ["single-dot-prefixed name", "/posts/2026-06/.hidden.jpg"],
  ];
  for (const [name, p] of safe) check(`legit path allowed: ${name}`, mod.pathIsSafe(p), true);

  // The exemption function still exists for out-of-/f callers, but note what it says:
  // it is NOT consulted by requireMediaToken any more. Guard against regression by
  // asserting the crafted path WOULD have matched it (i.e. the bypass was real).
  check(
    "the exploit path does satisfy the old prefix exemption (bypass was real)",
    mod.isAlwaysPublic("/assets/%2e%2e/posts/2026-06/x.jpg"),
    true
  );
  restore();
}

// ── 5. No signing key at all ────────────────────────────────────────────────────
{
  const { mod, restore } = loadWith({
    MEDIA_TOKEN_SECRET: undefined,
    SUPABASE_SERVICE_ROLE_KEY: undefined,
    MEDIA_TOKEN_SECRETS_LEGACY: undefined,
    MEDIA_AUTH: "on",
  });
  check("no key ⇒ nothing verifies", mod.verifyToken("1.aaaa"), false);
  check("no key ⇒ zero accepted keys", mod.ACCEPTED_KEYS.length, 0);
  restore();
}

console.log(`\n  media-auth: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
