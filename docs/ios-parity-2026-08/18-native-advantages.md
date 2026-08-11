<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **17 correction(s)** were applied.

### Where iOS should be better than the web app

This section is not an inventory. It is the argument for why a native MLR app is worth
building at all beyond parity — and every claim in it is anchored to a specific ceiling
the web app already hit, wrote a comment about, and accepted.

Read `/Users/brian/mlr-app/CLAUDE.md` for what the app is: **56-ish people in one extended
family**, one big annual gathering (Family Fest, a week), a lot of photo and video sharing,
committee/house chat, RSVPs, and a **self-hosted media server on a Mac mini at the lake
house in Tomahawk, WI** (`https://mlr-media.duckdns.org`, Caddy → port 8790, ~105–119 Mbps
uplink). That last fact is the single most important thing about this app's performance
profile: media does not come from a CDN. It comes from one Mac mini on a residential
connection, and the family is often physically at that house on its wifi.

The web app is genuinely good. What it is not is *unbounded* — and the interesting thing is
that **most of its most-felt limits are documented in the repo as deliberate trade-offs,
not as bugs.** Each of those is a native win that is already fully specified by the comment
explaining why the web couldn't do it.

---

#### The ranking

Ordered by how much a family member would *notice*, not by engineering interest.

| # | Native win | Replaces (real, in-repo) | Effort |
|---|---|---|---|
| 1 | **Background photo/video upload queue** (`URLSession` background config) | `XMLHttpRequest` in `lib/media.ts`, 3-at-a-time, dies when the app backgrounds | L (5–8 d) |
| 2 | **PHPicker + `PHAsset.creationDate` + originals** | a hand-rolled JPEG/TIFF IFD walk, a HEIC byte-scan, and `file.lastModified` guesswork | L (4–6 d) |
| 3 | **Real on-disk cache (works at the lake)** | nothing — `public/sw.js` has **no fetch handler at all**, on purpose | M (3–5 d) |
| 4 | **Notifications that do something** (attachments, real badge, grouping, actions) | `badge: 1` hardcoded, no `mutable-content`, no `thread-id` | M (3–5 d) |
| 5 | **Share Extension — share INTO the app** | impossible on web; no `share_target`, and iOS Safari doesn't support it anyway | M (3–4 d) |
| 6 | **AVPlayer + the HLS ladder that is already built and switched off** | `hls.js` is not in `package.json`; `HLS_ENABLED=off` waiting for a player | M (2–4 d) |
| 7 | **Haptics** | `lib/haptics.ts`, a documented **no-op on iOS** | XS (2–4 h) |
| 8 | **Widgets / Lock Screen: today at the fest, tonight's dinner** | `Countdown.tsx`, only while the app is open | M (3–5 d) |
| 9 | **`LazyVGrid` + paged album fetch** | `items.map()` over every row, one unbounded embedded select | S (1–2 d) |
| 10 | **Pre-upload sensitive-content check** (`SCSensitivityAnalyzer`) | nothing client-side; the mini grades after the bytes arrive | S (1–2 d) |
| 11 | **Save straight to Photos + native multi-select** | a whole-folder `.zip` streamed through a **hidden form → hidden iframe** | S (1–2 d) |

**Backend work required for any of this: three small edits — two shipped by PR, one edited
on the mini.** Everything else is Swift against schema that already exists.

> 🔧 **Backend changes needed — say yes to these explicitly, they are not optional for #4 and #6:**
> 1. `media-server/apns-sender.js` line ~126: `const aps = { alert: {...}, sound: "default", badge: 1 }`
>    → add `"mutable-content": 1`, add `"thread-id"`, and replace the hardcoded `badge: 1`
>    with the recipient's real unread count. **Three lines.** Ships by PR.
> 2. The mini's `.env`: `HLS_ENABLED=on` (currently unset ⇒ `off`). ⚠️ **This one CANNOT ride
>    a PR** — `media-server/.gitignore` ignores `.env` and `.env.*`, so the mini's env file is
>    not in git. Edit it **on the mini**, then restart (server.js line 25 is
>    `require("dotenv").config()`, so a restart is what applies it).
> 3. *Optional:* a column to store the HLS master URL. ⚠️ Note the counter-argument before
>    doing this: `/upload` returns `hlsUrl: null` for every upload today
>    (`HLS_ENABLED && kind === "video" ? … : null`), and server.js's own comment says the
>    omission is **deliberate** — *"no database column needed (the path is derived by
>    convention)."* Avoidable: see #6.
>
> ⚠️⚠️ **And the one that isn't a backend change but gates everything media:** `/f`
> enforcement is currently `MEDIA_AUTH=report`, **not `on`**, and CLAUDE.md says why in so
> many words — *"CURRENTLY `MEDIA_AUTH=report`, NOT `on` — because the NATIVE iOS APP CANNOT
> SIGN YET"* (`apns_subscriptions` shows 3 iOS devices across 2 members, and the native app
> has no `/media-token` support; enforcement would 403 every photo in it). So **iOS shipping
> the media token is what unblocks `on`** — and until it flips, an unsigned URL still *works*,
> which means a signing bug in iOS is invisible until the day someone promotes the flag.
> Verify with `report` mode's WOULD-BLOCK log before asking for the flip.
>
> Ship the code changes the normal way — PR → merge → **Admin → Media server → "Pull latest &
> restart"** (owner-only, gated by `lib/owner.ts` `isOwner()`, re-enforced by the mini's
> `requireOwner`). Do **not** `launchctl` by hand.

---

#### 1. Background upload that survives the app going away

**The pain, exactly.** `uploadToMini()` in `lib/media.ts` is an `XMLHttpRequest`. Both album
and feed composers run it **3 files at a time** (`const LIMIT = 3` in
`components/DropBoxes.tsx`; the feed composer in `components/PostsView.tsx` is strictly
sequential). The `File` objects and the in-flight requests live in React state on a page.
Lock the phone, switch to Messages to tell your sister you're uploading, or let iOS reclaim
the Safari tab — and the batch dies. The code even has a dedicated handler for the failure
mode this creates:

```ts
// A dropped connection mid-transfer is the single most common real-world
// failure for a big video, and it fires here, NOT on onerror — without this
// the promise would never settle and the tile would spin forever.
xhr.onabort = () => reject(new UploadError("The upload was interrupted.", 0));
```

And the reason batches got *bigger* and slower: `prepareImageForUpload()` **used to
compress** and now deliberately returns the file untouched (`return file;`), with this note:

```ts
// ⚠️ Trade-off: uploads are now bigger — a few MB per photo instead of ~1MB — so
// posting a large batch over cellular takes longer.
```

