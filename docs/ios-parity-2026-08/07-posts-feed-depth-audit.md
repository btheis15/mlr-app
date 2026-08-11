<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **10 correction(s)** were applied.

### Posts feed and comments — depth audit

**Web reference implementation:** `/Users/brian/mlr-app/components/PostsView.tsx` (1,821 lines — the feed, the composer, `EditPostPanel`, `MediaCarousel`, `MediaItem`, `CommentMedia`, `MentionText`, `CommentComposerSheet` all live in this one file), mounted by `/Users/brian/mlr-app/components/FeedView.tsx` (lines 792 and 935) inside the Feed tab. Supporting: `/Users/brian/mlr-app/components/Lightbox.tsx`, `/Users/brian/mlr-app/components/MediaGrid.tsx`, `/Users/brian/mlr-app/components/ReportButton.tsx`, `/Users/brian/mlr-app/components/MemberSheet.tsx`, `/Users/brian/mlr-app/lib/media.ts`, `/Users/brian/mlr-app/lib/mediaToken.ts`, `/Users/brian/mlr-app/lib/reactions.ts`, `/Users/brian/mlr-app/lib/moderation.ts`, `/Users/brian/mlr-app/lib/format.ts`, `/Users/brian/mlr-app/lib/dropBoxes.ts`.

iOS already has *a* Posts feed. **Nothing below requires a backend change** — every table, column, RPC and policy named here already exists in the shared Supabase project. This section is about how far the web feed has drifted ahead of whatever the native one does, and each item is written as "verify in the iOS repo" because the iOS tree is not on this machine and cannot be diffed here.

---

#### 1. The data model, and what an empty result means

One sentence per table on its **read** rule, so an empty array is interpretable. The feed tables went members-only in migration `0081_rls_lockdown.sql` — `profiles`, `posts`, `post_comments`, `post_media`, `post_tags`, `post_reactions`, `post_comment_mentions`, `albums` — and then **approved-members-only** in `0183_verified_member_reads.sql`. Two exceptions worth knowing: `post_comment_media` did not exist at 0081 (it shipped members-only in its own migration, `0162`, and was swapped to `is_approved_member()` by 0183 like the rest), and the moderation tables (`media_moderation`, `content_reports`, `content_moderation_events`) have **never** been member-readable at all. `is_approved_member()` is `profiles.approved is true OR profiles.is_admin is true` (`0181_member_approval.sql`).

| Table | Read rule (plain English) |
|---|---|
| `posts` | Returned only to an **approved** member, and then only if `status = 'visible'`, or you are the author, or you are an admin. Empty feed ⇒ almost always "this account is signed in but not yet verified by an admin", **not** "no posts". |
| `post_media` | Any approved member. **Not status-aware** — a held post's media rows still come back; they're orphaned because the parent `posts` row didn't. |
| `post_comments` | Approved member, and then `status = 'visible'` or your own or admin. |
| `post_comment_media` (0162) | Any approved member. Not status-aware (parent comment carries the status). Members-only from 0162 onward — it was created after the 0081 lockdown, so it never had a public-read phase. |
| `post_comment_mentions` (0022) | Any approved member. Not status-aware. |
| `post_reactions` | Any approved member. Not status-aware. |
| `post_tags` | Any approved member. Not status-aware. |
| `profiles` | Approved member, **or** your own row (`id = auth.uid()`). An unapproved account can read exactly one profile: its own. |
| `media_moderation` (0043) | **Nobody.** RLS on, zero policies — service role (the mini) and `SECURITY DEFINER` triggers only. Never query it from iOS; it will always be empty. |
| `content_reports`, `content_moderation_events` (0040) | Admins only. |
| `albums` (0004) + `posts.album_id` | Approved member — but **dead code**. Nothing in the web client reads or writes either one (verified: zero references to `albums` or `album_id` anywhere under `components/`, `lib/`, `app/`); the real "album" feature is `drop_boxes` (0171). Do not build UI against `albums`. |

⚠️ **Five child tables are not status-aware — `post_media`, `post_comment_media`, `post_comment_mentions`, `post_reactions`, `post_tags` — so iOS must key children off the post/comment ids it actually received.** All five got a bare `is_approved_member()` policy in 0183 with no moderation clause; only `posts` and `post_comments` carry the status term. The web builds `mediaByPost` / `mediaByComment` dictionaries and looks up by id, so orphans silently fall on the floor. If iOS instead renders "all media rows" it will paint photos belonging to posts the viewer isn't allowed to see.

#### Columns, with Swift nil handling

```swift
struct PostRow: Codable {           // table: posts
  let id: UUID
  let authorId: UUID                // author_id -> profiles.id
  let text: String?                 // nullable: a photo-only post has no caption
  let imagePath: String?            // image_path — LEGACY single image, see §4
  let createdAt: Date               // created_at
  let occurredAt: Date?             // occurred_at — NOT NULL in DB (0005), decode
                                    // optional anyway and coalesce to createdAt
  let status: String?               // 'visible' | 'pending' | 'hidden'; nil => treat
                                    // as "visible" (never crash on an unknown value)
}

struct PostMediaRow: Codable {      // table: post_media
  let postId: UUID
  let storagePath: String           // storage_path — usually a FULL mini URL
  let mediaType: String             // 'image' | 'video' (CHECK-constrained)
  let position: Int                 // display order, ascending
  let thumbnailUrl: String?         // 0173 — nil on older rows
  let capturedAt: Date?             // 0176
  let capturedAtSource: String?     // 'exif' | 'video' | 'file' | 'post'
}

struct CommentRow: Codable {        // table: post_comments
  let id: UUID
  let postId: UUID
  let authorId: UUID
  let text: String                  // NOT NULL — but can be "" for a photo-only
                                    // comment. Check .isEmpty, not nil.
  let createdAt: Date
  let status: String?               // ⚠️ the WEB never selects this — see §2/§6g.
                                    // Select it on iOS; the RLS clause is real.
}
// post_comment_media: id, comment_id, storage_path, media_type, position,
//                     thumbnail_url  (NO captured_at on this table)
// post_comment_mentions: PK (comment_id, mentioned_user_id)  — NO post_id column
// post_reactions:        PK (post_id, user_id)  — ONE reaction per member per post
// post_tags:             PK (post_id, tagged_user_id)
```

