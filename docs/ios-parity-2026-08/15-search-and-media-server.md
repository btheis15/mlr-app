<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **7 correction(s)** were applied.

### Conversation search, and media-server behaviours iOS must match

Two related things live here because they share one host — the Mac mini's media-server at `https://mlr-media.duckdns.org`. Part A is a feature iOS does not have (search). Part B is a contract iOS *already violates in places*, and getting it right is what unblocks turning media auth from `report` to `on`.

---

## Part A — Conversation search (migrations `0129` → `0130` → `0131`)

### What it is, in one paragraph

A member searches every conversation they can see — the resort Family Feed (`posts` + `post_comments`), each committee/area chat (`committee_messages`), and their house chat (`house_messages`) — and taps a result to jump to the source message. Nothing is indexed per-user: content is embedded **once** into a locked table and a `SECURITY DEFINER` RPC re-applies the caller's own visibility rules at query time.

Web UI for reference: `components/ConversationSearch.tsx` (full-screen search over the Feed channel list), client seam `lib/search.ts`, result → navigation mapping in `components/FeedView.tsx`'s `openResult`.

### iOS calls the mini, NOT the RPC

```
POST https://mlr-media.duckdns.org/search
Authorization: Bearer <the member's own Supabase access_token>
Content-Type: application/json
{ "q": "golf hat", "limit": 15 }
```

The mini does two things: embeds `q` on-device (Apple `NLContextualEmbedding`, 512-d, via a separate Swift/Vapor `embed-service` on loopback :8786), then creates a *second* Supabase client using **the caller's forwarded token** and calls the RPC as them. RLS is the only scoping — the service-role key is deliberately never used for search (`media-server/server.js`, the `/search` handler).

⚠️ **You cannot call `search_conversations` directly from iOS.** Its first parameter is a non-defaulted `extensions.vector(512)`; you'd have to produce an Apple embedding client-side and serialize it as a pgvector literal. Go through `POST /search`.

For completeness, the **live** signature (only version that exists after `0130` dropped the original; `0131` replaced the body in place):

```sql
public.search_conversations(
  query_embedding extensions.vector(512),
  query_text      text    default '',
  match_count     integer default 20
) returns table (
  source_type text, source_id uuid, content text, created_at timestamptz,
  similarity double precision, committee_id uuid, area text,
  house_id uuid, post_id uuid, author_id uuid
)
```

⚠️ There is **no `min_similarity` parameter any more** — `0130` dropped the `(vector, integer, double precision)` overload wholesale. Any older doc or snippet showing it is stale.

### Response shape and the Swift model

`200` body is `{ "query": "...", "count": N, "results": [ ...rows... ] }`. Rows come straight from PostgREST, so keys are snake_case and five of them are nullable:

```swift
struct SearchResult: Decodable, Identifiable {
    var id: String { "\(sourceType.rawValue):\(sourceId)" }

    enum SourceType: String, Decodable {
        case post, postComment = "post_comment"
        case committeeMessage = "committee_message"
        case houseMessage = "house_message"
    }

    let sourceType: SourceType
    let sourceId: UUID
    let content: String            // never null — the SQL filters empty/blank
    let createdAt: Date
    let similarity: Double
    let committeeId: UUID?         // set only for committee_message
    let area: String?              // nil == the committee-wide "General" channel
    let houseId: UUID?             // set only for house_message
    let postId: UUID?              // post: its own id; post_comment: the PARENT post
    let authorId: UUID?            // nullable — don't force-unwrap

    enum CodingKeys: String, CodingKey {
        case sourceType = "source_type", sourceId = "source_id"
        case content, createdAt = "created_at", similarity
        case committeeId = "committee_id", area
        case houseId = "house_id", postId = "post_id", authorId = "author_id"
    }
}

struct SearchResponse: Decodable { let query: String; let count: Int; let results: [SearchResult] }
```

`created_at` is an ISO-8601 timestamptz with fractional seconds and a `+00:00`/`Z` offset. Use a custom `DateFormatter`/`ISO8601DateFormatter` with `.withFractionalSeconds`, or the same decoding strategy the existing Posts feed already uses for `posts.created_at` — reuse it rather than inventing a second one.

`author_id` is only an id. The web resolves display names with a separate `profiles` read (`select id, display_name where id in (...)`) after results land, and just omits the name on a miss. Do the same, or reuse whatever profile cache the Posts feed already has.

### Status codes iOS must distinguish