So the flagship photo-dump use case ("a fest/outing is easily hundreds of photos from one
phone" — `media-server/server.js`) is: multi-megabyte originals, three at a time, and you
must **hold the phone awake and stare at a progress grid**. That is the worst thing about
this app right now.

**What iOS does.** One `URLSession` with a background configuration
(`URLSessionConfiguration.background(withIdentifier:)`), one persisted queue (SwiftData or a
plain JSON manifest) of `{localIdentifier, category, room, capturedAt, capturedAtSource,
state}`, and `uploadTask(with:fromFile:)` per item. The OS finishes the transfers while the
app is suspended or terminated, wakes you at
`urlSessionDidFinishEvents(forBackgroundURLSession:)`, and you insert the DB rows then.
Pick 30 photos, put the phone in your pocket, walk down to the dock.

**Details that will bite:**

- ⚠️ **A background `URLSession` cannot use an in-memory multipart body.** `uploadTask(with:from:)`
  (Data) is silently downgraded/disallowed on a background session — you must write the
  multipart body to a **file** and use `uploadTask(with:fromFile:)`. Getting this wrong looks
  like "uploads work in the foreground and never fire in the background."
- The endpoint is `POST /upload?category=posts|chat|work|dropbox&room=<slug|box-id>` with
  `Authorization: Bearer <supabase access_token>`, field name **`file`**, plus optional form
  fields `capturedAt` and `capturedAtSource`. ⚠️ `category`/`room` must ride the **query
  string, not body fields** — the server reads them before multer picks a destination
  (`uploadSubdir(req)` in `server.js`, which sanitizes each segment to `[a-z0-9_-]`).
- ⚠️ **The server only trusts `capturedAtSource: "exif"`.** Anything else you send is
  recorded as the weaker `"file"`, and a `"file"`-or-missing value makes the mini re-read the
  stored bytes itself (`findOriginal(served)` → `extractCapturedAt`). Claiming `"exif"` for a
  real `PHAsset.creationDate` is correct and is what stops the server from second-guessing it.
- ⚠️ **A background task can outlive the Supabase access token.** Refresh before enqueueing,
  and treat `401`/`403` as "re-auth and retry this item", not "the file was bad". A `403`
  with `pendingApproval` is a *different* real response — the member isn't admin-verified
  yet (0181/0183, `requireApprovedMember` in `server.js`) and no retry will help.
- ⚠️ **`/upload` is deliberately exempt from the rate limiter** and there is **no count cap**
  (`skip: (req) => req.path === "/health" || req.path === "/upload"`). Don't invent
  client-side throttling out of politeness; the ceiling is disk space, watchable on the
  admin storage meter. Do cap **concurrency** (3–4) so you don't starve the mini's
  background ffmpeg and moderation.
- ⚠️ **Insert the `*_media` row only after `/upload` returns**, exactly like web — the
  orphan sweep gives a fresh file a **48h grace period** (`ORPHAN_GRACE_HOURS` default 48)
  precisely because of this ordering. A row inserted first, upload failed, means a phantom item.
- ⚠️ **`MAX_MB` is 50 GB and `UPLOAD_TIMEOUT_MS` is 4h, and neither means a 50 GB upload
  succeeds.** Bandwidth binds first — and the server's own comment says so.

**Where iOS beats the web app:** it is the difference between "I'll do the photos later when
I'm home" and the photos actually landing. For this family that is the whole product.

---

#### 2. PHPicker, `PHAsset.creationDate`, and full-resolution originals

**The pain, exactly.** Migrations **0174, 0175, 0176** and a periodic server sweep
(`media-server/captured-at-backfill.js`) exist almost entirely to answer one question a
browser cannot answer: *when was this photo taken?* The web app's answer is a four-tier
ranked guess, `captured_at_source` in (`'exif'`, `'video'`, `'file'`, `'post'`), best-first,
built out of:

- a **hand-rolled JPEG/TIFF IFD walker** in `lib/media.ts` (`findAsciiTag`, `findLongTag`,
  `parseTiffForDate`, tags `0x9003` DateTimeOriginal then `0x0132` DateTime);
- a **brute byte-scan for the ASCII string `"Exif"`** across the first 256 KB of a HEIC,
  then a probe for the `II`/`MM` byte-order mark in the next 16 bytes, because iPhones shoot
  HEIC by default and there is no marker chain to walk (`findHeicTiffStart`);
- `file.lastModified` as a floor, rejected if it is **within 60 s of now**
  (`FRESH_COPY_MS = 60_000`) because "a picker that hands over a freshly-made temp copy
  stamps it with the current time — which would be upload time wearing a disguise";
- and failing all that, **the source post's own timestamp** as an explicitly-marked proxy.

The scale of the failure is recorded in CLAUDE.md: the live Family Fest album had **48
items and every single row had `captured_at = null`**, so the album fell back to upload
order — and 41 of them had been bulk-added **inside the same second**, so they had no order
at all. 0175's proxy source spread those 41 back across **6 distinct days of the real fest
week**.

**On iOS this entire subsystem collapses to one property.** `PHAsset.creationDate` is exact,
always present, needs no parser, and works identically for HEIC, JPEG, Live Photos, videos
and screenshots. Send it as `capturedAt` with `capturedAtSource: "exif"`.

⚠️ **Read it from the `PHAsset`, not from the exported file.** `PHPickerResult` →
`itemProvider` gives you a temp copy whose `mtime` is *now* — the exact "upload time wearing
a disguise" the web code guards against. Request
`PHPickerConfiguration(photoLibrary: .shared())` and `.assetIdentifier` so you can resolve
the real `PHAsset`; that requires the photo-library permission prompt, which is worth it and
which the family will grant to a family app.

**What else opens up once you hold a real `PHAsset`:**

- **Full-resolution originals, correctly.** Request
  `PHImageRequestOptions.version = .original`, `.isNetworkAccessAllowed = true` (so an
  iCloud-optimized asset is fetched rather than silently exported as a low-res proxy — this
  is a real trap: on a phone with Optimize Storage on, the naive path uploads a
  *thumbnail-quality* file and nobody notices for months). The mini keeps your upload as
  `<uuid>_orig.<ext>` and builds its own display copy (`media-server/display.js`, ~3200 px
  q90) — so uploading bigger costs viewers nothing.
- **HEIC end-to-end.** Upload the HEIC untouched; the mini converts (`sharp`/libvips) for
  browsers — note the served file's extension becomes `.jpg` while the untouched original
  sits beside it as `<uuid>_orig.heic`. iOS can then *display the original HEIC* rather than
  the re-encoded JPEG — fetch it with `?dl=1`, which serves the preserved `_orig` (see the
  `/f` handler in `server.js`). ⚠️ **`?dl=1` is not universally "the original":**
  `needsDisplayCopy()` in `display.js` only keeps a separate `_orig` when the format isn't
  browser-safe (HEIC, etc.) **or** the long edge exceeds 3200 px. A normal web-sized JPEG has
  no `_orig` and `?dl=1` hands back the same file. HEIC always qualifies, so the HEIC path is
  safe; don't generalize it.
- **Live Photos.** The web app cannot represent one at all. iOS can upload the `.heic` + the
  paired `.mov` and play it with `PHLivePhotoView`. ⚠️ **This needs a schema decision, so
  cut it from v1**: nothing in `post_media` / `drop_box_media` links two files as a pair.
  The cheap v1 that needs no migration: upload the still only, and note the loss.
- **Batch album dumps.** `PHPickerConfiguration.selectionLimit = 0` and
  `.selection = .ordered` gives unlimited, order-preserving selection — vs
  `<input type="file" accept="image/*,video/*" multiple>`.

**Codable / Swift notes that will save an afternoon:**

- `post_media.storage_path` is **`text`, and it holds two different things**: a full
  `https://mlr-media.duckdns.org/f/…` URL for anything on the mini (the common case), or a
  bucket-relative path for legacy Supabase-Storage rows. Web disambiguates with
  `m.storage_path.startsWith("http")`. Do the same in Swift; do not type it as `URL`.
- `drop_box_media.storage_path` is **always** the full mini URL.
- `thumbnail_url`, `captured_at`, `captured_at_source` are all **nullable** — `String?`,
  `Date?`, `String?`. ⚠️ `captured_at_source` is **not** free text: 0175 and 0176 each declare
  `check (captured_at_source is null or captured_at_source in ('exif','video','file','post'))`,
  a real DB CHECK constraint, so a new value needs the constraint altered — not just the RPC.
  Still decode it as `String?` mapped to an enum with an `unknown` case rather than a strict
  `Codable` enum that throws, so a future migration can't break the client.
- `create_post(p_caption, p_occurred_at, p_media, p_tags, p_held)` takes `p_media` as
  **jsonb whose per-item keys are camelCase**: `{ path, type, thumbnail, capturedAt,
  capturedAtSource }`. ⚠️ Despite being named `path`, web passes the **full URL** there
  (`doneUploads.current.set(raw, { path: res.url, … })`) and the RPC writes it straight into
  `storage_path`. Pass the URL.
- `add_drop_box_media(p_box, p_url, p_type, p_thumbnail_url, p_captured_at,
  p_captured_at_source, p_credit_user_id)` — that order, those names (0180). Supabase keys RPC
  arguments **by name**, so a typo is a runtime failure, not a compile error. `p_credit_user_id`
  is honored only when the caller is an admin **and** the target is a real profile; a
  non-admin's value is silently ignored.

**RLS, one line each:** `post_media` and `post_comment_media` are SELECT-able by
`is_approved_member()` — any admin-verified member sees all of them, and an empty result
means *you are not verified yet*, not "this post has no photos". `drop_box_media` is
`is_approved_member()` **and** status-aware (visible to all; `pending` only to its uploader
and admins) — so a held photo silently missing from a list is correct behavior, not a bug.

---

#### 3. A real on-disk cache — the "it works at the lake" feature

**The pain, exactly, and it is worse than you'd guess.** The web app has **no offline
capability whatsoever**. Its service worker says so in its own header, verbatim:

```js
/* MLR service worker — web push only.
 *
 * Deliberately minimal: it handles `push` (show the notification) and
 * `notificationclick` (open/focus the app at the deep link). It has NO fetch /
 * caching handler, so it never interferes with how the app loads or updates.
 */
```

There is no "PWA cache" to beat. The only thing standing in for one is `lib/swrCache.ts`:
`localStorage` snapshots under `mlr.cache.v1.`, **200 KB per entry** (`MAX_PERSIST_BYTES =
200_000`), 24h TTL, which paint *stale text* on a cold open. Photos are not cached at all
beyond whatever the HTTP cache happens to hold, and the feed snapshot is explicitly trimmed
to the top **15** posts (`POSTS_SNAPSHOT_COUNT = 15`) — "never the whole history, a big feed
would blow the 200KB persist cap anyway".

Then there is the ceiling nobody has hit yet but will:

```js
// media-server/server.js
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, … 
  skip: (req) => req.path === "/health" || req.path === "/upload" });
```

⚠️ **`/f` reads are NOT exempt.** 600 requests per 15 minutes, **keyed per IP** — and the
comment right above it notes "a whole family shares one WiFi/IP at the lake (and can
collapse to a single key behind the tunnel)". Every album thumbnail is one request. A
300-photo album, three relatives scrolling it, and the house is over budget. Every byte a
native cache keeps off the wire is also a request off that counter and load off the mini's
~105–119 Mbps uplink.