⚠️ **`post_reactions`' primary key is `(post_id, user_id)` — one emoji per member per post.** This is *not* the chat model. Switching emoji is an upsert on that conflict target, not a second row.

---

#### 2. What the web feed actually fetches (and where iOS should deliberately differ)

`refetch()` (PostsView.tsx:315-486) fires **eight** queries, seven of them in one `Promise.all`:

```
post_media            select post_id, storage_path, thumbnail_url, media_type, position,
                             captured_at, captured_at_source        order position asc
post_comments         select id, post_id, text, created_at, author_id order created_at asc
post_reactions        select post_id, user_id, emoji
post_tags             select post_id, tagged_user_id
post_comment_mentions select comment_id, mentioned_user_id
post_comment_media    select comment_id, storage_path, thumbnail_url, media_type, position
profiles              select id, display_name, full_name, avatar_url
posts                 select id, text, image_path, created_at, occurred_at, author_id, status
                      order occurred_at desc
```

⚠️ **Note what the comment query does NOT select: `status`.** The web reads moderation status on `posts` only, so a held or removed *comment* renders as a normal comment to its author and to every admin. That's a web gap, not a schema gap — the column exists on `post_comments` (0040) and RLS already filters on it. **iOS should add `status` to this select and render the same banners on comments** (see §6g).

⚠️⚠️ **None of these are paginated or limited. Do not port that.** The web pulls the *entire* history (~1,700 media rows and climbing) on every mount and on every realtime tick. It gets away with it because a browser tab is transient; a native app that does this on a cold open over cellular will feel broken. **iOS should page `posts` with `.range()` (25-30 at a time, ordered `occurred_at desc`), then fetch the children in two waves:**

1. the four tables that have a `post_id` — `post_media`, `post_comments`, `post_reactions`, `post_tags` — filtered `.in("post_id", pageIds)`;
2. then, once you have the comment ids back from wave 1, `post_comment_mentions` and `post_comment_media` filtered `.in("comment_id", commentIds)`.

⚠️ **`post_comment_mentions` and `post_comment_media` have NO `post_id` column** — they key on `comment_id` (0022's PK is `(comment_id, mentioned_user_id)`; 0162's FK is `comment_id`). Filtering either by `post_id` errors instead of returning rows, so the two-wave shape isn't optional. This whole change is the single biggest place native can beat the web version, and it needs no schema change.

⚠️ **Names are resolved from a separate `profiles` query, never a PostgREST embed.** The comment on PostsView.tsx:177-182 says why: *"Names/tags resolve from a separate profiles query (no PostgREST embed) so an ambiguous relationship can't blank the feed."* The failure mode it guards against is the recorded `tournaments↔tournament_entrants` incident: **two FKs between the same *pair* of tables** make `select("*, child(*)")` return `[]` with HTTP 300 / `PGRST201` and no error the UI notices.

⚠️ **To be exact — no pair of feed tables is doubly-linked today.** `posts.author_id → profiles` and `posts.album_id → albums` point at *different* tables, so they cannot collide, and every child (`post_media`, `post_comments`, `post_tags`, `post_reactions`) has exactly one FK back to `posts`. An embed would resolve right now. That is precisely why this is a **standing rule rather than a bug report**: the day anyone adds a second FK between an already-embedded pair (an `edited_by`, a `winner_id` — exactly what happened to tournaments), every embed built on it starts silently returning an empty array, and on a photo feed that reads as "the feed is broken". **Do not "clean this up" with an embed in Swift.**

Display-name fallback chain (PostsView.tsx:388): `display_name` (trimmed) → first word of `full_name` → literal `"Member"`. Mirror it exactly, or names will read differently on the two apps for the same person.

**Realtime:** one channel, `postgres_changes` `event: "*"` on all seven tables (`posts`, `post_media`, `post_comments`, `post_comment_mentions`, `post_comment_media`, `post_reactions`, `post_tags`), all funnelled into a **120ms-debounced** refetch (`useDebouncedCallback(120)`), because each refetch is ~8 queries and a burst of reactions would otherwise storm the DB. If iOS subscribes, debounce the same way — or better, apply row deltas locally instead of refetching.

**Ordering + day grouping:** sort `occurred_at desc`, then group into consecutive runs sharing a **local** `YYYY-MM-DD` key (`dayKey`/`groupByDay` in `lib/format.ts`), heading = `"Today"` / `"Yesterday"` / `"Saturday, July 27, 2026"`. Per-post time label is `formatClock` → `"2:00 PM"`; comment timestamps use `timeAgo`.

⚠️ **`lib/format.ts`'s `toLocalDate()` exists because of a real, expensive incident.** A bare `new Date("YYYY-MM-DD")` parses as **UTC midnight**, which renders as the *previous day* in Central — and the bug reached the *stored data*, because the same broken label was feeding a `<select>` in the fest planner, so 10 slot rows were persisted a day late and had to be corrected by hand. Feed timestamps are full ISO so they're safe, but if iOS ever formats a bare date string from this schema, use a `DateFormatter` pinned to the local calendar, never a UTC-defaulting parse.