| Status | Meaning | What to show |
|---|---|---|
| `200`, `count: 0` | No keyword match; **or** `q` shorter than 2 chars (the server short-circuits at `<2` and returns an empty result set, not an error); **or** the query was un-embeddable — all punctuation/emoji, where `embedOne()` returns null and the handler answers `200` empty rather than `503` | "No matching messages you can see." |
| `401` | Session expired mid-search (`requireUser` rejected the JWT) | Treat as empty, refresh the session — web returns `[]` rather than an error here |
| `503` | Either the embed-service is unreachable/errored ("Search is warming up. Try again in a moment.") or `SUPABASE_URL`/`SUPABASE_ANON_KEY` aren't set on the mini ("Search isn't configured.") | A retryable "search is warming up" state — **not** "no results" |
| `502` | The RPC itself failed ("Couldn't run the search.") | Generic error |
| `429` | Rate limit — 60 searches/min/IP (`searchLimiter`) | Back off |

The whole family can share one apparent IP behind the lake WiFi, so a 320ms debounce (what the web uses) is not just polish — it keeps a typing member from eating the shared 60/min bucket. Also carry over the web's monotonic sequence guard so a slow earlier response can't overwrite a newer one.

Server-side clamps: `q` trimmed and truncated to **500 chars**; `limit` coerced into **1…50**, default 20 (the RPC additionally caps at 100). The web sends `limit: 15`.

### The RLS read rule, one sentence per table

All of these are re-implemented *inside* the RPC (it's `SECURITY DEFINER`, so it reads the base tables with the definer's rights and then filters). An empty result almost always means "not permitted or not indexed", never "the message doesn't exist".