**What iOS does.**

- A **thumbnail store on disk** keyed by the media row id (not the signed URL — see the
  warning below), with a size budget and LRU eviction. Thumbnails are small
  (`<uuid>_thumb.jpg`) and there are only thousands of them. Once warm, opening the fest
  album on a dead connection shows the album.
- A **URLCache** with a generous disk capacity for display-size photos, plus explicit
  "keep this offline" for the current fest album. (`/f` static responses are served
  `maxAge: 365d, immutable`, so they cache well — the master HLS playlist is the one
  exception, deliberately `no-store`.)
- **Persisted model objects** for the things a person opens on a bad connection: the fest
  schedule and dinners, the current week's events, the last N messages per room, the member
  directory, and **the house's shared lists** (`house_lists` / `house_list_items`, 0169 —
  the groceries-for-the-weekend / close-up-checklist surface, which is exactly what someone
  opens standing in a store with one bar). The web equivalent is capped at 200 KB per key;
  on-disk you simply do not have that problem.
- **Optimistic writes with a durable outbox** so an RSVP, a chat message, or a checked-off
  list item typed in a dead zone sends when signal returns. ⚠️ Cut the general outbox from
  v1 — do it for chat sends, uploads, and `set_house_list_item_checked` only, where the user
  already expects a "sending…" state.

**Warnings:**

- ⚠️⚠️ **Never key a cache on the signed media URL.** The token rides the query string
  (`?t=<token>`, `MEDIA_TOKEN_TTL_HOURS` default 24) and the same file's URL therefore
  **changes daily**. Key on the row id or the token-stripped URL, or your cache achieves a
  0% hit rate every morning and you will not be able to tell it apart from working.