---

#### 3. Depth-audit checklist — what the web feed does that iOS plausibly does not

Every line here is a **verify in the iOS repo** item, ordered roughly by how visible its absence is to a family member.

1. **Post media is a *swipeable carousel*, not one image.** `MediaCarousel` (PostsView.tsx:1597) renders scroll-snap pages with a dot row and an `n/total` badge in the corner. A single item renders as a plain square.
2. **Grids render `thumbnail_url`, not the full-res file** (`MediaItem`, PostsView.tsx:1644: `src={mediaSrc(m.thumbnailUrl || m.url)}`). Verify iOS isn't downloading originals into a scrolling list.
3. **Tapping a photo opens a full-screen carousel that swipes across the whole group** — `Lightbox` with a `photos` array from `photoUrls(media)` (`lib/media.ts:137`), with `n / total`, arrows, Escape. It used to be a dead end (one photo, close-and-reopen for the next).
4. ⚠️ **`photoUrls` filters `type === "image"`, deliberately not `!== "video"`.** A video in a post is *excluded* from the lightbox group — it plays inline in the carousel and would render as a broken image full-screen. Swiping moves photo → photo *past* the video.
5. **Comments carry photos and videos** (migration 0162) — rendered as a small wrapping row of ~96pt thumbnails (`CommentMedia`, PostsView.tsx:1654), **not** the full-bleed post carousel, and tapping one opens the same Lightbox.
6. **A comment can be photo-only** — the guard is "text OR at least one file" (PostsView.tsx:826). `post_comments.text` is NOT NULL, so a photo-only comment stores `""`.
7. **`@mentions` inside comments**, with inline autocomplete over the whole member list, persisted to `post_comment_mentions`, and rendered highlighted (`MentionText`, PostsView.tsx:1669).
8. **Reactions show WHO reacted** — tapping a reaction chip expands an inline comma-separated list of names, with `"You"` for yourself (`toggleReactors` / `nameById`, PostsView.tsx:773-778, rendered at 1243-1251).
9. **Reaction taps are optimistic and serialized per post** (PostsView.tsx:787-820) — see the warning in §7; this is subtle code that exists because of a real double-tap bug.
10. **Moderation status is rendered, not ignored** — an amber "⏳ Pending review — only you and admins can see this until an admin approves it" and a "🚫 Removed by an admin" banner (PostsView.tsx:1190-1199). ⚠️ On the web these are **posts only** (the comment query omits `status`); iOS should render them on comments too — see §2 and §6g.
11. **The composer re-reads the created row's status and tells the truth about it** — see the ⚠️⚠️ warning in §7. This is the single most important line in this section.
12. **Per-file upload with per-file retry** — one failed video in a ten-photo post no longer aborts the batch or orphans the successful uploads; the composer names what failed and re-sends only those (PostsView.tsx:610-655, `doneUploads` keyed by the `File` itself).
13. **Backdating** — the composer's "Set the date & time" checkbox writes `occurred_at`, so a photo posted late flows back into the day it happened.
14. **A full edit panel** — `EditPostPanel` (PostsView.tsx:1342): change the caption, add/remove media, add/remove tags, move the date, or delete, in one sheet.
15. **Tag people on a post** (`post_tags`) plus a **"🏷️ Tagged me"** feed filter.
16. **Timeline jump** — month chips derived from the posts present, plus a "jump to a day" date picker.
17. **Comment deep links** (migration 0164) — `?post=<id>&comment=<id>` scrolls to *and flashes* the specific comment, not just the post.
18. **"Also add to an album"** in both the composer and the editor, with the credit rule in §6f.
19. **Report / flag** on posts and comments, plus a device-local hide for the reporter.
20. **A trimmed cold-open snapshot** — the top 15 posts with their comments/reactions are persisted and painted instantly on next launch (`postsFeed.<uid>`).
21. **Media URLs must be signed** — see §7. Without this, once `MEDIA_AUTH` flips from `report` to `on`, **every photo in the native app 403s.**
22. **Every name and avatar in the feed is a tap-through to that member's contact/pay sheet** — `MemberSheet` (`components/MemberSheet.tsx`), mounted by PostsView at 1327-1329 and wired via `openMember()` in **four** places: a post author's avatar + name (1183), each name in the "🏷️ with Alice, Bob" tag line (1215), a commenter's avatar (1277) and a commenter's name (1281). From inside the feed you can text, call or pay whoever posted. If iOS renders names and avatars as inert text, it drops the feed's whole social-directory affordance.
23. **Real upload feedback in the composer** — two pieces: (a) byte-weighted progress across the whole batch, so the submit button reads `"Posting… 42%"` and a `role="progressbar"` bar tracks it (PostsView.tsx:1102-1113, fed by `uploadToMini`'s `onProgress`, held at 99% until the RPC returns); and (b) a pre-flight advisory for any picked video over **150 MB** — "🎬 Big video (~N MB). It'll post at full quality, but may take a few minutes on slower Wi-Fi" (PostsView.tsx:1088-1096). Both matter more on cellular than they ever did on the web.

---

#### 4. Post media: URLs, legacy paths, and captured_at

`post_media.storage_path` holds a **full mini URL** for everything uploaded since the move off Supabase Storage. But the web still branches:

```swift
// PostsView.tsx:401-403 and 446-448, in Swift terms:
let url = row.storagePath.hasPrefix("http")
  ? row.storagePath
  : supabase.storage.from("post-photos").getPublicURL(path: row.storagePath)
```

And a post with **zero** `post_media` rows but a non-nil `posts.image_path` falls back to one image from the `post-photos` bucket (PostsView.tsx:419-423). Migration 0004 copied those into `post_media`, so this is probably a zero-row path in practice — but it is ~6 lines and it's the difference between an ancient post rendering and rendering blank. Keep it.

**`captured_at` / `captured_at_source` (0176)** are on `post_media` for one reason: so that adding a post's photos to an album *later* gets the real shot date instead of a proxy. Provenance ranking, best first: `'exif'` / `'video'` (read from the file) > `'file'` (the picked file's mtime) > `'post'` (the post's own timestamp). A sweep on the mini may only ever move a row **up** that list, never down.

⚠️ **The web's capture-date pipeline is a workaround for a browser limitation iOS simply does not have.** `lib/media.ts` hand-rolls a JPEG/TIFF IFD walker (`extractExifCapturedAt`, `parseTiffForDate`, `findHeicTiffStart`) plus a `file.lastModified` fallback guarded against "the picker handed over a freshly-stamped temp copy" (`capturedAtForFile`, rejects anything within 60s of now, before 1995, or in the future). **iOS should read `PHAsset.creationDate` and send it as `capturedAt` with source `exif`** — authoritative, HEIC-safe, no parsing. Read it from the **original** asset before any export/compression.

⚠️ **`prepareImageForUpload()` is now a deliberate no-op** (`lib/media.ts:526`). It used to downscale to 1920px and re-encode at q0.82 through a `<canvas>`, which destroyed the full-resolution original *and* every byte of EXIF — that is the root cause of migrations 0174-0176 existing at all. The mini now builds the display copy itself and preserves the upload as `<uuid>_orig.<ext>`. **iOS must upload the original bytes too.** Do not add client-side compression "for speed"; it re-creates a bug the team spent three migrations recovering from.

---

#### 5. Creating a post — the exact sequence

The web's `submit()` (PostsView.tsx:577-771), in order, and the order matters:

1. **Client guards:** caption ≤ `POST_TEXT_MAX` (5000); every file passes `fileRejectionReason` (must be `image/*` or `video/*`, ≤ `MAX_UPLOAD_MB` = 1024 MB). Both are re-checked server-side.
2. **Upload every file FIRST**, one at a time, *continuing past failures*. Success is remembered keyed by the file so a retry re-sends only what failed.
3. **If anything failed, stop before creating the post** — nothing is ever half-published. Show `describeFailedUploads(failures)`.
4. **Optional AI text screen:** `POST <MEDIA_URL>/moderate/text` with `Authorization: Bearer <supabase access token>`, body `{ "text": "…" }`, response `{ flagged: bool }`. **Fail-open** — any error means `false`. Result becomes `p_held`.
5. **One atomic RPC.**

```
create_post(
  p_caption     text        default null,
  p_occurred_at timestamptz default null,   -- null => now(); set to backdate
  p_media       jsonb       default '[]',   -- ordered array, position = index
  p_tags        uuid[]      default '{}',   -- profiles ids -> post_tags
  p_held        boolean     default false   -- true => created 'pending'
) returns uuid                              -- the new post id
```

⚠️⚠️ **The keys inside each `p_media` element are camelCase, and a `JSONEncoder` with `.convertToSnakeCase` will silently drop three of them.** The exact keys read by the function body (`0176_post_media_captured_at.sql`) are:

```json
{ "path": "<full mini url>", "type": "image", "thumbnail": "<url|null>",
  "capturedAt": "<ISO8601|null>", "capturedAtSource": "exif" }
```

`path` missing ⇒ the RPC raises `'Media path required'`; `type` must be exactly `image` or `video`. An unparseable `capturedAt` is swallowed (never fails the post), and an unrecognised `capturedAtSource` is coerced to `'exif'` (while a null `capturedAt` nulls the source outright).

⚠️ **Use `create_post`, never three separate inserts.** The whole point of migration 0080: the old client did `posts` → N× `post_media` → `post_tags`, so a mid-loop failure left a **live, half-finished post in the feed** while the author saw "Couldn't post". Everything lands in one transaction now. (The web keeps a pre-migration multi-insert fallback behind a `PGRST202`/`42883` check — iOS does not need that; the migration has long since run.)

6. **Then, and only then, re-read the row's status.** See §7.
7. Optional album referencing (§6f), then refetch.

**Upload endpoint:** `POST <MEDIA_URL>/upload?category=posts` (no `room` for the Feed) with `Authorization: Bearer <supabase token>`, multipart field `file`, plus optional form fields `capturedAt` and `capturedAtSource`. `MEDIA_URL` is **`https://mlr-media.duckdns.org`**.

Response (`media-server/server.js:1610`):
```json
{ "url": "...", "thumbnailUrl": "...|null", "hlsUrl": "...|null",
  "capturedAt": "...|null", "capturedAtSource": "exif|video|file|null",
  "name": "...", "originalName": "...", "type": "image|video|file", "path": "posts/2026-08/<uuid>.jpg" }
```

⚠️ **Never hardcode the retired Tailscale Funnel host `brians-mac-mini.tail49943c.ts.net`.** `lib/media.ts:17-34` documents why in capitals: a stale `NEXT_PUBLIC_MEDIA_URL` baked that host into the web bundle, and because `mediaSrc()` matched by *prefix*, every duckdns URL failed the check and was returned **unsigned, with no error at all** — indistinguishable from "no token yet". Match by **host against a known set**, never by prefix against one configured string. The Funnel also relays through Tailscale DERP at 12-21 Mbps against a 119 Mbps uplink.

⚠️ **`/upload` failure statuses iOS must map to human text** (mirror `uploadErrorMessage`, `lib/media.ts:261`): `507` = the mini is out of space (tell an admin); `413` = file too big; `415` = the byte-sniff rejected it as non-media (only `category=chat` accepts arbitrary files); `401`/`403` = sign-in expired — **and `403 pendingApproval` is a real response** for a signed-in-but-unverified member (`requireApprovedMember`, `media-server/server.js:736-745`). Also handle the transport cases the web learned the hard way: a dropped connection mid-transfer, an abort, and a timeout are three different failures and the first one is the most common for a big video.

⚠️ **`429` on `/upload` is NOT an expected rate limit — uploads are deliberately un-throttled.** `media-server/server.js:157-173` sets a 600-req/15-min global limiter and then explicitly exempts this route (`skip: (req) => req.path === "/health" || req.path === "/upload"`), with the note: *"uploads are intentionally NOT rate-limited. The core use case is dumping a whole album … any per-hour cap 429'd real family uploads mid-dump. Safety comes from auth + magic-byte sniff + MAX_MB, not a count limit."* So **do not build a client-side throttle** (an earlier draft of this spec claimed 30/hour per user — there is no such cap, and honoring it would cripple posting a fest album). Still map a 429 defensively as "try again shortly"; `uploadErrorMessage` does.

⚠️ **Moderation and video transcoding are asynchronous.** `/upload` returns immediately (`media-server/server.js:1570` — every category is optimistic now); a flagged verdict lands in `media_moderation` seconds later and a DB trigger retroactively flips the parent post to `'pending'`. And a cross-extension transcode (`.mov` → `.mp4`) **repoints `post_media.storage_path` afterwards** — so a URL can change shortly after upload. Re-read the row; never cache a media URL forever.

---

#### 6. Feature-by-feature detail

**a. Editing a post.** RLS (`0005_post_occurred_at.sql`) allows `UPDATE` on `posts` by the author **or any admin, with no time window** — this is *not* the chat model (chat is 24h-author / admin-anytime, migration 0023). The web writes a diff: `posts.text` + `occurred_at`; `delete` on `post_media` matched by `(post_id, storage_path)` for each removed item; insert rows for newly-picked files at `position = post.media.length + i`; then add/remove `post_tags`. Removing media deletes the **row**, not the file — the mini's `orphan-sweep.js` quarantines unreferenced files after a 48h grace (`ORPHAN_GRACE_HOURS`) and purges 7 days later (`MEDIA_TRASH_RETENTION_DAYS`).

**b. Deleting a post.** `delete from posts where id = …`; RLS allows author or admin. Cascades to `post_media`, `post_comments` (and their media/mentions), `post_reactions`, `post_tags`. Web confirms with a dialog first.

**c. Comments.** Plain insert into `post_comments` `{ post_id, author_id, text }`, then (if any) mention rows, then media rows. Delete is a **hard delete** by the author or an admin.

⚠️ **There is NO update policy on `post_comments` anywhere in the migrations — comments cannot be edited, at all, by anyone.** Don't build a comment editor on iOS expecting it to work; the write will be silently rejected by RLS. There is also no soft-delete/tombstone here (that's chat only, `deleted_at` in 0023) and no threading/replies — `post_reply` is a *notification kind* for "someone else also commented", not a nested reply.