- **`content_embeddings`** — deny-all: RLS on with **zero policies** and `revoke all … from anon, authenticated`. Nothing but the RPC (and the service-role indexer) can read it. Don't try to query it from iOS; you'll get zero rows with no error.
- **`posts`** — you see a post if `status = 'visible'`, or you are `author_id`, or `profiles.is_admin`.
- **`post_comments`** — same rule, **and** the parent post must also pass it (both gates, joined).
- **`committee_messages`** — `deleted_at is null`, visible/own/admin, **and** `public.can_access_committee_area(committee_id, area)` — i.e. you're on that committee's roster for that area. ⚠️ That helper was *introduced* in `0063`, but the **live definition is `0177`'s** — `0172` added a Leads branch and `0177` recreated the whole function verbatim and repointed that branch. Don't read `0063` and stop. `area is null` is the committee-wide General channel; the leads-only room matches **case-insensitively** (`lower(area) = 'leads'`, and only while no real area is literally named "Leads") and is gated on `public.is_committee_lead(committee_id)` (`0177`; it was `is_committee_area_lead` in `0172`) with **no admin override** — so an admin who isn't a lead of that committee gets no Leads results, even though the admin override covers every other area.
- **`house_messages`** — `deleted_at is null`, visible/own/admin, **and** `public.is_house_member(house_id)` (`0064`, never redefined since).
- Plus a hard `auth.uid() is not null` gate: a signed-out caller gets nothing (and `requireUser` would have 401'd first anyway).

Consequence worth designing for: join a committee and its whole history becomes searchable on the next query; leave and it disappears. No index rebuild, no client cache to invalidate.

### ⚠️ The warnings — read all of these

⚠️⚠️ **Filter with the full-text match operator `@@`, never a `ts_rank(...) > 0` test.** This was the `0130` bug and it leaked the entire corpus. For a **multi-word** query, `ts_rank` returns a tiny non-zero (~1e-20) for documents that don't match at all, so `lex > 0` was true for everything and the "if any keyword matched, keep only matches" branch collapsed into "return everything, with the real hits on top and noise underneath". Single-word queries returned exactly `0.0`, which is why `"golf"` looked perfect and `"golf hat"` looked broken. `0131` fixed it by filtering with `to_tsvector('english', content) @@ websearch_to_tsquery('english', query_text)` and using `ts_rank` **only for ordering**. If you ever add a second search surface, a saved-search, or a "search this room" variant, do not reintroduce a score threshold — use the boolean operator.

⚠️ **Search is currently PURE KEYWORD, despite the name and the web's placeholder copy.** Apple's mean-pooled `NLContextualEmbedding` vectors are anisotropic — cosine similarities bunch into a narrow ~0.85–0.92 band — so a threshold can't separate relevant from irrelevant. The embeddings now only break ties among keyword matches (`order by lex desc, similarity desc, created_at desc`). So: **do not build a "% match" badge or sort control out of `similarity`**, and don't ship copy promising "find it without the exact words" until someone mean-centres the embeddings (a noted future enhancement, not wired). `"pork"` matching nothing correctly returns zero rows.

⚠️ **An empty/whitespace `query_text` returns ZERO rows, not "everything".** `websearch_to_tsquery('english','')` is an empty tsquery and `@@` against it is false for every document. The mini has a legacy fallback that re-calls the RPC with only `{query_embedding, match_count}` if the 3-arg form isn't found (`PGRST202`) — post-`0130` that call now just resolves to the same function with `query_text` defaulting to `''`, so that path returns an empty list. Always send a real `q`.

⚠️ **A message is not searchable until the indexer has embedded it — typically up to ~2 minutes, longer after a restart.** The RPC's every branch is `from content_embeddings e join <table> …`, so content with no embedding row is *invisible to search*, not merely low-ranked. `media-server/search-indexer.js` reconciles on a timer (`SEARCH_INDEX_FIRST_MS` ≈ 20s after boot, then `SEARCH_INDEX_SWEEP_MS` ≈ 2 min), embedding new/edited rows (keyed by a sha256 `content_hash`, so an edit re-embeds) and pruning orphans. **Do not write a test that sends a chat message and immediately searches for it** — it will fail for a legitimate reason and send you hunting a nonexistent bug. If a member reports "my message isn't findable", check the mini's `[search-index]` log lines before anything else.

⚠️ **Only `text` is indexed.** Photos, videos, captions on media rows, poll questions, work items, events, drop-box items, and member names are all unsearchable. If the product ask is "search everything", that's a backend change (new `source_type` values in the `content_embeddings` check constraint + new branches in the RPC + new `SOURCES` entries in the indexer), not an iOS change.

⚠️ **Search results reflect the CURRENT text, not the indexed text.** Only a hash lives in `content_embeddings`; the RPC returns `content` from the live base table. So an edited-then-not-yet-reindexed message is *found by its old words* but *displayed with its new text*. That's intentional and better than the alternative, but it will look like a bug in a demo.

⚠️ **Backend gap — flag before shipping the UI: `search_conversations` does NOT check `is_approved_member()`.** `0183` swapped the members-only read policies on `posts`/`post_comments` over to `is_approved_member()`, but the search RPC is `SECURITY DEFINER` and re-implements visibility itself with only `status`/author/admin + `auth.uid() is not null` — and `POST /search` on the mini is `requireUser` only, with no `requireApprovedMember`. So a signed-up-but-unapproved account that can see *nothing* through a normal select can still read post and comment **text** through `/search` (`/upload`, `/media-token` and `/dropbox-zip` are approval-gated, so no photos leak; committee/house rooms are safe because an unapproved newcomer has no roster/house membership). Verified against the SQL: `0131`'s body contains no `is_approved_member()` call, and execute is granted to `authenticated`, which an unapproved signup is. Either (a) gate the search entry point behind the same `approved` flag your verified-member states already read, and/or (b) ask for a one-line migration adding `and public.is_approved_member()` to the RPC's outer `where`. Doing (a) alone is a UI fix over an open API.

### Deep-linking a result

Web sets URL params then switches the visible channel, and each room's existing `?m=` effect scrolls to + flashes the message (identical to an Activity-tab deep-link). Port the *mapping*, not the URL mechanics:

| `source_type` | Target | Identifier to carry |
|---|---|---|
| `post`, `post_comment` | Family Feed | `post_id` (for a comment this is the **parent** post; `source_id` is the comment — if you want to land on the exact comment, that's the `&comment=` behaviour from `0164`, which `openResult` itself does **not** use today) |
| `committee_message` | committee/area chat matched by `committee_id` **and** `(area ?? "") == (area ?? "")` | `source_id` as the message to scroll to |
| `house_message` | house chat, only if `house_id` == the viewer's house | `source_id` |

Note the area comparison: `nil` area and `""` must compare equal or General-channel results silently fail to resolve (web coalesces both sides). If no local channel matches (e.g. the member's channel list hasn't loaded), web bails silently — better to show a toast on iOS than to no-op.

### Size

**Small — roughly a day.** One POST, one Codable, one list screen, plus wiring into your existing chat/feed scroll-to-message. A v1 can ship without author-name resolution and without the "search this room only" filter (neither exists on web either).

---

## Part B — Media-server behaviours iOS must match

### ⚠️⚠️ The base URL: `https://mlr-media.duckdns.org`. Never the Tailscale funnel host.

The retired host is `brians-mac-mini.tail49943c.ts.net`. It still resolves, which is exactly what makes it dangerous:

1. **It silently un-signed every photo on the web app.** `NEXT_PUBLIC_MEDIA_URL` was still set to the funnel host in Vercel and Next inlines `NEXT_PUBLIC_*` at build time, so the stale value won over the code default. `mediaSrc()` then did `if (!url.startsWith(MEDIA_URL)) return url` — a duckdns URL doesn't start with a ts.net prefix, so **every** media URL was returned unsigned, with no error and no warning, indistinguishable from "we don't have a token yet". Confirmed by grepping the live bundle (2 chunks contained ts.net, zero contained duckdns) while the server logged 57 `tok=missing` requests from a phone that had fetched a valid token seconds earlier.
2. **It routes through Tailscale DERP and measured 12–21 Mbps against a 119 Mbps uplink.** Reads already went direct (the mini stamps `PUBLIC_URL` into every stored row); it was *writes* — uploads and token fetches — quietly still taking the slow relay.

Two rules fall out of this, and `lib/media.ts` encodes both:

- **Match by HOST against a known set, never by prefix against one configured string.** iOS should keep a `Set<String>` of hosts whose URLs are ours to sign (`mlr-media.duckdns.org` always in it, whatever any config says) and decide "is this ours?" by `URLComponents(...)?.host`. A future host change then degrades to "add an entry", not an app-wide silent media outage.
- **Any configured override that equals the retired host is ignored, not honoured.** Genuine local-dev overrides still work; that one host is refused on purpose.

`PUBLIC_URL` is baked into ~1,700 stored rows, so changing it is a data migration, not a config change.

CORS is irrelevant to you: `ALLOWED_ORIGINS` gates browser origins only, and `URLSession` isn't subject to CORS. You do **not** need an entry added for the native app.

### `POST /upload`

```
POST https://mlr-media.duckdns.org/upload?category=posts|chat|work|dropbox&room=<slug-or-box-id>
Authorization: Bearer <supabase access_token>
Content-Type: multipart/form-data
  file               ← the ONLY accepted field name (multer `upload.single("file")`)
  capturedAt         ← optional ISO-8601 string
  capturedAtSource   ← optional: "exif" | "file"  (anything else is downgraded to "file";
                        ignored entirely unless capturedAt parses)
```

⚠️ **`category` and `room` MUST be query parameters, not form fields.** The upload destination (which volume, which folder) is chosen *before any bytes land*, so the server can only read the query string at that point. A `category` sent as a multipart field is ignored and the file is filed under `posts/` — as is any unrecognized `category` value, since the server falls back to `posts`.

Folder layout the server derives (you never construct paths — you store the returned `url` verbatim): `posts/<YYYY-MM>/`, `chat/<room>/<YYYY-MM>/`, `work/<YYYY-MM>/`, `dropbox/<box-id>/<YYYY-MM>/`. `room` and `category` are both **lower-cased** and stripped to `[a-z0-9_-]`, max 40 chars (`safeSeg`) — a drop-box uuid passes through as-is, but anything with other characters silently becomes a *different* folder rather than an error.

**Success (`200`):**

```swift
struct UploadResult: Decodable {
    let url: String              // full https URL — store this verbatim in *_media.storage_path
    let thumbnailUrl: String?    // null when generation failed — fall back to `url`, never fail the upload
    let hlsUrl: String?          // null today (HLS_ENABLED=off on the mini)
    let capturedAt: String?      // ISO-8601 or null
    let capturedAtSource: String? // "exif" | "video" | "file" | null
    let name: String             // basename on disk
    let originalName: String     // what you uploaded
    let type: String             // "image" | "video" | "file"
    let path: String             // path relative to the media root
}
```

**Failures — all of these are real and each needs distinct copy:**

| Status | Cause | Notes |
|---|---|---|
| `401` | `requireUser` — no/invalid/expired Supabase JWT | Refresh the session and retry |
| `403` with `{"error": "...", "pendingApproval": true}` | ⚠️ **NEW: `requireApprovedMember`.** A verified Supabase login is no longer enough — an admin must have set `profiles.approved` (an `is_admin` profile counts as approved) | Show "an admin needs to approve your account first", not a generic failure. **Detect it by the `pendingApproval` flag, not by string-matching the message.** This gate exists because an unapproved signup could otherwise write files to the media volumes until the SSD hit its reserve and uploads started 507ing *for the whole family* |
| `415` | Magic-byte sniff said it isn't a real image/video, and `category != "chat"` | Chat allows any file (PDFs etc.) and a sniff miss there just means `type: "file"`. Posts/work/dropbox are images+videos only. The sniff reads the first 32 bytes — name and MIME are not trusted |
| `507` | Both volumes out of room / would breach the 15 GB boot-disk reserve | "The media server is out of space — tell an admin". Not the file's fault |
| `400` | multer error, or no file in the request | Includes the file-size cap being blown |
| `503` | The mini couldn't reach Supabase to validate the token | |

**Not rate-limited, deliberately.** `/upload` is skipped by the global limiter (600 req/15min) precisely because a family dumping a fest album from one phone behind one shared IP was getting 429'd mid-dump. Safety comes from auth + the sniff + `MAX_MB`. So iOS may upload a whole album serially without backing off — but see the timeout note below.

**`MAX_MB` is 50 GB and the request timeout is 4h (`UPLOAD_TIMEOUT_MS`).** ⚠️ Neither means a 50 GB upload works — bandwidth binds first, and raising the cap without the timeout just converts a clean `413` into a mid-transfer timeout, which wastes the entire transfer. Use a background `URLSession` upload task with a file body (never load the asset into memory), report progress, and treat a dropped connection as retryable: the server reclaims the partial file on socket abort.

⚠️ **Do not compress or re-encode photos before uploading.** Web used to downscale to 1920px and re-encode at JPEG q0.82 through a `<canvas>`, which destroyed the full-resolution original permanently *and* stripped every byte of EXIF — migrations `0174`–`0176` exist almost entirely to recover a date that destroyed. `prepareImageForUpload()` in `lib/media.ts` is now literally `return file`. Send the original asset bytes. The mini builds the display copy itself (`media-server/display.js`: ~3200px long edge, JPEG q90, mozjpeg) and keeps your upload beside it as `<uuid>_orig.<ext>`. HEIC is fine — it converts properly with a real image library.

⚠️ **A consequence of that: the returned `url`'s extension can differ from what you sent.** A HEIC upload comes back as `…/<uuid>.jpg` because no browser (and no `AsyncImage`) can render HEIC over HTTP. **Always store the returned `url`; never derive it from the local filename.**

For `capturedAt`, read `PHAsset.creationDate` from the **original** asset and send it with `capturedAtSource: "exif"`. That's strictly more reliable than the web's EXIF byte-scraping, and it's the value drop-box albums sort by (`drop_box_media.captured_at`, `0174`; `captured_at_source` ranks providers `exif`/`video` > `file` > `post`, and a sweep may only ever move a row *up* that list — `0175` adds the column to `drop_box_media`, `0176` to `post_media`). If you send nothing, or send only `"file"`, the server re-reads the stored bytes itself (sharp for HEIC, ffprobe for video) and overwrites with real metadata.

### Async moderation: content can be held AFTER it's posted

Moderation used to block the upload response for posts/work/dropbox. **It no longer does for any category.** `/upload` responds immediately and grades in the background via the mini's local `fm serve` (Apple PCC preferred, on-device fallback), downscaling a copy to ≤1024px first because `fm serve` caps request bodies at 1 MB.

A flagged verdict is written to `media_moderation` keyed by the **public URL** (`storage_path`), and the DB trigger `trg_hold_on_media_verdict` → `hold_content_on_media_verdict()` then **retroactively** flips the parent row's `status` from `'visible'` to `'pending'`, matching on `storage_path`. RLS then hides it from everyone but the author and admins.

What this means for iOS:

- **You write no moderation code.** No pre-check, no wait, no verdict polling.
- ⚠️ **But you must honour `status` when rendering, and you must expect it to change seconds after a successful post.** A post/comment/chat message can be `'visible'` when you insert it and `'pending'` on the next fetch. Don't cache "I posted this, so it's live" — re-read the row. Web's post composer specifically re-reads the created row's `status` and says "held for admin review" instead of always claiming "Posted — everyone can see it now ✓", because the always-optimistic toast made a legitimate hold look like posting itself had broken.
- The current live trigger has **four** branches, in this order: `posts` (via `post_media`), `post_comments` (via `post_comment_media`, `0162`), `committee_messages` (via `committee_message_media`), `house_messages` (via `house_message_media`).
- ⚠️ **`drop_box_media` has NO retroactive branch — verify this before promising drop-box moderation on iOS.** Its hold is `hold_drop_box_media_on_flagged()`, a **BEFORE INSERT** trigger (`drop_box_media_hold`) that reads an *already-existing* verdict (`0171`, written when moderation was inline). With moderation now asynchronous, the verdict usually doesn't exist yet at insert time, and `hold_content_on_media_verdict()` (last recreated in `0162`, which predates drop boxes) never touches `drop_box_media`. CLAUDE.md describes drop-box items as retroactively held; the SQL as written does not do that. If drop-box moderation matters for the iOS release, that's a **backend migration**, not client work.
- ⚠️ **A second race worth knowing about:** the verdict is recorded against the URL that `/upload` returned, while the background transcode may repoint `*_media.storage_path` to a *new* URL (below). If the swap lands before the verdict, the trigger's `storage_path` match finds nothing and a flagged video stays visible. Low frequency, but don't be surprised by it, and don't "fix" it client-side.
- Text moderation is a separate, optional call: `POST /moderate/text` (`{text}` → `{flagged, category, reason}`, `requireUser`, 60/min, `express.json({limit:'64kb'})`, fail-open `{flagged:false}` on any error or when `MOD_ENABLED` is off). Web calls it before publishing a caption. There is also an always-on deterministic blocklist trigger in Postgres, so skipping this endpoint doesn't remove the floor.

### Background transcode: a media URL is NOT permanent

Videos are transcoded to ≤1080p H.264 MP4 in the background (`media-server/transcode.js`, `maybeTranscode`), after the response has already gone out carrying the **original** file's URL. Two cases:

- **Same extension** (you sent `.mp4`): the original is renamed to `<uuid>_orig.mp4` and the rendition is renamed into its place — atomic, same directory. **The URL never changes.**
- **Different extension** (`.mov` → `.mp4`): the original keeps serving at its own URL, fully playable, until the transcode finishes **and** every `*_media` row has been repointed. `swapMediaStoragePath()` then `PATCH`es `storage_path` across all six tables — `post_media`, `post_comment_media`, `work_item_media`, `drop_box_media`, `committee_message_media`, `house_message_media` — and only then is the original renamed aside.

⚠️⚠️ **So do not cache a media URL forever, and never persist it as your own source of truth.** For a short window after upload the row points at the original (larger, possibly HEVC); afterwards it points at a different URL entirely. Re-read the `*_media` row (you already subscribe to realtime on most of these) rather than trusting a URL you captured at upload time. A hardcoded/derived URL will 404 after the swap.

The original always survives as `<uuid>_orig.<ext>` and is what `?dl=1` hands back — so a "Save to Photos" action should hit `…/f/<rel>?dl=1&t=<token>`, which serves the untouched file with `Content-Disposition: attachment`, not the bitrate-capped rendition. (This used to overwrite the upload with the re-encode, destroying every original the family ever shot. Don't reintroduce that.)

HLS: `hlsUrl` is advertised by convention *before* any ladder is built, but `HLS_ENABLED` is **`off`** on the mini today (it's not in the mini's `.env`, and the module default is `off`), so it comes back `null`. Ignore it for v1; if it's ever turned on, the contract is "store one URL and fall back to the progressive mp4 until the playlist exists".

### Inline thumbnails

`media-server/thumbnail.js` runs **inline** during `/upload` (a single fast sharp resize, or one ffmpeg frame grab) and returns `thumbnailUrl`. ~400px long edge, JPEG q70, stored as a plain `<uuid>_thumb.jpg` sibling in the same `/f` tree — no new route.

- **Thread `thumbnailUrl` into every `*_media` insert.** All six tables have a nullable `thumbnail_url` (`0173`). ⚠️ It is a **trailing** param on `add_work_item_media(p_work_item_id, p_url, p_media_type, p_position, p_thumbnail_url text default null)` but **not** on `add_drop_box_media` any more — `0174`, `0175` and `0180` each appended a param after it, so the full current order is `p_box, p_url, p_type, p_thumbnail_url, p_captured_at, p_captured_at_source, p_credit_user_id` and `p_thumbnail_url` is the **4th**. Pass RPC args by NAME, never positionally.
- **Render `thumbnail_url` in grids/albums and only load the full-res file on tap-through.** This is the single biggest scroll-performance win in the app.
- `thumbnail_url` null is normal and never an error — fall back to the full-res URL. Pre-`0173` rows are all null (at backfill time it was 0/48 album items and 0/45 post media), and a sweep fills them from files already on disk.
- ⚠️ **A video's poster frame is seeked ~10% in (capped at 3s), not frame 0** — real phone video routinely opens on a black or half-exposed frame while the camera settles, and frame 0 gave a whole album of black tiles. The output is size-checked because a seek past the last keyframe can produce an empty file *without* erroring.
- ⚠️ **A video tile still needs a ▶ badge.** With a real poster frame it's otherwise indistinguishable from a photo. (Surfaces that render videos with native player controls don't need one — the controls are the affordance.)

### `GET /f/<rel>` — the serving contract

- **Every read requires a signed token**, sent as `?t=<token>` (`media-server/media-auth.js`) — ⚠️ but only once `MEDIA_AUTH=on`; the mini's `.env` says `report` **today**, so an unsigned read still succeeds right now and is merely logged (see the promotion section below). Build as if it were `on`. The token rides in the query string because image/video loaders can't attach an `Authorization` header and a cookie would have to be third-party (Safari/iOS blocks those outright). An `Authorization: Bearer <token>` header is also accepted for programmatic callers.
- The token comes from `GET /media-token` (`requireUser` + the approval gate; a `403 pendingApproval` here means no photos, matching what the DB already shows that member). It is an HMAC over a rounded 24h window and is **identical for every member** in that window — that sameness is load-bearing, because a per-request token would change every URL on every render and nothing would ever hit the cache. Verification accepts the current **and previous** window, so a token is good for 24–48h.
- ⚠️ **Range requests are supported and load-bearing** — `/f` is `express.static` (and `res.sendFile` for `?dl=1`), both of which honour `Range` and answer `206`, which is what makes video seeking and the native player work. Do **not** fetch media through your own code into a `Data` blob to attach a header: that destroys HTTP caching and breaks Range. Hand `AVPlayer`/`AsyncImage` the signed URL directly.
- ⚠️⚠️ **Known iOS-specific hazard, already written into the server's logs:** the native player is known to **drop the query string on some Range retries**. If video breaks under enforcement while photos are fine, that is the exact signature. `media-auth.js`'s report-mode log line includes `range=yes|no` specifically so you can spot it. If you hit it, an `AVAssetResourceLoaderDelegate` (or `AVURLAsset` with `AVURLAssetHTTPHeaderFieldsKey` where available) sending the token as a header is the escape hatch — the server accepts both forms.
- **Caching:** `Cache-Control: max-age=365d, immutable` (filenames are unique). Let `URLSession`'s cache do its job. Because the token is stable per 24h window, signed URLs are cache-friendly — sign them the same way every render or you'll defeat it.
- **404s:** a miss anywhere in the four-root fallback chain (SSD → SSD legacy → external drive → external legacy) ends in `404 {"error":"Not found."}`. A file that exists only on the external drive serves at the *same* URL — nothing in the database records which volume holds the bytes. If the external drive is unmounted, cold-only files 404 and everything else keeps working.
- **`400 {"error":"Bad request."}`** for any path with a `..` segment, backslash or NUL (checked with repeated URL-decoding, so `%252e%252e` is caught too). This runs *unconditionally*, before the enforcement check.
- **Deleted media 404s** — a quarantined file under `_trash/` is blocked for its 7-day hold. (That check sits just *after* the token middleware, so under enforcement a token-less `_trash` request 403s before it 404s.)
- `.m3u8` and `.ts` get explicit content types (`application/vnd.apple.mpegurl`, `video/mp2t`); the master playlist is served `no-store` because its contents depend on live load.
- **`GET /media-load`** is public and returns an aggregate throughput + viewer count so a client can cap adaptive quality mid-playback. Nothing about who is watching what. Optional for v1.
- **Always-public exceptions:** `/health`, `/assets/*` (repo-shipped pay-method logos rendered on the sign-in screen), `/privacy` (App Store requirement), `/media-load`. ⚠️ **Do not build a path-prefix exemption of your own inside `/f`** — one existed and was an authentication bypass for the entire library: `GET /f/assets/%2e%2e/posts/2026-06/<uuid>.jpg` satisfied `startsWith("/assets/")`, skipped the token, and `express.static` then normalized the `..` and served the private photo. (`isAlwaysPublic()` still exists in `media-auth.js` but `requireMediaToken` deliberately no longer consults it.)

### ⚠️⚠️ `MEDIA_AUTH` is currently `report`, and iOS is the reason

Enforcement was verified working on web (220/220 signed requests) and then **deliberately backed off to `report`** (confirmed: `MEDIA_AUTH=report` in the mini's `.env`), because `apns_subscriptions` shows registered iOS devices and the native app has no `/media-token` support — enforcement would 403 every photo in it. `report` serves everything but logs `[media-auth] WOULD-BLOCK … tok=missing|invalid range=… ua=…`.

**The promotion path — do not skip step 3:**

1. Ship the iOS token support.
2. Have a member open the iOS app and scroll an album, and separately **play a video** (Range is a different code path).
3. `grep "WOULD-BLOCK"` on the mini. Zero lines from real clients means every client is signing correctly.
4. Only then set `MEDIA_AUTH=on`.

Flipping straight to `on` broke the whole family's photos twice in one afternoon, and both times the evidence needed to predict it was only obtainable by breaking it.

### The token-lifecycle lessons, translated to SwiftUI

These are the exact traps the web hit; the SwiftUI shapes differ but the failure modes don't.

⚠️⚠️ **Signing is synchronous at render time, and an unsigned URL is returned silently.** Web's `mediaSrc()` reads the cached token synchronously and returns the URL **untouched** when there isn't one — so anything that obtains a token must also force a re-render, or already-painted images stay unsigned and 403 forever. This was a latent screen-of-broken-photos on web: the cache is dropped a minute before its 24h expiry, so it would have hit *everyone about daily*, plus every first launch on a new device. In SwiftUI: hold the token in an `ObservableObject`/`@Published` (or the environment) so views re-render when it lands, and don't build URLs in a `let` computed once at init.

⚠️⚠️ **Refetch the token on EVERY app open, cached or not — don't "optimize" that away.** A cached token is only a *guess* about what the server will accept. It carries its own 24h expiry, so if the signing key changes the client keeps confidently signing with a dead key and every photo 403s until that expiry lapses — up to a full day, with **no self-healing**. That is what turned a key rotation into an outage. (The server now also verifies against a legacy-key list, which makes a *staged* rotation harmless — but a key changed without staging the old value still lands exactly here.) One small authenticated request per launch buys automatic recovery.

⚠️ **Track the token's expiry in memory, not just in storage.** Web's in-memory copy used to be returned forever once set, so an app left open past 24h signed every URL with a dead token. Drop it ~60s early so a URL can't expire mid-flight.

⚠️ **`GET /media-token` must be fetched with caching disabled.** It used to answer `private, max-age=600` with an Express-generated ETag over a body that is byte-identical for the whole 24h window — so after 600s the client revalidated and got a **304**, `res.ok` was false, the client concluded it had *no token*, and every photo 403'd while `/media-token` looked perfectly healthy in the logs (alternating 200s and 304s). Observed live: 104 consecutive unsigned requests on one album. The server now sends `no-store` and no validator at all (written via `res.end`, because `res.json`/`res.send` always computes an ETag); on iOS use `.reloadIgnoringLocalCacheData` and treat a `304` as "keep what you have", never as failure.

⚠️ **Never append a token to a non-media URL.** Supabase avatars, `data:`, local file URLs, and `/assets/*` must be returned untouched — signing them is noise at best and a cache-buster at worst. Make the signing helper idempotent (`if url already has ?t= , return it`), which is what made a scripted sweep across ~18 web components safe.

⚠️ **Signing key trivia that cost real debugging time:** the *issuing* secret is `MEDIA_TOKEN_SECRET` **or, falling back, `SUPABASE_SERVICE_ROLE_KEY`** — so an unset `MEDIA_TOKEN_SECRET` never meant "unsigned". Two corrections to the folklore: `MEDIA_TOKEN_SECRET` **is now set** on the mini, and `media-auth.js` verifies against a *set* of keys (`ACCEPTED_KEYS` = the issuing secret + the service-role key, **permanently accepted but never issued** + anything in the comma-separated `MEDIA_TOKEN_SECRETS_LEGACY`). So adopting a dedicated secret is **no longer a rotation at all**, and a genuine rotation staged through `MEDIA_TOKEN_SECRETS_LEGACY` is a non-event — that list exists *because* of the 2026-08-10 outage. If you ever need to mint a test token, call `require("./media-auth").issueToken()` on the mini — never hand-roll the HMAC. The message is `` `media:${window}` `` and the digest is base64url sliced to **43** chars; a reimplementation that signs the bare window index (or slices to 32) 403s and looks exactly like a real enforcement failure.

**A cookie would be simpler and was explicitly DECLINED (2026-08-10).** The app is on `vercel.app` and media on `duckdns.org` — different *sites*, so the cookie would be third-party and Safari/iOS blocks it. Making it work needs a real domain (`app.<d>` + `media.<d>`), at which point this whole layer could be deleted. Brian chose to teach iOS to send the token instead. Don't re-pitch without a domain.

### Rate limits, in one table

| Route | Limit |
|---|---|
| global (everything except `/health` and `/upload`) | 600 / 15 min / IP |
| `/upload` | **none** (skipped on purpose) |
| `/search` | 60 / min / IP |
| `/moderate/text` | 60 / min / IP |
| `/geocode` | 30 / min / IP |

`trust proxy` is 1, so limits key on the real client IP through Caddy — but the whole family often shares one WiFi and one apparent IP. Debounce anything typed.

### Size of Part B

**Small-to-medium, and mostly corrective.** The token plumbing is ~30 lines plus making it observable. The upload changes are a new query-param shape, a `403 pendingApproval` branch, dropping any client-side image compression, and threading `thumbnailUrl`/`capturedAt` through your `*_media` inserts. The one genuinely new discipline is **never treating a media URL as permanent** — everything else is a one-time change. A v1 can skip `/media-load`, HLS, and `?dl=1` downloads; it cannot skip the token, or every photo in the app 403s the moment `MEDIA_AUTH` goes to `on`.