- ⚠️ Mirror the web app's four SWR rules from CLAUDE.md, especially **rule 2: every
  user-scoped cache key embeds the auth uid.** There is a real incident behind this — a
  cache keyed on a shared `"self"` string **leaked one member's private chat to the next
  user** on a shared device (fixed in web PR #244), because signing out does not reload a
  native app any more than it reloads a PWA. And mirror **rule 4**: sign-out must wipe the
  entire on-disk cache *and* the media token (`clearAllCaches()` + `clearMediaToken()`).
- ⚠️ A **video's `storage_path` can change shortly after upload** — a cross-extension
  transcode (`.mov` → `.mp4`) repoints it, and the rename of the original to `_orig` is
  deliberately deferred until after the repoint. Don't cache a URL forever; re-read the row.

**Honest scoping:** full offline-first with conflict resolution is a trap. Ship
**read-cache + upload queue + chat outbox** and stop.

---

#### 4. Notifications that actually do something

**What already exists** (audit this in the iOS repo — it is partly built):
`media-server/apns-sender.js` maps notification types to categories and its comment says
"Mirrors the categories registered in **NotificationActions.swift**" — so
`EVENT_REMINDER` (`event_rsvp`), `HELP_REQUEST` (`help_request`/`help_urgent`),
`CHAT_MENTION`, `COMMITTEE_JOIN_REQUEST` and `WORK_FOLLOWUP` (set explicitly as
`payload.category` in `media-server/work-followup.js`, not by `categoryFor()`) presumably
have action buttons already. **Verify in the iOS repo which of these are registered and what
their handlers actually do** — the sender has grown since.

**What is provably missing, from the payload builder:**

```js
// media-server/apns-sender.js — the whole aps dictionary, verbatim
const aps = { alert: { title: payload.title || "", body: payload.body || "" },
              sound: "default", badge: 1 };
// An explicit payload.category wins; otherwise derive it from the type.
const cat = payload.category || categoryFor(payload.type);
if (cat) aps.category = cat;
```

- ⚠️ **`badge: 1` is hardcoded.** The app icon says "1" forever, no matter how many unread
  notifications there are. The correct number is one query the web app already runs
  (`lib/hooks.ts` `useUnreadNotifications`): `notifications` where `recipient_id = <uid>`,
  `seen_at is null`, and (`expires_at is null` or `expires_at > now()`). **RLS: `notifications`
  is own-rows-only (`recipient_id = auth.uid()`), so a member reading their own count is safe
  and needs no RPC.** Fix it in two places — the mini should send the real count, and iOS
  should call `UNUserNotificationCenter.setBadgeCount(_:)` after `mark_notifications_seen()`
  (no params; it stamps `seen_at = now()` on your unseen rows) so the badge clears the moment
  the tab is opened rather than on the next push.
- **No `mutable-content: 1`** → **no notification attachments.** This is the single most
  family-visible notification win available: "Kate posted 3 photos" with **the actual photo
  in the notification**. Needs a Notification Service Extension plus that one server flag.
- **No `thread-id`** → chat pushes from three different rooms do not group. Set it to the
  room key (committee slug + area, or house slug) and iOS stacks them per room.
- **No `interruption-level`** → `help_urgent` ("someone needs help at the lake, now") looks
  exactly like a poll reminder. `.timeSensitive` is what that type is for, and it breaks
  through Focus. The push types already carry the distinction; the transport throws it away.

**Actionable actions that are worth wiring, with the real RPCs:**

| Category | Button | Call |
|---|---|---|
| `EVENT_REMINDER` | Going / Can't make it | `set_event_attendance(p_event, p_status, p_days, p_title)` |
| `HELP_REQUEST` | I'll help | `respond_to_help(p_request, p_note)` |
| `HELP_REQUEST` (item) | Claim | `claim_help_item(p_item, p_claim)` |
| `WORK_FOLLOWUP` | Yes, it's done | `mark_work_item_done(p_id)` — `work_item_id` is already in `userInfo` |
| `CHAT_MENTION` | Reply inline | insert into the room's messages table |

(To clear an RSVP entirely rather than change it: `clear_event_attendance(p_event)`. Help
status changes are `set_help_status(p_request, p_status)`.)

- ⚠️⚠️ **`set_event_attendance` has TWO live overloads.** Migration 0036 defines the 4-arg
  `(p_event text, p_status text, p_days jsonb, p_title text)` **which fans out the "X is
  going to …" notification** (and 0036 explicitly dropped 0035's 3-arg version to avoid this);
  migration 0122 then **re-created** a **3-arg** `(text, text, jsonb)` version alongside it
  that does **not** notify. PostgREST resolves by argument names, so **always pass `p_title`**
  (even as `nil`) or your RSVP silently stops telling anyone. `lib/events.ts` `setAttendance()`
  always sends all four keys — copy that.
  (Separately, and confirmed in the SQL: 0122's 3-arg body sets `confirmed = true` on the
  UPDATE branch; the 4-arg version everyone actually calls does **not** touch `confirmed` at
  all. So a carried-over `confirmed = false` from `finalize_meeting_as_event` is *not* cleared
  by a normal re-RSVP through the 4-arg path — *verify against prod before relying on
  `event_attendance.confirmed`.*)
- ⚠️⚠️ **A Notification Service Extension is a separate process with no session.** To
  download the attachment from `/f` it needs the **media token**, and it needs it *there*.
  Put the Supabase session and the media token in an **App Group + shared Keychain** from
  day one — retrofitting this after the extension exists is the kind of refactor that eats a
  weekend. The attachment request must carry the token — either `?t=<token>` or, since
  `requireMediaToken` also accepts it, `Authorization: Bearer <media token>` — and an NSE has
  a **hard ~30 s budget**: download the small `thumbnail_url`, never the full-res file, and
  always call the content handler with the unmodified content on failure.
- **Use `UNNotificationCenter` grouping + `summaryArgument`** so "12 new messages in Meals"
  is one row.
- **Live Activities**: genuinely great during fest week — a Lock Screen card for "next up:
  Pontoon Poker, 2:00, at the main dock." Also genuinely a lot of work (`ActivityKit` +
  push-to-start tokens + a widget target). **v2. Not v1.**

---

#### 5. Share Extension — the thing web fundamentally cannot do

`public/manifest.webmanifest` has no `share_target`, and it would not matter if it did:
**iOS Safari does not implement Web Share Target.** The web app can only share *out*
(`components/ShareApp.tsx` → `navigator.share`). So the most natural gesture on an iPhone —
select 40 photos in the Photos app, tap Share, pick MLR, pick "Family Fest 2026" — is
**structurally impossible on web, forever.** It is not a polish gap; it is a capability the
browser does not have.

Given that Drop Boxes are described in the parity doc as *"the most-used surface on the web
app"* and the official album has a well-known fixed id
(`0000fe57-2026-4000-8000-000000000001`, `FEST_ALBUM_BOX_ID` in `lib/data.ts`, seeded by
0172), a Share Extension whose entire UI is "which folder?" plus a Post button is arguably
the highest-leverage screen in the whole iOS app.

**Mechanics:**

- Accept `public.image` and `public.movie`, `NSExtensionActivationSupportsImageWithMaxCount`
  set high (0 = unlimited).
- ⚠️ **The extension must not upload inline.** Write the items into the App Group container,
  enqueue them on the same background session as #1 (`sharedContainerIdentifier` is
  **required** for a background session created inside an extension), and return. The
  extension gets killed the moment its UI dismisses.
- ⚠️ The extension needs the Supabase session (to get an access token for `/upload`) — App
  Group + shared Keychain again, same as the NSE. Handle "signed out in the extension"
  gracefully: tell the person to open the app, don't fail silently.
- ⚠️ A share sheet gives you an **exported item, not a `PHAsset`** — so `creationDate` is
  not directly available. Read the EXIF off the exported file with `CGImageSourceCopyProperties`
  (`kCGImagePropertyExifDictionary` → `DateTimeOriginal`) and send it as
  `capturedAtSource: "exif"`; if you get nothing, send **nothing** rather than the file's
  mtime, and let the mini's own inline reader upgrade it at `/upload` time.