**d. Two completely different "mention" mechanisms — do not conflate them.**
- **On a post:** a *member picker* writing `post_tags(post_id, tagged_user_id)`. Rendered as "🏷️ with Alice, Bob" under the caption, each name tappable into `MemberSheet` (checklist item 22). Notification kind `post_tag`. Search matching is `matchesName` (PostsView.tsx:170): empty query matches everyone; otherwise substring **or** any word that starts with the typed text ("b" → all B names).
- **In a comment:** free-text `@Name` with inline autocomplete writing `post_comment_mentions(comment_id, mentioned_user_id)`. Candidates exclude yourself, capped at 6. Notification kind `post_mention`.

⚠️ **Comment mentions are pruned on every keystroke, on a word boundary.** `liveMentions` (PostsView.tsx:1714) keeps a mention id only while `@Name` is still present and the next character is absent or a non-letter/non-digit — regex `@Name(?![\p{L}\p{N}])`. That guard exists so a member called "Jo" doesn't stay tagged off someone else's "@John". Insertion is `"@Name "` with the trailing space. In Swift, use a `CharacterSet.alphanumerics` boundary check rather than porting the regex.
⚠️ **Rendering must match longest-name-first** (`MentionText`, PostsView.tsx:1673 sorts candidate names by descending length before building the alternation), or "@Jo" inside "@John" highlights the wrong span.
⚠️ **Comment mentions are scoped to the WHOLE member list, unlike committee chat**, whose mentions are scoped to that committee's roster. Don't apply the chat scoping rule here.

