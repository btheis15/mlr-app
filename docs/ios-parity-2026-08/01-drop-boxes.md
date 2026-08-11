<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **11 correction(s)** were applied.

### Drop Boxes (shared downloadable albums)

The family's account-free replacement for a Google Drive shared folder: named albums that any approved member can dump photos/videos into, everyone can browse, and — unlike the Feed — **download**, originals included, for photo books. The Family Fest 2026 album lives here. This is the biggest thing iOS is missing.

Web surface for reference: `app/drop/page.tsx` → `components/DropBoxes.tsx` (1150 lines), client seam `lib/dropBoxes.ts`, hooks `useDropBoxes()` / `useDropBox(id)` in `lib/hooks.ts`. Migrations `0171`–`0180` plus `0183`.

There is **no backend work to do** for a straight port, with one real exception called out under *Moderation* below (a retroactive-hold gap). Everything else already exists.

---

#### 1. Screen model

One screen, two states, switched by a query param — not a nested route:

- `/drop` → list of albums (2-col grid of cover tiles)
- `/drop?box=<uuid>` → one open album (3-col thumb grid → full-screen swipe carousel)

So the shareable link is literally `/drop?box=<uuid>`. On iOS: one `NavigationStack` with `AlbumsListView` → `AlbumDetailView(boxId:)`, and map the universal link / deep link `…/drop?box=<uuid>` to pushing the detail view directly. The fest CTAs (`FamilyFestSpotlight`, `FestStatus`) and Home call-outs already emit that URL shape, so honoring it is not optional if you want those buttons to work.

#### 2. Schema

**`public.drop_boxes`** (0171)

| column | type | notes for Swift |
|---|---|---|
| `id` | uuid PK, `gen_random_uuid()` | |
| `title` | text **NOT NULL** | non-optional `String` |
| `emoji` | text NULL | `String?` |
| `created_by` | uuid NOT NULL → `profiles(id)`, default `auth.uid()` | non-optional `UUID`/`String` |
| `archived_at` | timestamptz NULL | `Date?` — non-nil = archived |
| `created_at` | timestamptz NOT NULL default now() | |

**`public.drop_box_media`** (0171 + 0173 + 0174 + 0175)

| column | type | notes for Swift |
|---|---|---|
| `id` | uuid PK | |
| `box_id` | uuid NOT NULL → `drop_boxes(id)` **ON DELETE CASCADE** | |
| `storage_path` | text **NOT NULL** | ⚠️ misleading name: this is the **full public mini URL** (`https://mlr-media.duckdns.org/f/dropbox/<box>/<ym>/<uuid>.jpg`), not a relative path |
| `media_type` | text NOT NULL, CHECK in (`'image'`,`'video'`) | make it an enum, but decode defensively |
| `status` | text NOT NULL default `'visible'`, CHECK in (`'visible'`,`'pending'`,`'hidden'`) | |
| `uploaded_by` | uuid NOT NULL → `profiles(id)`, default `auth.uid()` | |
| `created_at` | timestamptz NOT NULL default now() | = upload time |
| `thumbnail_url` | text NULL (0173) | `String?` — small mini-generated preview |
| `captured_at` | timestamptz NULL (0174) | `Date?` — real shot date when known |
| `captured_at_source` | text NULL (0175), CHECK in (`'exif'`,`'video'`,`'file'`,`'post'`) | `String?` |

Index: `drop_box_media_box_idx (box_id, created_at desc)`. Both tables are in the `supabase_realtime` publication.

`home_callouts.drop_box_id` (uuid NULL → `drop_boxes(id)` ON DELETE SET NULL, migration 0172) lets an admin call-out deep-link into an album. Low priority for v1, but if you render call-outs already, honor this column.

#### 3. RLS read rules (one sentence each)

- **`drop_boxes`** — policy `drop_boxes_read`: readable by any **admin-approved** member (`is_approved_member()`), full stop; archived boxes are returned too (the web filters `archivedAt != nil` client-side).
- **`drop_box_media`** — policy `drop_box_media_read`: readable by an approved member **and** only when `status = 'visible'` **or** `uploaded_by = auth.uid()` **or** the caller `is_admin`.
- **`profiles`** (needed to resolve names) — policy `profiles: member read`: `is_approved_member() OR id = auth.uid()`, so an unverified member can read only their own row.

⚠️ **An empty album list almost always means "this account isn't approved yet", not "no albums".** `is_approved_member()` (migration 0181) is `profiles.approved is true OR is_admin is true`; new signups default to `approved = false` — **except** the ones migration 0182 auto-approves, whose email was already on `committee_roster`/`family_roster` (the same email key that auto-links a roster slot), so some brand-new accounts land approved on first sign-in. Migration 0183 swapped 29 read policies onto the predicate. Build an explicit "waiting for an admin to verify you" state and show it when `profiles.approved == false` for the current user (you can always read your own row), rather than rendering "No albums yet". The media server returns the same signal as HTTP **403 with `{"pendingApproval": true}`** on `/media-token`, `/upload` and `/dropbox-zip` — treat that JSON flag as the canonical "unapproved" marker, and note there is no third state to handle: the mini's `isApprovedMemberByToken()` returns "couldn't determine" as **allow** (pre-migration column, transient error), so you either get served or you get the 403.