- ⚠️⚠️ **The periodic backfill sweep only covers albums, not posts.**
  `media-server/captured-at-backfill.js` reads `admin.from("drop_box_media")` and nothing
  else, so:
  - a share bound for a **drop box** gets a second and third chance — the sweep re-reads any
    row whose source is `null`, `post`, **or `file`**, upgrading it to real `exif`/`video`
    and never downgrading. So a `"file"` value there is *not* sticky.
  - a share bound for a **post** gets exactly one server-side read, the inline one in
    `/upload`. Nothing upgrades `post_media` later, so a wrong `"file"` value there **is**
    permanent. Send nothing rather than a guess.
- ⚠️ **Related trap, learned painfully on web:** never trigger a picker from inside a
  popup/menu/overlay. In the installed iOS PWA the picker opened, you chose a photo, and
  **nothing arrived, with no error** — three fixes that kept the popup all failed on device.
  That is why `DropBoxes.tsx` uses a plain, always-mounted `<input>` behind a plain button.
  Native plumbing is different, but if photo attachment ever misbehaves, look at what the
  presenter is nested inside first.

---

#### 6. AVPlayer — and the adaptive-bitrate ladder that is already built, tested, and switched off

**This is the sleeper win, because the server-side work is done.**
`media-server/hls.js` is a complete three-rung HLS ladder (source-capped-at-4K ~11 Mbps /
720p ~4 Mbps / 540p ~1.6 Mbps, H.264 + MPEG-TS on every rung "so it plays on everything,
including older iPads someone's relative still uses"; rungs are short-edge targeted so
portrait phone video isn't mangled). There is even a companion congestion-control service,
`media-server/stream-load.js` + `GET /media-load`, that caps quality when **several**
relatives are streaming at once and the house uplink is genuinely saturated
(`MEDIA_CAPACITY_MBPS` default 80, minimum viewer count before capping). And it is all
dormant:

```js
// ⚠️ DEFAULT OFF. Ladders are useless until the client can play them, and each one
// roughly doubles a video's storage — so generation stays off until the hls.js
// player ships, then flip HLS_ENABLED=on in the mini's .env.
const ENABLED = String(process.env.HLS_ENABLED || "off").toLowerCase() === "on";
```

`hls.js` (the npm player — not the mini's `media-server/hls.js` module) is **not in
`package.json`**. The web app plays video with a bare
`<video src controls playsInline preload="metadata">` against a single ~10 Mbps rendition
(`media-server/transcode.js`). **AVPlayer plays HLS natively with zero third-party code.**
So iOS is not catching up here — iOS is what *unlocks a feature the mini already has*, and
flipping the flag is what finally makes a relative on weak cellular able to watch fest video
at all.

**How to find the ladder without a schema change.** `/upload` returns an `hlsUrl` field —
which is `null` for everything today, because it is computed as
`HLS_ENABLED && kind === "video" ? … : null`, and nothing stores it either way. The path is
derivable, and server.js says that is the point (*"no database column needed — the path is
derived by convention"*): for a served file at `<dir>/<uuid>.<ext>`, the master playlist is
`<dir>/<uuid>_hls/master.m3u8` (`hlsDirFor`/`masterPathFor` in `hls.js`,
`MASTER_NAME = "master.m3u8"`). So iOS can probe the derived URL and fall back to the
progressive file. ⚠️ **Budget the probe:** the master route sets `Cache-Control: no-store`
(its body is rewritten live under load, see below) and `/f` is **not** limiter-exempt, so a
per-video `HEAD` on a scrolling feed spends the same 600 req/15 min budget #3 warns about.
Cache the has-ladder answer per media row id. A `post_media.hls_url` /
`drop_box_media.hls_url` column is the cleaner long-term option — **a backend change, worth
doing once, not required for v1.**

**Then take the free wins:**

- **Picture-in-Picture** (`AVPlayerViewController.allowsPictureInPicturePlayback`) — keep
  watching Uncle Tom's fishing clip while scrolling chat.
- **AirPlay** to the lake-house TV. This one is worth naming out loud: a family gathered in
  one room, casting the album to the big screen. The web app cannot do it.
- **`preferredPeakBitRate` / `preferredMaximumResolution`** — the native equivalent of
  `hls.js`'s `autoLevelCapping`. ⚠️ **But know that the server already shapes you.** The
  `/f` master-playlist route rewrites the manifest under pressure
  (`streamLoad.capMasterPlaylist(body, load.maxRungs)`), with the explicit comment: *"Capping
  at the manifest is what makes this effective without a cooperating client — a player can
  only choose a variant the manifest offers, so native iOS players and older app builds get
  shaped too."* So honoring `GET /media-load` yourself is a refinement, not a requirement,
  and you must not cache the master playlist (hence its `no-store`).
- **`AVAssetDownloadTask`** — pre-download this year's fest videos over the house wifi so
  they play in a dead zone. Pairs with #3.
- **`AVAssetImageGenerator`** for a real poster frame when `thumbnail_url` is null. The web
  fallback is `preload="metadata"` and its own comment admits "iOS often leaves it black."

**Warnings:**

- ⚠️⚠️ **Video is how the media token breaks.** AVPlayer issues **`Range`** requests and
  retries. If the query string is dropped on a range retry, **video breaks while photos look
  perfect** — the parity doc's exact signature for this is `range=yes tok=missing` in
  `logs/server.log` (that string is literally in `media-auth.js`'s report-mode logger, which
  includes `range` for precisely this reason). Exercise scrubbing explicitly, then
  `grep WOULD-BLOCK ~/mlr-app/media-server/logs/server.log`. And remember from the top of this
  section: enforcement is `report` today, so a broken signature **will not fail loudly** —
  the log is your only signal.
- ⚠️⚠️ **HLS relative URIs do NOT inherit the `?t=` query string — do not plan around that.**
  ffmpeg emits relative child URIs inside `_hls/` (`0/index.m3u8`, `0/seg_0000.ts`), and
  RFC 3986 §5.2.2 resolves a relative reference using the **reference's** query — which is
  empty. So every child playlist and every segment is requested **unsigned**. Two working
  fixes, both available today:
  1. **Send the token as a header.** `requireMediaToken` accepts
     `Authorization: Bearer <media token>` as well as `?t=` — so an
     `AVAssetResourceLoaderDelegate` (custom scheme → real request with the header) signs
     the master, the child playlists and every segment uniformly. This is the recommended path.
  2. Have the server rewrite child URIs to carry the token. Note the master is already read
     and rewritten in Node (for load capping), but child playlists are served by
     `express.static` — so this is a real server change, not a one-liner.
- ⚠️ **A ladder is a directory of hundreds of files, none of which has a database row.** Four
  subsystems already understand `_hls/` (`orphan-sweep.js`, `media-usage.js`,
  `mirror-sweep.js`, `/dropbox-zip`) via `isHlsPath()`. Do not invent a new derived directory
  from iOS.
- ⚠️ Turning `HLS_ENABLED=on` **roughly doubles each video's storage**. Check the Admin →
  Media server storage meter first (`MEDIA_HOT_ALLOWANCE_GB` 25, `MEDIA_HOT_RESERVE_GB` 15,
  `MEDIA_HOT_MAX_FILE_MB` 250 — over that a file goes to the external drive).

---

#### 7. Haptics — the cheapest quality upgrade in this entire document

`lib/haptics.ts` is 31 lines and its header is an apology:

```ts
// navigator.vibrate is Android/Chrome only; iOS Safari (incl. the installed PWA)
// has NO Vibration API, so this is a silent no-op there — the visual spring/press
// feedback carries the "tactile" feel on iOS.
```

Every `haptic()` call site in the web app — tab switches (`TabBar`), segmented controls, RSVPs
(`AttendanceControl`), poll votes (`PollsView`), blocked actions — **does nothing on an
iPhone today.** The four kinds map one-to-one:

| `HapticKind` | Web pattern | iOS |
|---|---|---|
| `light` | `8` | `UIImpactFeedbackGenerator(style: .light)` |
| `medium` | `16` | `UIImpactFeedbackGenerator(style: .medium)` |
| `success` | `[10, 40, 12]` | `UINotificationFeedbackGenerator().notificationOccurred(.success)` |
| `warning` | `[22, 60, 22]` | `.notificationOccurred(.warning)` |

Plus `.selectionChanged()` for the segmented controls and the `FamilyFestNav` pill, and
`.sensoryFeedback(_:trigger:)` in SwiftUI where it fits. **Half a day of work that changes
how the entire app feels.** Ship it in the first PR.

⚠️ Mirror the web behavior exactly: `haptics.ts` **skips the buzz under Reduce Motion**
("treat Reduce Motion as 'keep it minimal'"). Check
`UIAccessibility.isReduceMotionEnabled`. And prepare the generator before the interaction —
a cold generator adds latency that reads as a mistimed tap.

---

#### 8. Widgets and the Lock Screen: "today at the fest" and "tonight's dinner"

**Why this one is unusually easy here.** The fest content tables are **public read**. Migration
0053 creates `fest_config`, `fest_dues`, `fest_schedule_items`, `fest_dinners`, `fest_payees`,
`fest_activities` all with `for select using (true)`, and the 0183 verified-member lockdown
**deliberately left them alone** — its own comment says *"fest_content — public by design
(browse-first content, no PII)."* **RLS one-liner: anyone at all, signed in or not, can read
these; an empty result means the fest year genuinely has no rows.** So a widget extension
can populate itself with nothing but the anon key — no keychain, no session, no token.

⚠️⚠️ **But public read cuts both ways: RLS is no longer doing any filtering for you, so every
filter the web applies you must apply by hand.** Two are mandatory on every fest query:

- **`fest_year`.** Every read in `lib/festContent.ts` is `.eq("fest_year", FEST_YEAR)`. Rows
  default to 2026; the day a 2027 row lands, an unfiltered widget shows two fests at once.
- **`anytime = false`** for anything day-scoped. `anytime` (0139) is a boolean, and `day` is
  `not null` even for anytime items — 0141 converted every old `fest_activity` into an
  anytime `fest_schedule_item` and **parked `day` on `current_date` at migration time**, so an
  unfiltered `day = today` query surfaces the scavenger hunt on one arbitrary calendar day and
  never again. `FestWeek.tsx` splits on `e.anytime` for exactly this reason.
- And note `fest_schedule_items.is_private` exists, is **not** protected by RLS (public read),
  and is currently ignored by the web renderer (`mapSchedule` drops it). Its editor label is
  *"Hide location/details from signed-out guests"* — so if you ever render `location` in a
  public widget, honor it there rather than assuming the database will.

**Widgets worth building:**

1. **Fest countdown** (small + Lock Screen) — `fest_config.start_date` / `.end_date`, one
   row keyed by `fest_year` (it is the primary key). Replaces `components/Countdown.tsx`,
   which only counts while somebody is looking at the app.
2. **Today at the fest** (medium) — `fest_schedule_items` where `fest_year = <year>`,
   `anytime = false`, `day = today`, ordered by `position`, showing `emoji`, `title`,
   `start_time`, `location`. ⚠️ `start_time`/`end_time` are **freeform `text`, nullable**
   ("TBD" is a real value — the 0053 seed writes it) — `String?`, never a `DateFormatter`
   input. And ⚠️ **`day` is a bare `date`**: the web app's own scar tissue here is that
   `new Date("2026-07-31")` parses as **UTC midnight** and rendered as the previous day in
   Central, which mislabelled every sign-up slot and, because the label fed the organiser's
   own picker, **corrupted 10 stored rows**. In Swift, always parse with an explicit
   `timeZone` (America/Chicago) — and the deeper lesson generalizes: *a display bug in a
   picker silently corrupts whatever it writes.*
3. **Tonight's dinner** (medium) — `fest_dinners` for today: `title`, `menu`, `served_time`,
   `chef_name`. This is the single most-asked question during fest week.
   ⚠️⚠️ **Do not put `houses`, `served_location`, or `prep_location` in a public widget.**
   The web's dinner detail (`components/FestDinnerDetail.tsx`) wraps all three in
   `<Protected>` — a sign-in gate (`components/Guard.tsx`: signed-out sees a "🔒 Sign in to
   see…" button, an unverified member sees "🔒 Waiting to be approved"), including the
   explicit *"Sign in to see which families are cooking"* on `houses`. A public anon-key
   widget rendering them would publish exactly what the web deliberately withholds.
   `prep_time` is **not** crew-only — it is shown to everyone as the "Crew preps" tile — so
   there is no reason to hide it; it is the *locations* and the *house list* that are gated.
   If you want the crew view, make that widget session-scoped like #4.
4. **Who's up north** (medium) — the highest-charm widget and one that needs a session. It is
   a **union of three sources** (`lib/presence.ts`): `presentFromAttendance`
   (RSVP'd going to an event happening today, day-aware via the `days` map),
   `presentFromCabins` (an approved cabin booking covering today), `presentFromHouseStays`
   (a house-calendar stay covering today), merged by `mergePresence`. ⚠️ **RLS:
   `event_attendance` and `houses` are `is_approved_member()`** (0183 — both were
   `auth.uid() is not null` before) — an unverified member gets an empty list, so the widget
   must render "nothing scheduled" rather than an error, and must not treat empty as broken.
   ⚠️ Keep the web app's deliberately soft wording — *"Up North today"*, **not** "right
   now": this is derived from RSVPs and bookings, not location, and cannot promise anyone has
   actually arrived. (`WhosUpNorthCard.tsx` says so in a comment.)
5. **House list, interactive** (medium, v2) — `house_lists` / `house_list_items` (0169): the
   house's shared groceries / close-up checklist. This is the one surface in the app that
   genuinely wants an **interactive** widget: `Toggle(intent:)` calling
   `set_house_list_item_checked(p_id uuid, p_checked boolean)` so you check off milk from the
   Lock Screen without opening anything. ⚠️ `checked` is a **stamp, not a boolean** —
   `checked_at` / `checked_by` — so render "checked" as `checked_at != nil` and expect to see
   *who* checked it. RLS is `is_house_member()`, so this needs the shared session, and 0169
   ships **no notifications by design** ("a grocery run would spam the whole house") — don't
   add any.
6. **Unread badge widget** — `notifications`, own-rows-only RLS. Nice, low value, skip in v1.

⚠️ Widget timeline budget is stingy: refresh on the order of every 15–30 minutes, cache the
last good payload in the App Group, and **never let a widget be the thing that trips the 600
req/15 min `/f` limiter** — widgets should read tables, not media, except for one cached
avatar strip.

---

#### 9. `LazyVGrid` and paging — free performance the web can't get

Two specific, measured-in-code ceilings:

- **The album grid renders every item.** `components/DropBoxes.tsx` line ~698 is a plain
  `items.map(...)` inside `grid grid-cols-3` with `loading="lazy"` images. A 2,000-item
  album is 2,000 DOM nodes. (The *carousel* is windowed to ≤3 elements — `Math.abs(i - active)
  <= 1`, with full-width spacer divs so the scroll geometry survives — but the grid is not.)
  SwiftUI's `LazyVGrid` gives you this for free.
- **The fetch is unbounded.** `lib/dropBoxes.ts` selects
  `id, title, emoji, created_by, archived_at, created_at, drop_box_media(id, storage_path,
  thumbnail_url, media_type, status, uploaded_by, created_at, captured_at)` — an embedded
  child select with **no `limit`, no `range`, no pagination**. Every item in the folder, every
  open.

(To be precise about what *isn't* a win: the web grid already renders `thumbnail_url` when
present and falls back to the full-res url only when it's null — `Thumb` in `DropBoxes.tsx`.
Do the same, and load full-res only on tap-through, which the parity doc calls *"the single
biggest scroll-performance win in the app"* — but the genuinely native gains here are
`LazyVGrid` and paging.)

⚠️⚠️ **Ordering: match the web's default, which is UPLOAD order, not capture order.**
`lib/dropBoxes.ts` sets `DROP_BOX_SORT_DEFAULT = "uploaded"` — newest `created_at` first —
and says why: *"capture order made a fresh upload scatter into the middle of the album by its
shot date, which reads as the app glitching or losing the photos."* Capture order
(`captured_at` falling back to `created_at`, never hiding an item for missing metadata) is a
**per-viewer, per-device preference** persisted in `localStorage` under `mlr.dropbox.sort`
and applied client-side by `sortDropBoxItems()`. Two consequences for iOS:

- The album's default order must be `created_at desc`, with a device-local sort toggle
  offering "When taken" — that toggle is a shipped user-facing feature, not an implementation
  detail. Don't drop it.
- **Paging and the capture-order toggle fight each other.** Page 1 by upload date is not page
  1 by capture date, so a client-side re-sort over a partial set produces a wrong order that
  looks like data loss. Either page with `order(captured_at desc nulls last, created_at desc)`
  server-side *when that mode is active*, or fetch the whole id list once and page the media
  lookups. Pick one deliberately at ~120 rows per page.

Honest sizing: the live fest album was **48 items**, so this is not on fire today — but it is
the surface the owner most wants people dumping hundreds of photos into.

⚠️⚠️ **PostgREST embed ambiguity — this has bitten this project.** A
`.select("*, child(*)")` embed **silently returns `[]` with HTTP 300 / `PGRST201`** when two
foreign keys link the two tables. It already happened on `tournaments` ↔
`tournament_entrants` (`tournaments.winner_entrant_id` is a second FK back the other way). If
anyone ever adds a second FK from `drop_box_media` to `drop_boxes`, this album query goes
empty **with no error**. Name the FK in the embed (`drop_box_media!<fk_name>(...)`) or do two
queries. In Swift, two queries is often clearer anyway.

⚠️ And the general trap behind it, from CLAUDE.md: the "degrade gracefully pre-migration"
idiom (return empty on Postgres `42P01`) **disguises a broken read as "empty but working."**
A table with RLS enabled and zero policies returns zero rows with no error — which *silently
deleted an entire feature from every client for weeks* (and is exactly how
`content_embeddings` is locked on purpose). **When a list reads empty but writes seem to
succeed, check `pg_policies` before anything else.** Do not port the swallow-all `catch` into
Swift without logging — note `lib/dropBoxes.ts` already has a three-tier column-ladder
fallback (`SELECT` → `SELECT_NO_CAPTURED` → `SELECT_NO_THUMB`) doing precisely this.

---

#### 10. Pre-upload sensitive-content check (optional, and honestly caveated)

The mini grades every upload with Apple's `SensitiveContentAnalysis` +
`FoundationModels` **after** the bytes arrive (see `docs/sensitive-content-mini-todo.md`,
`media-server/moderation.js`). iOS has the same `SCSensitivityAnalyzer` **on the phone**, so
it could warn before a 40 MB video ever leaves the house uplink.

**Be honest about this one:**

- ⚠️ `SCSensitivityAnalyzer` requires the **user's own** Screen Time → "Sensitive Content
  Warning" setting to be on. `analysisPolicy` returns `.disabled` otherwise and **there is
  no API to force it.** So coverage is per-device and unpredictable across a 56-person
  family.
- **The mini stays the authority.** iOS's check is a courtesy warning, never a gate, and it
  must not change what gets inserted — the DB triggers (`hold_drop_box_media_on_flagged`,
  `hold_comment_on_flagged_media`, `hold_content_on_media_verdict`) are the real mechanism
  and iOS needs no moderation code at all.
- ⚠️⚠️ **Moderation is asynchronous, and the window is longer than you think.** `/upload`
  returns immediately and a flagged verdict *retroactively* holds already-posted content via
  a trigger. Seconds, usually — but **not only seconds**: when the model can't run (common on
  the mini's current beta), `/upload`'s fail-open branch calls
  `enqueueRecheck({ url, relPath, kind, category })` and the code comment is explicit that
  this now applies to **every** category, drop boxes included: *"with moderation off the
  response's critical path, there's no longer a reason to let a fail-open at upload time go
  unrevisited forever."* `enqueueRecheck` has no category filter and the backfill sweeps on a
  timer with retries. So a row's `status` can flip to `pending` **minutes or days** after a
  successful post. iOS must honor `status` on every render and on every realtime update — no
  exceptions — and must not assume "it survived the first refetch, so it's clean."
  (⚠️ CLAUDE.md still describes drop-box uploads as "allowed and final… not re-queued." The
  code disagrees; trust the code.)
- A definitive FLAG (model reachable) holds immediately; member Report + the admin queue are
  the backstop. An admin un-holds a false positive with
  `set_drop_box_media_status(p_media, p_status)` (admin-only), which is worth surfacing in the
  iOS carousel the way the web does.

Low priority. Nice-to-have. **Cut from v1.**

---

#### 11. Save to Photos — and deleting the zip

**The web app's download story is a marquee Drop Box feature and a stack of workarounds.**
CLAUDE.md calls downloads *"the deliberate difference from the Feed"* — the Feed doesn't offer
them, albums do, because the point of an album is pulling originals out for a photo book:

- **Per file** — `⬇ Save` in the carousel hits `<mini>/f/…?dl=1`, which answers with
  `Content-Disposition: attachment` and (when one exists) the preserved `_orig`. Done that way
  because the bare HTML `download` attribute is ignored cross-origin, and the app and the mini
  are different origins.
- **Select mode** — a "Select" pill turns the grid checkable, with a Download(N) / All /
  Cancel toolbar.
- **Whole folder or a selection as one `.zip`** — the mini streams it through the system `zip`
  binary: `GET /dropbox-zip?box=&token=` for everything, `POST /dropbox-zip` (form fields
  `token` + `box` + many `path`) for a selection. The client submits a **hidden form into a
  hidden iframe** so any number of paths and the token ride along without a URL-length limit
  and without navigating away. The token rides the query string or body because an `<a
  download>` / form submit **cannot set an `Authorization` header** — and the endpoint still
  enforces the approval gate (`isApprovedMemberByToken` → 403 `pendingApproval`), because
  `FEST_ALBUM_BOX_ID` is a compile-time constant in the public bundle and therefore not a
  secret.

**On iOS every layer of that disappears.** `PHPhotoLibrary.shared().performChanges` writes the
files straight into the camera roll — the place the person actually wanted them — so there is
no zip to build, no iframe, no Files-app detour, and no 512 KB form-body ceiling. Multi-select
is already native from #9's grid, and the share sheet covers "send these to Mom" for free.

- Fetch the original with `?dl=1` on the stored URL (signed — `?t=` or the Bearer header) and
  `PHAssetCreationRequest.forAsset().addResource(with: .photo, fileURL:options:)`.
- ⚠️ Needs `NSPhotoLibraryAddUsageDescription` and the add-only authorization
  (`PHAccessLevel.addOnly`) — a *different*, softer prompt than the read access #2 needs.
- ⚠️ Ten relatives each pulling a 300-photo album is 3,000 `/f` requests against 600 per 15
  minutes. Queue these on the background session with bounded concurrency and honor a 429.
- Keep `/dropbox-zip` reachable anyway for the desktop/web path; iOS just shouldn't use it.

Effort: **S (1–2 d)**, and it retires the single ugliest workaround in the web app.

---

#### Where the web app is genuinely fine, and native adds nothing

Padding this section would waste the reader's time in Xcode, so:

- **Realtime chat, typing indicators, optimistic sends.** Supabase Realtime is a WebSocket;
  the Swift SDK subscribes the same way. `TypingIndicator` rides its own realtime channel
  (`useTypingChannel`) and works well. `drop_boxes` / `drop_box_media` are on the realtime
  publication too (0171), so an album fills in live — subscribe rather than poll. You will
  get *smoother scrolling* natively, and that is all. **No architectural win — just port it.**
- **Phone, text, email, and payments.** `CallTextButtons`, `PayView`, `PayQRCode` use
  `tel:` / `sms:` / `mailto:` and Venmo/Zelle/Apple Cash links, which already hand off to the
  native apps from Safari. `UIApplication.open` is the same thing. Apple Wallet is not
  applicable — these are person-to-person payments, not passes.
- **Conversation search.** `POST /search` on the mini (body `{q, limit}`, 60/min/IP) →
  `search_conversations(query_embedding, query_text, match_count)` — note: **not**
  `p_`-prefixed, and there is exactly **one** live overload (0130 dropped 0129's
  `(vector, integer, double precision)` version outright; the parameter type is
  `extensions.vector(512)`). The RPC is `SECURITY DEFINER` and re-applies the caller's own
  visibility rules, so each member searches exactly their slice with no per-user index. It is
  tempting to embed the query **on the phone** with the same `NLContextualEmbedding` the mini
  uses — but ⚠️ `content_embeddings` has **no model or revision column** (the mini derives
  `MODEL_ID = "nl-contextual-en.r\(embModel.revision)"` in `embed-service/…/main.swift` and
  never stores it), so if iOS 26's English revision differs from the mini's macOS 27 revision
  the vectors are in a different space and **ranking silently degrades** rather than failing —
  invisible, because 0131 filters keyword-first with `@@` so you still get rows.
  **Keep calling `/search`.** (⚠️ And never reintroduce `ts_rank(...) > 0` as the filter:
  ts_rank returns a tiny non-zero (~1e-20) for non-matching multi-word queries, which once
  leaked the whole corpus.)
- **Polls, RSVP forms, the dues calculator, the admin dashboard.** Forms and lists. SwiftUI
  will look nicer; nothing is unlocked.
- **Handoff / Siri / Shortcuts.** Weak fit. Nothing here is a document you'd want to continue
  on a Mac. The one honest Shortcut is *"Add to the Family Fest album"* via an
  `AppIntent` — which is really just #5 with a different entry point. **Skip in v1; get it
  nearly free later** by exposing the share flow as an `AppIntent`.
- **Dark mode.** Not a win, a **cost**: the web app is light-mode-only by hard rule
  ("never a dark translucent surface tint as a card background"), so **every native surface
  needs a dark treatment with no web reference to copy.** Budget for it up front rather than
  discovering it at review.

---

#### The v1 cut

Ship, in this order, and stop:

1. **Haptics** (hours) — do it first, it changes the feel of everything you build after.
2. **App Group + shared Keychain for the session and the media token, and `/media-token`
   itself** — before the extensions exist. This is the one decision that is expensive to
   retrofit, *and* it is the thing gating `MEDIA_AUTH=on` for the whole family. Verify with
   `report` mode's WOULD-BLOCK log, not by eye.
3. **Background upload queue + PHPicker with `PHAsset.creationDate`** (#1, #2) — the flagship.
   Full-res originals, HEIC as-is. **Skip Live Photos** (needs a schema decision).
4. **Thumbnail + display-photo disk cache** (#3, read-only). **Skip the general write
   outbox**; do it for chat sends and uploads only.
5. **`LazyVGrid` + paged album fetch, upload-order default + the sort toggle** (#9) — a day or
   two, and it is the difference between an album that scrolls and one that hitches.
6. **Save to Photos + multi-select** (#11) — small, and it retires the zip-through-an-iframe
   path for phone users.
7. **AVPlayer with HLS probing + PiP + AirPlay** (#6) — sign the segments via the resource
   loader (header or `?t=`), *then* flip `HLS_ENABLED=on` on the mini after checking the
   storage meter.
8. **The three-line APNs payload fix + a Notification Service Extension for photo
   attachments and the real badge** (#4). Actionable buttons for `EVENT_REMINDER` and
   `WORK_FOLLOWUP` only.
9. **Share Extension → "which album?" → enqueue** (#5).
10. **Two widgets**: fest countdown and tonight's dinner (both public-read, no auth — with the
    `fest_year` / `anytime` filters and the sign-in-gated dinner fields respected).

**Deferred to v2, deliberately:** Live Activities, Live Photos, the "who's up north" widget
and the interactive house-list widget (both need the shared session working first),
`AVAssetDownloadTask` pre-download, the pre-upload sensitivity check, Shortcuts/`AppIntent`.

⚠️ **One process rule, from a real incident in this repo:** never report any of this done off
a script's success message. An entire admin UI was once reported as shipped because a
`python s.replace()` edit had silently no-op'd. **Verify by reading the file back and
compiling.**