**e. Reactions.** Six emoji, fixed order: `["👍","❤️","😂","😮","😢","🎉"]`. Toggle logic (`lib/reactions.ts`): if the tapped emoji equals your current one, `delete` your row; otherwise `upsert({post_id, user_id, emoji}, onConflict: "post_id,user_id")`. Summary is a client-side tally, most-used first (`reactionCounts`). Tapping a chip expands the names behind that emoji.

⚠️ **Port the optimistic-reaction machinery carefully — it exists because of a real bug** (PostsView.tsx:779-820). Three parts, all load-bearing: (1) the in-flight intent lives in a **ref**, not state, because a second tap firing before the re-render would otherwise read the stale DB value and *re-upsert instead of deleting*, so the reaction sticks on; (2) toggles are **chained per post** so they reach the server in tap order; (3) only the **tail** of the chain clears the optimistic override, so an earlier completion can't wipe a newer tap's intent. In Swift this maps to an actor (or a serial task queue) per post id holding `pendingEmoji`, with the override cleared only when the task that set it is still the current one.

⚠️ Switching emoji fires no second notification: `trg_notif_post_reaction` is `AFTER INSERT` only, and an upsert's conflict path runs as an UPDATE.

**f. "Also add to an album", and the credit rule.** Both the composer (PostsView.tsx:992-1017) and the editor (1540-1565) offer a checkbox + album dropdown, sourced from `fetchDropBoxes(uid, false)` filtered to `!archivedAt`. It **references the same media** into the album — no re-upload, the album row points at the same mini URL, so the moderation verdict carries over. Best-effort: a failure here never undoes the post.