⚠️ **There are NO write policies on either table.** Any direct `.from("drop_boxes").insert(...)` / `.update(...)` / `.delete(...)` from the client fails. Every write is a `SECURITY DEFINER` RPC (below). Don't waste an hour on "why does my insert 403".

#### 4. Reads

The web does one embedded select per fetch (`lib/dropBoxes.ts`):

```
drop_boxes
  .select("id, title, emoji, created_by, archived_at, created_at, " +
          "drop_box_media(id, storage_path, thumbnail_url, media_type, status, uploaded_by, created_at, captured_at)")
  .order("created_at", ascending: false)          // list
  .eq("id", boxId).maybeSingle()                  // detail
```

`captured_at_source` is deliberately **not** selected by the web reader — nothing in the UI reads it; it exists so the mini's sweep can rank provenance. Select it only if you want to show provenance.

Notes:
- `drop_boxes` has exactly one FK from `drop_box_media`, so this embed is unambiguous. (This codebase has been bitten by PostgREST returning `[]` with HTTP 300 / `PGRST201` when two FKs link two tables — not a risk here, but if you ever add a second FK, name it: `drop_box_media!fk_name(...)`.)
- Nested rows come back already RLS-filtered: someone else's held item is simply **absent** from the array, so your item count is "visible to me", not the true count. That's the intended behavior; the web's `count` is exactly `items.count`.
- The web resolves display names with **one bulk call** per fetch: collect every distinct `created_by` + `uploaded_by`, then `profiles.select("id, display_name, avatar_url").in("id", ids)`, falling back to the literal string `"Member"` when `display_name` is blank/absent. Do the same — do not fetch a name per row.

⚠️ **Timestamp decoding will bite you.** PostgREST returns timestamptz as e.g. `2026-08-09T14:22:03.481291+00:00`, and Postgres trims trailing zeros so the fractional part varies in length (sometimes absent entirely). `JSONDecoder.DateDecodingStrategy.iso8601` **rejects fractional seconds**, and a fixed-format `ISO8601DateFormatter` with `.withFractionalSeconds` rejects the ones without. Use a custom `.custom` strategy that tries both, or decode the four timestamptz columns (`drop_boxes.created_at`, `drop_boxes.archived_at`, `drop_box_media.created_at`, `drop_box_media.captured_at`) as `String` and parse lazily. The web compares the raw ISO strings lexicographically, which is safe because they're all UTC from the same server — if you keep them as strings, sorting is a plain string compare and you match web behavior byte-for-byte.

**Realtime**: subscribe to `postgres_changes` `event: "*"` on both `public.drop_boxes` and `public.drop_box_media`, **debounce ~250ms, and refetch the whole box** — that's what the web does (`useDropBox` additionally filters both subscriptions to this box's id). Do not try to apply row deltas: the payload doesn't carry the resolved uploader name, and RLS/status filtering plus your sort would have to be re-derived anyway.

#### 5. Every RPC, with real parameter names in order

Supabase RPC calls are keyed by parameter **name**, and PostgREST resolves overloads by the exact set of keys you send. Get these wrong and you get `PGRST202` ("Could not find the function … in the schema cache") at runtime, not a compile error.

| function | params in order | returns | who |
|---|---|---|---|
| `create_drop_box` | `p_title text`, `p_emoji text = null` | `uuid` | any signed-in member |
| `update_drop_box` | `p_box uuid`, `p_title text = null`, `p_emoji text = null` | `void` | box creator **or** admin |
| `set_drop_box_archived` | `p_box uuid`, `p_archived boolean` | `void` | creator or admin |
| `delete_drop_box` | `p_box uuid` | `void` | creator or admin |
| `add_drop_box_media` | `p_box uuid`, `p_url text`, `p_type text`, `p_thumbnail_url text = null`, `p_captured_at timestamptz = null`, `p_captured_at_source text = null`, `p_credit_user_id uuid = null` | `uuid` | any signed-in member |
| `remove_drop_box_media` | `p_media uuid` | `void` | item's uploader, box creator, or admin |
| `set_drop_box_media_status` | `p_media uuid`, `p_status text` (`'visible'`\|`'pending'`\|`'hidden'`) | `void` | **admin only** |

All seven are `grant execute … to authenticated`. ⚠️ Only `add_drop_box_media` also carries `revoke all … from public, anon` (0173, carried through 0180) — the other six were granted in 0171 with no revoke, and no migration revokes function execute from `PUBLIC` anywhere, so they technically keep Postgres's default PUBLIC grant. Nothing leaks: each one raises without `auth.uid()`, or without a creator/admin match. Just don't repeat "anon is revoked" as if the SQL said it.

Semantics you can't see from the signature:

- `update_drop_box`: `p_title = null` means **"leave the title alone"** (`coalesce(nullif(btrim(...),''), title)`); an empty/whitespace string also means leave it alone. `p_emoji = null` means "leave the emoji alone"; `p_emoji = ""` **clears** it. So in Swift you cannot express "clear the title" (it's NOT NULL — correct) and you must distinguish `nil` from `""` when sending the emoji. Send the params explicitly every time like the web does: `{p_box, p_title: title ?? null, p_emoji: emoji ?? null}`.
- `add_drop_box_media` rejects with `"That folder is not available."` when the box doesn't exist **or `archived_at is not null`** — you cannot add to an archived album. It rejects `"Unsupported media type."` for anything but `image`/`video`, and `"Sign in required."` with no session.
- `p_captured_at_source` is validated with a **silent fallback to `'exif'`**: if `p_captured_at` is non-null and the source string isn't one of the four valid values, the row is stamped `'exif'`. (With `p_captured_at` null, the source is forced to null.) ⚠️ That means a typo, or sending your own vocabulary ("photokit", "asset"), permanently marks a weak guess as authoritative real metadata, and the mini's backfill sweep will then **never** upgrade it (the sweep only moves a row *up* the ranking). Always send exactly `"exif"`, `"video"`, `"file"` or `"post"`, or send nothing.
- `set_drop_box_media_status` raises `"Admins only."` — check `isAdmin` before showing an Approve button, but still handle the throw.
- `delete_drop_box` cascades `drop_box_media` rows. Files on disk are **not** deleted by the RPC; the mini's `orphan-sweep.js` reconciles every 6h and quarantines what no row references, purging 7 days later — but it **skips any file whose mtime is inside a 48h grace window** (`ORPHAN_GRACE_HOURS`, because the client inserts its media row *after* `/upload` returns), so a file deleted the day it was uploaded lingers ~48h before it's even quarantined. (⚠️ Historical: before that sweep existed, one hard-deleted drop box left **438 photos / ~558 MB** stranded on disk forever. Don't add an iOS "delete" path that assumes files are gone immediately, and never assume a URL 404s just because its row is gone.)

Swift call shapes: the `uuid`-returning RPCs come back as a **bare JSON string** (`"3f1c…"`), so decode as `String` then `UUID(uuidString:)` — not as an object. The `void` ones return an empty body; call `.execute()` and don't try to decode. Because most params are nullable and heterogeneous, build the params dictionary as `[String: AnyJSON]` (supabase-swift) rather than a `Codable` struct with optionals, so `nil` is encoded as JSON `null` and the key is still present — a **missing** key changes overload resolution, a `null` value does not.

⚠️ **Do not port `lib/dropBoxes.ts`'s five-deep `PGRST202` retry ladder** for `add_drop_box_media` (7-arg → 6 → 5 → 4 → 3). That exists only because the web ships ahead of migrations, and it's dead weight now: every one of 0173/0174/0175/0180 explicitly `drop function`s the narrower overload it replaces, so exactly **one** signature exists in the database. Prod has 0180 applied; call the 7-param version. If you *do* get `PGRST202`, it means the schema cache is stale or the migration was rolled back — surface it, don't paper over it, because the silent degrade drops the credit/captured-at data.

#### 6. Uploads — `category=dropbox`, box id as `room`

The pipeline is the Feed's, with two query params changed:

```
POST {MEDIA_URL}/upload?category=dropbox&room={boxId}
  Authorization: Bearer <supabase access_token>
  multipart/form-data:
    file            = the raw file            (field name is exactly "file")
    capturedAt      = ISO8601 string          (optional)
    capturedAtSource = "exif" | "file"        (optional)
```

`MEDIA_URL` is `https://mlr-media.duckdns.org` (production; the `PRODUCTION_MEDIA_URL` constant in `lib/media.ts` — note `NEXT_PUBLIC_MEDIA_URL` is still set to the retired Tailscale host in Vercel and is deliberately ignored in code, so don't take the env var as truth). The mini files the bytes under `dropbox/<box-id>/<YYYY-MM>/` — **the box id rides in `?room`**, sanitized server-side by `safeSeg()` to lowercase `[a-z0-9_-]`, max 40 chars. A lowercase UUID survives that intact; ⚠️ an **uppercase** UUID is lowercased (the folder is fine, but keep your ids lowercase everywhere so you can find things on disk).

Raw response from the mini's `/upload`:

```json
{ "url": "...", "thumbnailUrl": "..."|null, "hlsUrl": "..."|null,
  "capturedAt": "..."|null, "capturedAtSource": "exif|video|file"|null,
  "name": "...", "originalName": "...", "type": "image|video|file", "path": "dropbox/<box>/<ym>/<uuid>.jpg" }
```

⚠️ `UploadResult` in `lib/media.ts` models only **six** of those (`url`, `thumbnailUrl`, `capturedAt`, `capturedAtSource`, `type`, `path`) — `hlsUrl`/`name`/`originalName` are on the wire but dropped by the web's parse, so don't go looking for them in the TS type. `hlsUrl` is **null unless the mini runs `HLS_ENABLED=on`** (default off), and it's advertised by convention before the background ladder exists, so always fall back to `url`.

Then attach it: `add_drop_box_media(p_box: boxId, p_url: url, p_type: "image"|"video", p_thumbnail_url: thumbnailUrl, p_captured_at: capturedAt, p_captured_at_source: capturedAtSource)` — i.e. pass the values the **server** returned, which is what the web does (it lets the mini's own read win over its client-side guess).

Hard-won lessons, all of which cost someone real time:

- ⚠️ **Do NOT re-encode or compress the photo on the client.** `prepareImageForUpload()` in `lib/media.ts` is now literally `return file` — it's an intentionally-kept no-op with a warning comment. It used to downscale to 1920px and re-encode at JPEG q0.82 through a `<canvas>`, which (a) destroyed the full-resolution original before it ever left the phone (a 48MP photo became 1920px q82, permanently) and (b) **stripped every byte of EXIF** — which is the root cause of the entire `captured_at` saga that migrations 0174/0175/0176 exist to undo. On iOS this means: hand `URLSession` the file bytes from `PHPickerResult.itemProvider.loadFileRepresentation` / `PHAssetResourceManager`, **not** `UIImage.jpegData(compressionQuality:)`. HEIC is fine — the mini converts it with a real image library (`sharp`) and keeps your original beside it.
- ⚠️ **Never construct the stored URL — always use the returned `url`.** A HEIC upload's served URL comes back as `.jpg`: the mini builds the browser-facing display copy **inline** (`makeDisplayCopy`, before it responds, precisely so the URL is final) and keeps the upload as `<uuid>_orig.heic`. Deriving the URL from the filename you sent produces a 404.
- ⚠️ **A video's URL can be repointed a few minutes later.** Transcode is now background; a cross-extension transcode (`.mov` → `.mp4`) keeps the original playable until the mini has PATCHed every `*_media` row's `storage_path` to the new URL (`swapMediaStoragePath`), then deletes it. So do not treat `storage_path` as a stable identity key or cache it in a way that survives the swap — key your local cache on `drop_box_media.id`. The web's optimistic tile matches on URL and therefore carries an explicit **12-second timeout fallback** to stop a tile spinning forever when the URL changed underneath it; you'll want the equivalent, or just rely on realtime + refetch.
- ⚠️ **`/upload` is deliberately NOT rate-limited** (`globalLimiter`'s `skip` is `req.path === "/health" || req.path === "/upload"`), because a fest dump is hundreds of photos from one phone and any cap 429'd real uploads mid-dump. Everything else on the mini — including `/f` reads, `/media-token`, `/dropbox-zip` — shares a **600 requests / 15 min per-IP** floor. A whole family behind one lake WiFi IP collapses to one key, so don't hammer `/f` with speculative prefetches.
- Concurrency: the web uploads **3 at a time** (`LIMIT = 3`) so a big batch overlaps on the network without stampeding the mini's ffmpeg/moderation. Copy that number.
- Timeouts: server-side `UPLOAD_TIMEOUT_MS` defaults to **4 hours** and `MAX_MB` is 50 GB, but ⚠️ neither means a huge upload succeeds — bandwidth and the tunnel's body cap bind first. Set a generous `URLSessionConfiguration.timeoutIntervalForRequest`/`ForResource` and use a **background** session so a backgrounded app doesn't kill a large video mid-transfer. A client abort is handled server-side (the partial file is unlinked on socket close), so retrying is safe.
- Status codes to map to copy (the web's `uploadErrorMessage`): **507** = server out of storage ("tell an admin"), **413** = file too big, **415** = the magic-byte sniff says it isn't a photo or video at all (`"Only photos and videos can be uploaded."` — Tier 0; only `category=chat` is allowed non-media), **429** = upload limit (kept defensively; `/upload` itself is exempt from the limiter), **401/403** = sign-in expired **or** `pendingApproval`, network abort = "interrupted — check your connection". `/upload` sits behind `requireUser` **and** `requireApprovedMember`.
- Retry: keep the picked file around so a failed item can be re-sent in place without re-picking (the web's `Pending` struct holds the raw `File`; on iOS hold the temp file URL, and don't delete it until the row lands).
- CORS is irrelevant to you — native `URLSession` sends no `Origin`, so the mini's `ALLOWED_ORIGINS` allowlist doesn't apply. Don't chase a CORS ghost.
- The web picker is a plain always-mounted `<input>` triggered by a plain button, never from inside a popup, because an installed iOS PWA silently dropped the file otherwise. Irrelevant to native `PHPickerViewController` — but the *reason* it's written that way is documented in `DropBoxes.tsx`, so don't "fix" it if you ever touch the web.

#### 7. Every `/f` read needs a signed media token

This is not drop-box-specific, but it is the #1 way an album renders as 40 broken tiles. If your Posts feed already does this, reuse it verbatim.

⚠️⚠️ **Enforcement is currently `MEDIA_AUTH=report`, NOT `on`** — `media-server/media-auth.js` has three modes (`off` / `report` / `on`), and per `docs/ios-parity-2026-08.md` the mini was briefly `on` (verified on web: 220/220 signed requests) and then **deliberately backed off to `report` because the native app can't sign yet**. Two consequences: (1) unsigned `/f` reads today still return 200/206 and merely log a `WOULD-BLOCK` line, so your album will render *before* you implement any of this and "photos load" is **not** evidence the token works — verify with `grep WOULD-BLOCK …/media-server/logs/server.log` after actually scrolling an album and scrubbing a video; (2) it goes back to `on` as soon as iOS signs, at which point every unsigned URL 403s. Build the token.

- `GET {MEDIA_URL}/media-token` with `Authorization: Bearer <supabase jwt>` → `{ token, expiresAt, ttlHours }`. Behind `requireUser` **and** the approval gate (403 + `pendingApproval` for an unapproved member).
- Append it to **every** media URL: `…/f/…jpg?t=<urlencoded token>`. It's a query param on purpose: `<img>`/`AVPlayer` can't send headers, and a cookie would be third-party (Safari/iOS blocks those). It survives Range requests, which is why video seeking works.
- The token is an HMAC over a rounded 24h window, so it is **identical for every member in that window** — that's deliberate, so URLs are cache-stable. (`verifyToken` also accepts the previous window, so a link works 24–48h.)
- ⚠️ Cache it and refresh **a full minute before `expiresAt`**, so no URL can expire mid-flight. `lib/mediaToken.ts` does exactly that.
- ⚠️ Two production outages live in that file's comments, both worth knowing: (1) `/media-token` once sent `Cache-Control: private, max-age=600` with a stable ETag, so revalidation returned **304**, `res.ok` was false, the client concluded "no token", and **every photo in the app 403'd** (104 consecutive unsigned requests on one album observed live). Never treat a 304 as failure — fall back to your cached token. (2) The signing check was `url.startsWith(MEDIA_URL)`, and `MEDIA_URL` had gone stale against a retired Tailscale host while all ~1,700 stored URLs were on duckdns — so **every URL silently rendered unsigned**, indistinguishable from "no token yet". Match by **host against a known set** (`MEDIA_HOSTS`), not by prefix, and include the retired host `brians-mac-mini.tail49943c.ts.net` in that set because stored rows may still carry it.
- Don't append `?t=` to non-mini URLs (Supabase avatars, `data:`, local file URLs) and don't append it twice (check for an existing `t=`).
- Clear the token on sign-out (`clearMediaToken()`), so a shared device leaves nothing usable behind.

#### 8. Sorting: `captured_at` + `captured_at_source`

Sorting is **entirely client-side** over the already-fetched items, and is a **per-viewer, per-device viewing preference** that is never written to the DB — switching it cannot reorder the album for anybody else.

Two orders (`DropBoxSort` in `lib/dropBoxes.ts`):

- `"uploaded"` — **the default** — newest `created_at` first.
- `"captured"` — newest `captured_at ?? created_at` first (never hides an item for lacking metadata).

⚠️ **CLAUDE.md's Drop Box section says the grid sorts by capture date by default. It does not — the code default is `"uploaded"`** (`DROP_BOX_SORT_DEFAULT`), and the doc comment explains why: capture order made a freshly-uploaded photo scatter into the middle of the album by its shot date, which read as the app glitching or losing photos. Trust the code. Persist the toggle in `UserDefaults` (the web uses `localStorage` key `mlr.dropbox.sort` — device-local, deliberately not synced, so you don't need to match the key).

`captured_at_source` ranks four providers, best first: `'exif'` / `'video'` (real metadata read from the file) > `'file'` (the picked file's mtime) > `'post'` (the source post's own timestamp, an explicitly-marked proxy). The mini's periodic sweep may only ever move a row **up** this list. (The ranking is a convention in the sweep + comments; the DB only CHECKs membership in the four values.)

What iOS should send:

- Videos: send **nothing**. The mini reads the container's `creation_time` via `ffprobe` during `/upload` and returns `capturedAt` with source `'video'`.
- Photos: you can send nothing and let the mini read the stored bytes (it has a hand-rolled JPEG/TIFF IFD reader plus a `sharp`/libvips fallback that opens HEIC/WebP/AVIF/TIFF, and it deliberately reads the `_orig` upload, not the display copy). That is the simplest correct v1.
- If you do send a date, ⚠️ **the mini only trusts `'exif'` from a client** — any other claimed source is downgraded to `'file'` (`capturedAtSource = claimed === "exif" ? "exif" : "file"`), and `/upload` then **re-reads the stored bytes** whenever the client's claim is only `'file'`, letting real metadata win. So if you use `PHAsset.creationDate` (which is usually better than a file mtime), send it as **`"file"`**, not `"exif"`. Claiming `"exif"` makes the server skip its own read and locks in your value against all future upgrades. This is the single easiest way to permanently poison album ordering.
- The web's mtime heuristic (`capturedAtForFile`) rejects a timestamp that is missing, pre-1995, in the future, or **within 60 seconds of now** — because a picker that hands over a freshly-stamped temp copy is giving you upload time in disguise. `PHPickerViewController` file representations do exactly that. Keep the guard.

⚠️ **The 0174/0175 incident, because it generalizes.** 0174 added `captured_at` read client-side from the original file — and in practice did almost nothing, because the dominant path into the Family Fest album is *referencing an existing Feed post's photo*, where there is no `File` on the client at all, only a URL. All 48 items had `captured_at = null`; 41 of them had been bulk-added inside the **same second**, so near-duplicate shots scattered instead of sitting together. Because the sort falls back to upload time, the failure was **invisible** — it looked exactly like "these photos have no metadata". 0175 added the server-side sweep and the post-timestamp proxy (a SQL backfill joining `drop_box_media.storage_path` to `post_media`/`posts` and taking `min(coalesce(occurred_at, created_at))`, only where exactly one post owns the file), which spread those 41 photos back across 6 real days of the fest week. **Takeaway to carry into iOS: an enrichment that only runs at upload time covers none of the content already there, and a null-tolerant sort hides that completely.** If you add any derived field, plan the backfill in the same breath.

#### 9. Attribution: `created_by`, `uploaded_by`, and `p_credit_user_id`

Migration 0180. Every album shows who made it and the carousel shows who uploaded the item currently open:

- list tile: `"{count} items · by {createdByName}"` — with `"Empty · by {createdByName}"` for a zero-item album, and the count singularized (`1 item`)
- detail header: `"{count} items · created by {createdByName}"` (empty → `"Empty — be the first to add something · created by …"`)
- carousel: `"by {uploadedByName}"` under the `n / total` counter

Names come from the one bulk `profiles` fetch described in §4, keyed on `created_by` / `uploaded_by`, defaulting to `"Member"`.

⚠️ **The credit rule that surprised everyone:** when a Feed post's photo is referenced into an album from the post editor's "also add to an album" checkbox, credit goes to the **post's author**, not to whoever clicked the checkbox. The common case is an admin retroactively filing a member's old post into an album — it's still that member's photo. That's what `p_credit_user_id` is for, and it is honored **only when the caller is an admin, the target is a real `profiles` row, and the id differs from the caller's own**; a non-admin's value is silently ignored, so nobody can attribute an upload to someone else. The web passes `post.authorId` from `EditPostPanel` (both for newly-added and already-posted kept media) and deliberately passes **nothing** from the composer's own `alsoAlbum` flow, because there the poster *is* the caller.

For a v1 iOS album screen you will pass `p_credit_user_id: nil` everywhere — that's correct. Only wire it if you also build "add this post's photos to an album" from a post you may not own.

⚠️ **The "fix only covers what happens next" lesson, again:** 0180 corrected credit only for *new* adds. The live Family Fest album already had **41 rows** mis-credited to whichever admin had clicked the checkbox before the feature existed, and they were repaired with a one-off `update drop_box_media set uploaded_by = <post's author_id> … ` joined on `storage_path` back to `post_media`/`posts` (after verifying no `storage_path` mapped to more than one distinct author). No migration — it was a data correction. Check for this shape whenever a new derived-from-a-post field ships.

#### 10. Downloads — the deliberate difference from the Feed

**Per file** — append `dl=1` to the already-token-signed URL: `…/f/dropbox/<box>/<ym>/<uuid>.jpg?t=<token>&dl=1`.

- The mini responds with `Content-Disposition: attachment` **and, crucially, serves the preserved original, not the playback rendition**: a video's URL points at a bitrate-capped `.mp4` built for streaming, while the untouched file the family actually shot sits beside it as `<uuid>_orig.<ext>`. `?dl=1` hands back `_orig` when it exists (`findOriginal()` searches **both** storage volumes — originals are deliberately kept on the external drive), and falls through to the rendition when there isn't one. The download filename is derived from the original's extension with the internal `_orig` marker stripped.
- ⚠️ The `dl=1` handler sits **after** `requireMediaToken` on `/f`, so the `?t=` token is still mandatory. `t` first, then `dl` (order doesn't matter functionally; the web does it that way so its "already signed?" check stays predictable).
- iOS: `Content-Disposition` does nothing for you. Use a download task, write to a temp URL, then either `PHPhotoLibrary.shared().performChanges` to add to the camera roll (needs `NSPhotoLibraryAddUsageDescription`) or hand it to a share sheet. Parse the filename out of the `Content-Disposition` response header, or fall back to the URL's last path component — note the served extension may differ from what the row's URL says (`_orig` is a `.mov` behind an `.mp4`).

**Whole album or a selection as one `.zip`** — two endpoints on the mini, both streaming straight from the system `zip` binary (nothing buffered):

```
GET  {MEDIA_URL}/dropbox-zip?box=<uuid>&name=<safe-name>&token=<jwt>
POST {MEDIA_URL}/dropbox-zip     (application/x-www-form-urlencoded)
     token=<jwt>&box=<uuid>&name=<safe-name>&path=<rel>&path=<rel>&path=<rel>…
```

- ⚠️ **Both routes now require an APPROVED member**, not just a valid login (`isApprovedMemberByToken`). This was a real hole: the box id is a compile-time constant in the public web bundle (`FEST_ALBUM_BOX_ID`), so a stranger with a throwaway account could have streamed back the entire family album in one request. Unapproved → **403 `{"error": "An admin needs to approve your account before you can download photos.", "pendingApproval": true}`**.
- ⚠️ **Both routes accept `Authorization: Bearer <jwt>` as well as the query/body token** (`bearerToken(req)` is the fallback in both handlers). The query/body form exists only because a browser `<a download>` or form submit can't set headers. **From iOS, use the header and don't put the JWT in a URL** — it keeps a bearer token out of logs. Verified in `media-server/server.js`'s `app.get("/dropbox-zip")` / `app.post("/dropbox-zip")`.
- Each `path` field is the item's path **relative to the media ROOT** — everything after `/f/`, e.g. `posts/2026-07/<uuid>.jpg`. ⚠️ Root-relative, **not** box-relative, precisely so an album can include files stored elsewhere in the tree: a Feed photo referenced into an album physically lives under `posts/`, not `dropbox/<box>/`. For a freshly uploaded item the `/upload` response's `path` field is already exactly this string; for anything else, take the substring after `/f/` and strip the query (that's `mediaRelPath()` in `DropBoxes.tsx`). The server normalizes and rejects traversal, silently skipping any entry it can't resolve, and returns **400 `"No files selected."`** if nothing resolved.
- ⚠️ **Both modes zip the ORIGINALS, not the renditions** — the explicit-path branch swaps each resolved entry for its `_orig` file when one exists (`findOriginal(resolved) || resolved`), exactly like `?dl=1`. So a zip can be much larger than the sum of the files the rows' URLs point at; size your progress/disk expectations off the originals.
- The GET (no path list) mode enumerates `dropbox/<box>/` on both volumes and unions them, grouping by stem so it zips neither the `_thumb.jpg` previews nor both copies of a video (original wins), and skips HLS fragments. It **misses** items referenced from elsewhere in the tree — which is why the web always sends the explicit path list, even for "Download all". Do the same: POST with every item's path, for both "All" and "Selection". (That mode also has its own empty-result answer: **404 `"Nothing to download yet."`**, not the 400 above.)
- ⚠️ The POST body is parsed with `express.urlencoded({ limit: "512kb" })`. Each path is ~45–60 bytes, so a few thousand items fit, but a truly enormous album will 413. Chunk into multiple zips above ~5,000 items.
- The zip is streamed from `zip`'s stdout, so there is **no `Content-Length`** — you cannot show a percentage. Use indeterminate progress and a background `URLSession` download task; these can be hundreds of MB. The web can't detect "started" at all and just holds a busy state for 2.5s.
- ⚠️ The web's mechanism (hidden form → hidden iframe, so the browser saves natively without navigating away and without URL-length limits) **does not transfer and should not be imitated**. Native gets a plain POST + streamed download to disk, which is strictly better.

#### 11. Moderation — read this carefully, the docs are stale here

The documented design (migration 0171): the mini records an AI verdict in `media_moderation` keyed by the public URL *before* `/upload` responds; a BEFORE INSERT trigger `hold_drop_box_media_on_flagged` on `drop_box_media` reads that verdict and sets the **new row's own** `status = 'pending'` (the item *is* the content — there's no parent post to hold), logging to `content_moderation_events` with `entity_type = 'drop_box_media'`. Fail-open: no verdict row ⇒ stays `visible`. RLS then hides a held item from everyone but its uploader and admins; the grid badges it **"Held for review"**, and an admin releases it in the carousel via `set_drop_box_media_status(p_media:, p_status: "visible")`. `drop_box_media` is **not** wired into the `/admin` Content review queue (`moderation_queue()`/`set_content_status()` never learned the entity type), so the carousel is the only place to un-hold.

What is actually true in the code today, which I verified rather than assumed:

- ⚠️ **`/upload` no longer records the verdict before responding.** A perf pass made **every** category optimistic and fire-and-forget (`moderateMedia(...).then(...)` in `media-server/server.js`). So by the time your client calls `add_drop_box_media`, there is normally **no `media_moderation` row yet** and the BEFORE INSERT trigger finds nothing. New uploads therefore land `visible` essentially always.
- ⚠️ **And nothing holds them afterward.** The retroactive hold trigger `trg_hold_on_media_verdict` → `hold_content_on_media_verdict()` (defined in 0128, last recreated in 0162) updates `posts`, `post_comments`, `committee_messages` and `house_messages` — there is **no `drop_box_media` branch**. I grepped every migration: `hold_content_on_media_verdict` is defined only in `0128_chat_moderation.sql` (three blocks) and `0162_post_comment_media.sql` (which adds the `post_comments` fourth), and `drop_box_media` appears in neither. CLAUDE.md states that a flagged verdict retroactively holds a drop-box item "the same media_moderation trigger, 0128/0171" — **that claim is wrong.**
- Net effect: a drop-box upload is, in practice, **fail-open and final** — which happens to match the *intent* documented for drop boxes ("a shared family album should never strand photos behind an unreachable checker"), but for the wrong reason, and it now also lets through definitively-flagged content that the design says should be held. The only way an album item is born `pending` today is if a `media_moderation` row for that exact `storage_path` already existed — e.g. the same file was uploaded and flagged via a post first.
- **This is the one place a backend change may be wanted.** It is a ~15-line addition of a fifth `with held as (...)` block to `hold_content_on_media_verdict()`, updating `drop_box_media set status = 'pending' where status = 'visible' and storage_path = NEW.storage_path`. ⚠️ **Do not write it as part of the iOS work, and do not ship it silently — raise it with Brian.** Whether drop boxes *should* be retroactively held is a product decision he already has an opinion about, and this repo's rule is that a function must be recreated from its **current** live definition (`pg_policies`/`pg_proc`), never from an older migration's copy — the 0160 lesson. Also note DB changes here are handed over as SQL for Brian to run, not applied by tooling.

What iOS must build regardless:
- Render the `status != 'visible'` badge ("Held for review") — you *will* see held rows, because RLS shows you your own.
- Show the admin **Approve** action in the carousel when `isAdmin && item.status != "visible"`.
- Never let a member change their own item's status (there's no RPC for it; `set_drop_box_media_status` is admin-only).
- ⚠️ There is **no notification or push of any kind** for drop boxes — not a new album, not a new item, not a held item. Verified by grepping every migration (`drop_box` appears only in 0171–0176, 0180 and 0183, none of them notification code) and the notification surfaces the app actually has — the `NotifType`/`PushType` unions in `lib/types.ts` and `components/NotifPrefs.tsx`. (There is no `lib/notifications.ts`; the client-side notification helpers are `lib/activityNotify.ts` / `lib/notificationTest.ts`.) Don't promise the family one; adding it is genuinely new backend work.

#### 12. The Family Fest 2026 album has a fixed id

```
FEST_ALBUM_BOX_ID = "0000fe57-2026-4000-8000-000000000001"   // lib/data.ts
FEST_ALBUM_HREF   = "/drop?box=0000fe57-2026-4000-8000-000000000001"
```

(`0000fe57` = "fest", `2026` = the year.) The row is seeded by migration `0172_callout_drop_box_and_fest_album.sql` as `insert into drop_boxes (id, title, emoji, created_by) values ('0000fe57-…', 'Family Fest 2026: Ye Olde Family Feste', '🏰', coalesce(<oldest admin>, <oldest profile>)) on conflict (id) do nothing`, owned to an admin because `created_by` is NOT NULL and a seed row has no personal author (any admin can manage it anyway: `canManage = isAdmin || created_by == me`).

Hardcode the same constant in Swift so Home / fest-hub CTAs can deep-link straight in without a lookup, and ⚠️ **degrade gracefully to "This album isn't available."** if the row is missing — that's the documented behavior (and the web's exact copy), not an error state. Note the wrap-phase "upload your photos" CTAs now point here, **not** at the Feed: "post your photos" means the shared downloadable album.

#### 13. Web idioms that do not transfer

- `localStorage` for the sort preference and the media token → `UserDefaults` (sort) and in-memory + Keychain/`UserDefaults` (token). The token cache **must** keep `expiresAt` and drop the token a minute early.
- Canvas re-encoding: gone from the web and must not be reinvented on iOS (§6).
- Hidden form → hidden iframe for the zip: replaced by a background download task (§10).
- Optimistic upload tiles use `URL.createObjectURL` + revoke-on-unmount; on iOS use the picked asset's local URL / a `UIImage` you already have, and remember to clean up temp files.
- `object-URL` preview tiles are matched to their real DB row **by URL**; see the 12s fallback warning in §6.
- The carousel windows to ±1 slide so a 2,000-item album keeps ≤3 media elements alive. `LazyHStack` + `.scrollTargetBehavior(.paging)` gets you this for free; still avoid eagerly loading full-res for offscreen pages.
- ⚠️ A video grid tile **needs an explicit ▶ badge**. With a generated poster frame it's indistinguishable from a photo; without one it's a black box. (And the mini's poster frames are seeked ~10% in, capped at 3s — grabbing frame 0 produced a whole album of black tiles because real phone video opens on a black or half-exposed frame.)
- `thumbnail_url` may be null (pre-0173 rows, or generation failed) — always fall back to the full-res `storage_path`, never render nothing.

#### 14. Honest size, and a v1 cut

This is a genuinely large feature — roughly the size of the Posts feed. Pieces:

1. Albums list + cover tiles + name resolution — small.
2. Album detail: 3-col grid, thumbnail fallback, held badge, video badge — small.
3. Full-screen swipe carousel with per-item Save, Remove, Approve — medium.
4. Multi-file upload: picker, 3-at-a-time queue, per-tile progress, per-item retry, error copy — **the biggest piece**, medium-large.
5. Select mode + zip download (all / selection) + batch delete — medium.
6. Create / rename / archive / delete album sheets — small.
7. Media-token plumbing — likely already done for Posts; reuse it.
8. Realtime subscribe + debounced refetch — small.

**A defensible v1 = 1, 2, 3 (view + per-file Save only), 4, 7, 8.** Omit: Select mode and `/dropbox-zip` entirely (the web can do the photo-book export; a phone is a poor place to receive a 3 GB zip anyway), batch delete, create/rename/archive/delete album management (creation can stay web-only — iOS uploads into albums that already exist, including the fixed fest album), the admin Approve action, the post-composer "also add to an album" picker and therefore all of `p_credit_user_id`, and `home_callouts.drop_box_id`. That v1 delivers the actual goal — the family adding and browsing fest photos from their phones — against schema that already exists, with zero backend changes.