```
add_drop_box_media(
  p_box uuid, p_url text, p_type text,
  p_thumbnail_url text default null,
  p_captured_at timestamptz default null,
  p_captured_at_source text default null,
  p_credit_user_id uuid default null      -- migration 0180
)
```

⚠️⚠️ **The credit rule: when an *already-posted* photo is referenced into an album, credit goes to the POST'S AUTHOR, not whoever ticked the checkbox.** `EditPostPanel` passes `p_credit_user_id: post.authorId` (PostsView.tsx:1429 and 1458). The common case is an admin retroactively adding a member's old post to an album, and it's still that member's photo. The parameter is **only honored server-side when the caller is an admin** — a non-admin's value is silently ignored, so nobody can attribute an upload to someone else. The *composer's* own flow deliberately does **not** pass it (the poster is the caller; PostsView.tsx:710 stops at six args).

⚠️ **For kept (already-stored) media there is no original file left to read metadata from**, so the editor picks the best available date in order: (1) `post_media.captured_at` read back (the real thing, 0176); (2) the **post's own timestamp** tagged `source: 'post'` as an explicit proxy. Never send `'exif'` for a date you didn't read off a file — the mini's sweep uses `captured_at_source` to decide what it's allowed to overwrite, and a mislabeled proxy pins a row against ever being upgraded.

**g. Moderation status rendering.** Three values on both `posts` and `post_comments`: `visible`, `pending` (auto-held, awaiting an admin), `hidden` (an admin removed it — kept, reversible). Because RLS returns non-visible rows to the author *and to every admin*, an admin's feed contains held and removed posts.

⚠️ **The web renders these banners on posts only** (PostsView.tsx:1190-1199) because its comment query never selects `status`. iOS should select `post_comments.status` and render the same two banners on a comment — the RLS clause on `post_comments` is real, so a held comment is already being returned to its author and to admins today; it just isn't labeled.

⚠️ **If iOS ignores `status`, every admin sees removed content rendered as normal posts.** Render the banners. Four ways a row gets held, all server-side and none of them client-visible at write time: the blocklist trigger (`moderate_content_text`, whole-word for single terms since 0160), ≥2 distinct member reports (`apply_content_report`), an AI media verdict at attach time (`hold_post_on_flagged_media` 0043 / `hold_comment_on_flagged_media` 0162), and a *retroactive* verdict arriving after the media row (`hold_content_on_media_verdict`, 0128 §5b + 0162's fourth branch, on `after insert or update` of `media_moderation`).

⚠️ **A member cannot change status by editing** — `moderate_content_text` pins `NEW.status := OLD.status` for any non-admin update (unless the transaction-local `mlr.mod_bypass` GUC is set, which only the automated holds do). So an "un-hide by editing" attempt from iOS will appear to succeed and change nothing.

**h. Reporting.** `report_content(p_entity_type text, p_entity_id uuid, p_reason text default null)`, `p_entity_type` ∈ `'post' | 'comment'`. Reasons offered: "Inappropriate or offensive", "Sensitive / private info", "Spam", "Something else". Dedup is one report per member per item (re-reporting just updates the reason). **≥2 distinct reporters auto-holds the item** (conservative on purpose: one grudge can't hide content, two independent flags can). The web additionally hides the post **device-locally** for the reporter immediately (`localStorage` key `mlr.flaggedPosts`), because `content_reports` is admin-read-only so there's nothing else to key off. iOS should do the same with `UserDefaults`. Hide the Flag affordance on your own posts and comments.

**i. Deep links.** Notification URLs are `/posts?post=<postId>` and, for `post_comment` / `post_reply` / `post_mention` since migration 0164, `/posts?post=<postId>&comment=<commentId>`. The web runs **two independent** `useDeepLinkFlash` instances (`"post-"` and `"comment-"`) that poll for the DOM node up to 20 × 150ms ≈ 3s, then scroll it to center and ring it for 2.2s. In SwiftUI this is `ScrollViewReader.scrollTo(id, anchor: .center)` plus a temporary highlight — but with the **same retry patience**, because the target may not be loaded yet.

⚠️ **Comments are unpaginated in the DOM, which is why "scroll to comment" works at all.** If iOS paginates or collapses comment threads, a `&comment=` link must first *expand/fetch* that comment before scrolling, or the deep link silently lands on the post instead.
⚠️ **Notification rows created before 0164 ran carry a post-only URL** — a harmless degrade, not a bug. Handle a missing `comment` param.

**j. Timeline filters.** "🔍 Filter" reveals: Everyone / **🏷️ Tagged me** (client-side `post.tags.some(t => t.id === uid)`), month chips built from `dayKey(ts).slice(0,7)` of the posts present (shown only when more than one month exists, or a jump is already set), and a "jump to a day" date input. All client-side over the already-loaded set — if iOS paginates, either re-query server-side (`occurred_at` range) or be explicit that the filter only covers loaded posts.

**k. Identity.** `uid` here is the **real session `userId`**, deliberately *not* `previewAsId` (PostsView.tsx:188-191): uid gates writes and ownership, which always belong to the real account. If iOS has any "view as" concept, apply the same rule — and remember the house rule that every *write* must no-op while previewing.

**l. Share.** The web does `navigator.share({title, text})` and falls back to opening the family Facebook group with the caption on the clipboard. On iOS this is just `ShareLink` / `UIActivityViewController` — strictly better, and it can include the actual photo.

---

#### 7. The warnings to put in code comments / iOS CLAUDE.md

⚠️⚠️ **THE COMPOSER MUST RE-READ THE CREATED ROW'S `status` AND SAY SO. A held post used to look like a silent failure.**
For a long stretch the web composer always showed **"Posted — everyone can see it now ✓"**, even when a trigger had auto-held the post. `p_held` only reflects the client's *own* fail-open AI text pre-check; it says nothing about whether the server's blocklist trigger (or a media verdict) separately auto-held the row, and the RPC reports success either way because the trigger never throws. The consequence, during the 0160 blocklist regression: ordinary posts containing an innocent word with a blocked fragment inside it ("bass", "class", "glass", "assist", "hello", "shell") were held for everyone while the author was told it went out fine — so it read as *"posting is broken"* rather than *"this one post is held"*. The fix (PostsView.tsx:721-744):

```swift
// after create_post returns newPostId
let fresh: PostStatusRow? = try? await supabase
  .from("posts").select("status").eq("id", value: newPostId).maybeSingle()
switch fresh?.status {
case "pending", "hidden":
  toast("Posted — held for admin review (only you and admins can see it until then) ⏳")
default:
  toast("Posted — everyone can see it now ✓")
}
```
Same reasoning applies to a **comment** (the attach-time media hold in 0162 fires on the `post_comment_media` insert, i.e. *after* the comment row exists) and to an **edit** (an edited caption re-runs the blocklist and can newly hold a previously-visible post). Never claim publication without reading back the status.

⚠️⚠️ **Photo URLs must be signed, and iOS is currently the reason enforcement is turned down.** Every `/f` read requires `?t=<token>` (`media-server/media-auth.js`). `MEDIA_AUTH` is deliberately at **`report`**, not `on`, *because the native app can't sign yet* — enforcement would 403 every photo on the 3 registered iOS devices. Implement `GET <MEDIA_URL>/media-token` with `Authorization: Bearer <supabase jwt>` → `{ token, expiresAt, ttlHours }` (`ttlHours` is informational; you only need the first two); append `?t=` (or `&t=`) to **every** media URL you render, including `thumbnail_url`. Rules ported from `lib/mediaToken.ts` / `mediaSrc()`:
- The token is **identical for every member** within a 24h window. That sameness is load-bearing: a per-request token would change every URL and defeat the image cache. The server accepts the current **and previous** window.
- **Match by host** (`mlr-media.duckdns.org`, plus the legacy Tailscale host), not by URL prefix. Leave Supabase avatar URLs and anything under `/assets/` untouched.
- Idempotent: skip if `?t=` or `&t=` is already present.
- Fetch with **no caching**. The endpoint once answered `304 Not Modified`, the web read `!res.ok` as "no token", and 104 consecutive unsigned requests on one album 403'd. Treat 304 as "keep what you have", never as failure.
- **Refetch the token on every app launch**, cached or not. A cached token is only a *guess* about what the server will accept; if the signing key changes, a client keeps confidently signing with a dead key for up to 24h with **no self-healing** — that is exactly how a one-line key change became an app-wide outage. One small authenticated request per launch buys automatic recovery.
- Drop the cached token a minute before its stated expiry, and **force a UI refresh when a token arrives on a launch that started without one** — a URL built during render before the token landed stays unsigned forever otherwise. On the web this was a latent daily screen-of-broken-photos.
- An **unapproved** member gets **no** token, hence no photos. That matches what the DB already shows them; render an explanatory state, not an error.

⚠️⚠️ **Never build a PostgREST embed for this feed.** `.select("*, post_media(*)")`-style embeds return `[]` with HTTP 300 / `PGRST201` — no thrown error — whenever two FKs connect the *same pair* of tables. No feed pair is doubly-linked today (so an embed would work right now), which is exactly what makes this a trap worth pre-empting: the first added `edited_by`/`winner_id` turns every such embed into a silent empty feed. Resolve authors and children with separate queries keyed by id, exactly as the web does.

⚠️ **Upload everything before creating the post, and abort the whole create if any file failed.** The original code threw out of the upload loop on the first bad file: photos already on the mini were orphaned, the remaining files were never attempted, and the author got one generic "Couldn't post" with no idea which file was the problem — so their only move was to re-pick all ten and hope. Track per-file success so a retry re-sends only the failures.

⚠️ **Do not compress or re-encode photos client-side.** See §4 — the old canvas compression destroyed the full-res original *and* all EXIF, which is why three migrations exist to recover capture dates. Upload originals; the mini makes the display copy.

⚠️ **A video in a post plays inline and is excluded from the photo lightbox group.** Mixing it in produces a broken frame mid-swipe.

⚠️ **`albums` / `posts.album_id` are dead.** The album feature is `drop_boxes`. Anything you build against `albums` will be invisible to the web app forever.

⚠️ **Character caps are enforced by a Postgres trigger that RAISES**, not by RLS: 5000 for a post, 2000 for a comment, error text `'That post is too long (max 5000 characters).'` with `errcode = check_violation`. Pre-check client-side so the user gets a friendly message instead of a raw Postgres error.

⚠️ **The `/moderate/text` call is fail-open and rate-limited to 60/min.** Any error, timeout or non-200 must be read as "not flagged". It is a courtesy pre-check, not a gate — the DB blocklist is the real floor. iOS can skip it entirely in v1 with no loss of safety. (Note the contrast with `/upload`, which is **not** rate-limited at all — see §5.)

⚠️ **Empty feed ≠ no posts.** Post-0183, an empty result from `posts` almost always means the signed-in account is not yet **approved** by an admin. Surface "waiting to be verified", never "no posts yet", when `profiles.approved` is false for the current user (that one row is readable via the `id = auth.uid()` exception).

---

#### 8. Where iOS can beat the web app

- **`PHPickerViewController` instead of a hidden `<input type="file">`.** The web app carries a documented incident where triggering a file input from inside a popup menu **silently delivered nothing** in the installed iOS PWA — picker opened, photo selected, nothing arrived, no error; three attempted fixes failed on-device before the popup itself was removed. Native has no such class of bug, gets multi-select with a proper count, and gets **Live Photos**, bursts and RAW as first-class assets.
- **`PHAsset.creationDate` kills the whole EXIF-scraping stack.** No IFD walker, no HEIC byte-scan, no `lastModified` heuristic with its "is this a freshly-stamped temp copy?" guard. Send `capturedAt` with source `exif` and every album sorts correctly on the first try — including the HEIC case the web can only recover server-side.
- **Background upload via `URLSession` background configuration.** The web's biggest real-world failure is a big video dying mid-transfer with the tab in the foreground. iOS can let someone post a 400MB fest video, lock the phone, and have it finish — with a local notification when it lands. The mini's `/upload` timeout is 4h, `MAX_MB` defaults to 50 GB, and the route is exempt from rate limiting, so the server side is already built for this.
- **`AVPlayer` + the HLS ladder the mini already builds.** `media-server/hls.js` produces a 540p/720p/full ABR ladder and `/upload` already returns `hlsUrl` (derived by convention: `<same dir>/<uuid>_hls/master.m3u8`) — **and the web app consumes none of it**; `HLS_ENABLED` is off precisely because "ladders are useless until the client can play them". AVPlayer plays HLS natively with adaptive bitrate and no JS player. Two caveats before pitching it: turning it on needs a mini `.env` change + restart, and ⚠️ **HLS segment URIs inside a playlist are relative and will NOT carry `?t=`** — `media-auth.js`'s `isAlwaysPublic()` exempts only `/privacy` and `/assets/`, so with `MEDIA_AUTH=on` every segment 403s; this needs either playlist rewriting or an exemption for `*_hls/` first. Flag it; don't assume it.
- **A real photo viewer.** `Lightbox` is a scroll-snap div with a `<10px` pointer-movement guard so a swipe doesn't fire a dismissing click. Native gets pinch-zoom, double-tap-to-zoom, drag-to-dismiss with a rubber-band, and a matched-geometry transition from the grid tile — the interaction people expect from Photos.
- **Rich/actionable notifications.** `post_comment`, `post_reply`, `post_mention`, `post_tag`, `post_reaction` and `new_post` all already fan out with a deep link. A `UNNotificationContentExtension` can show the actual photo in the expanded notification, and notification **actions** can offer "❤️ React" and inline "Reply" — both are single writes (`post_reactions` upsert, `post_comments` insert) that need no new backend. The web can only open the app.
- **Paginate + cache properly.** Web refetches the entire feed on every realtime tick. iOS can page 25 posts at a time, keep a real on-disk cache, and apply realtime *deltas* instead of refetching — instant scroll and far less DB load. The web's own answer to this is a hand-rolled localStorage snapshot capped at the top 15 posts because of a 200KB limit (`MAX_PERSIST_BYTES` in `lib/swrCache.ts`).
- **Offline reading and offline-queued posts.** Post from the lake with no bars, upload when signal returns.
- **Haptics** on reaction taps and on a successful post — the web's `lib/haptics.ts` is explicitly a no-op on iOS (`navigator.vibrate` doesn't exist in Safari or the installed PWA).
- **A "recent photos" widget / On-This-Day widget** off the same `post_media` + `captured_at` data the web's `OnThisDayCard` already reads.
- **Share sheet with the real image**, not just the caption text.

---

#### 9. Honest size, and a v1 cut

This is roughly **2-3 weeks** of focused work as a full port, and it splits cleanly:

**Ship-first (the parity floor, ~1 week):** status-aware rendering + banners (on comments as well as posts); the honest post-status re-read; media-token signing; thumbnail-first grids; the swipe carousel and swipe lightbox; comments with media and `@mentions`; who-reacted; the name/avatar tap-through to `MemberSheet`; report/flag; the `?post=&comment=` deep link.

**Second pass:** `EditPostPanel` in full (caption + media add/remove + tags + backdate is four distinct write paths); "also add to an album" with the credit rule; timeline month/day jump; the tagged-me filter; upload progress + the big-video advisory.

**Cuts that cost almost nothing:**
- Skip the **no-Supabase local fallback** entirely (the `POSTS` seed in `lib/data.ts`, the `added`/`hidden` local-post state). It exists so the web builds without a backend; iOS always has one. That alone removes a meaningful slice of `PostsView`.
- Skip every **pre-migration degrade path** — `isMissingFunction`, the `42703` column-group retry ladder in `insertMediaRow`, the `withOcc`/`withoutStatus`/`base` posts-query cascade, the `post_comment_media` retry-without-`thumbnail_url`. All of those migrations (0005, 0040, 0080, 0162, 0173, 0176) have run in production. Just select the real columns.
- Skip the **client `/moderate/text`** pre-check in v1 (fail-open; the DB blocklist is the enforcement point).
- Skip **`posts.image_path`** legacy fallback only if you're willing to verify the row count is zero first — otherwise keep it, it's six lines.
- Defer **month/day jump filters** and the **Facebook share fallback**.

Do **not** cut: `status` handling, the status re-read after create, media-token signing, or thumbnail-first rendering. Those four are the difference between "the native feed works" and four separate classes of user-visible breakage.
