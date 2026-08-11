<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **10 correction(s)** were applied.

### Committee & house chat — depth audit

iOS already has "committee chat" and "house chat". Treat that as **the 2026-Q1 shape of the feature**, not as done. The web rooms have since grown per-area channels, a private Leads channel, archived read-only rooms, who-reacted expansion, tombstoned replies, timed mutes, typing indicators, inline polls, a meeting response bar, moderation status, semantic search across every room, and a whole optimistic-send/partial-upload-failure protocol. **Nothing below needs a backend change except two items, both called out with 🛑.** Everything else is Swift against schema that already exists.

The iOS repo is not on this machine, so every "iOS probably lacks X" below is written as **verify in the iOS repo** — do not trust it as fact, but do check every one.

Reference implementations (read them; they are heavily commented with the incidents):
- `/Users/brian/mlr-app/components/CommitteeChat.tsx` (1342 lines)
- `/Users/brian/mlr-app/components/HouseChat.tsx` (1198 lines — a near-copy minus area scoping)
- `/Users/brian/mlr-app/components/FeedView.tsx` (the room list, unread summaries, mute sheet, ⋯ menu, archived disclosure, search entry point)
- `/Users/brian/mlr-app/components/ChatPollCard.tsx`, `ChatPollComposer.tsx`, `MeetingSection.tsx`, `TypingIndicator.tsx`, `ConversationSearch.tsx`
- `/Users/brian/mlr-app/lib/chatPolls.ts`, `lib/reactions.ts`, `lib/mediaToken.ts`, `lib/search.ts`, `lib/hooks.ts` (`useTypingChannel`, `useDeepLinkFlash`)
- Migrations `0013`, `0014`, `0023`, `0024`, `0063`, `0065`, `0074`, `0090`, `0112`, `0128`, `0129`–`0131`, `0149`, `0155`, `0160`, `0172`, `0173`, `0177`, `0183`

---

#### 1. The room model: five kinds of room, three of them probably missing on iOS

A "chat room" on web is one of these. **`committee_messages.area` is the whole channel mechanism** — there is no channels table.

| Room | Query predicate | Feed section label |
|---|---|---|
| Committee-wide | `committee_id = …` **and `area IS NULL`** | "Full helping crew" (was "General") |
| Role / subcommittee | `committee_id = …` and `area = 'Meals'` | "Roles & subcommittees" |
| **Leads** (0172/0177) | `committee_id = …` and `area = 'Leads'` | "Lead chats" |
| House | `house_messages.house_id = …` (no areas at all) | "Your house" |
| **Archived** (0112) | same as above; committee or area has `archived_at` set | "🗄️ Archived chats" disclosure, read-only |

⚠️ **`area IS NULL` is the committee-wide channel and must be queried with `is`, never `eq`.** In supabase-swift that is `.is("area", value: nil)`. `.eq("area", value: nil)` does not mean the same thing and will quietly return the wrong set. Web has a small helper for this in `FeedView` (used for both the last-message and the unread query) — but `CommitteeChat` and `ChatEntryButton` **inline the same ternary** instead of calling it, which is precisely why every call site needs auditing rather than one:
```ts
const areaEq = (q) => (ch.area ? q.eq("area", ch.area) : q.is("area", null));
```

⚠️⚠️ **The read-state table uses a DIFFERENT sentinel for the same channel.** `committee_messages.area` is `NULL` for the committee-wide room, but `committee_area_reads.area` is `''` (empty string) — it is part of the primary key, which cannot hold NULL. `mark_area_read(cid, p_area)` does the `coalesce(p_area, '')` for you server-side, but **any direct read of `committee_area_reads` must filter `.eq("area", ch.area ?? "")`**. Mixing the two sentinels gives a room whose unread badge never clears, which reads as "the app is broken", not as a query bug.

**The Leads channel is the subtlest room, and it is entirely new since iOS chat was written.**
- Gate: `can_access_committee_area(cid, 'Leads')` resolves to `is_committee_lead(cid)` (0177, which superseded 0172's `is_committee_area_lead`).
- "Lead" means **either** `committee_roster.is_lead = true` (committee-level, 0177) **or** any entry in `committee_roster.roles[]` ending in `' · Lead'` (area lead). Both count. A committee with zero subcommittees can still have leads.
- ⚠️ **There is NO admin override on this branch.** This is a deliberate product decision: an app admin who is not a lead of that committee is not in its Leads room. So for an admin, an empty Leads room means **"not permitted"**, and iOS must not show a Leads row to a non-lead admin at all — otherwise they tap into a permanently empty room.
- ⚠️ **Mirror the SQL's back-off guard client-side.** If an admin ever creates a real role literally named "Leads", the `'Leads'` sentinel stops being magic and behaves as an ordinary area. Web's `FeedView` does exactly this: `if (iAmLead && !committeeArchived && !myAreas.includes("Leads"))`. Skip that check and a lead sees two "Leads" rows, one of which RLS-denies.
- ⚠️ **Write the sentinel as exactly `'Leads'`, capital L.** The SQL branch matches case-insensitively (`lower(p_area) = 'leads'`, and the back-off guard checks `lower(ca.area) = 'leads'`), so a row written as `'leads'` would still pass the gate — but every client-side channel key, room query and the mini's push recipient resolution compares the literal string `'Leads'`, so that message lands in a channel nothing lists and nobody is pushed about.
- ⚠️ `area = 'Leads'` is deliberately a value that `valid_committee_areas` (0073) rejects as a role — it validates every persisted area against the `committee_areas` allow-list (and hard-rejects "general"), and `'Leads'` is not in it — so nobody is ever *assigned* it. Do not offer it in any area picker.

**Archived rooms (0112) are read-only in RLS, not just in UI.** The insert policy is `author_id = auth.uid() and can_access_committee_area(...) and not is_committee_area_archived(committee_id, area)`. So iOS must (a) list archived rooms it can still read, (b) hide the composer, (c) hide poll/meeting creation — `create_chat_poll` raises `'This chat is archived'`. Web copy: "🗄️ This chat is archived — you can read the history, but it's closed to new messages." (House chat has no archived concept.)

**Which rooms does a member get?** Web builds the list from `committee_roster` where `linked_user_id = me` (⚠️ **`committee_roster` is the membership source of truth since 0057, NOT `committee_members`**), unions the committee rows for those slugs, and derives areas by stripping `' · Lead'` off each role. `committee_roster.is_lead` is selected with a graceful `42703` fallback so a pre-0177 DB still builds channels.

**What a non-member sees (committee only) — port the lock card.** `CommitteeChat` resolves an access state *before* it renders anything, and each state has its own screen:
- `loading` → a neutral spinner. ⚠️ **Never fall through to the lock card here** — it made a 🔒 flash on every room switch.
- `guest` → "{name} chat is for members" + a Sign in button.
- no-access → "Join {name} to chat" + a **📝 Request to join {name}** button calling `request_to_join({ cid, msg })`.
- `pending` → "Request sent ⏳" (⏳ glyph, not 🔒) — "an admin will approve you… you'll drop right in once they do."
- `coming-soon` / `setup` → "Committee chat is coming soon" (no Supabase config, or the committee row doesn't exist).

Access is re-derived on every open **and kept live** off `committee_roster` + `committee_join_requests` realtime, so an approval flips the viewer into the room with no reload — and it can **downgrade**, so revoked access never sticks. **House chat has no request-to-join**: a non-member gets an "ask an admin to add you" lock, because houses are admin-assigned.

⚠️ **The `' · Lead'` suffix has exactly one home** — `baseArea` / `isOnArea` / `isAreaLead` / `withArea` / `withoutArea` in `lib/committeeAdmin.ts`. Comparing raw role strings already caused silent data loss on web (an admin editing someone's areas saved a list with their lead standing stripped, because the `"Meals · Lead"` holder's Meals chip rendered unlit). Port the helpers, not the string compares.

---

#### 2. Message shape for Swift

Both tables are identical apart from the scope column and `area`. Codable structs (snake_case keys → use `.convertFromSnakeCase` or explicit `CodingKeys`):

```swift
struct ChatMessageRow: Codable, Identifiable {
    let id: UUID
    let author_id: UUID
    let text: String?            // nil for a media-only message
    let reply_to_id: UUID?       // nil unless it quotes another message
    let created_at: Date
    let edited_at: Date?         // non-nil ⇒ render " · edited"
    let deleted_at: Date?        // non-nil ⇒ TOMBSTONE, render nothing else
    let status: String?          // "visible" | "pending" | "hidden" (0128); see §9
    // committee only:
    let area: String?            // nil = the committee-wide channel
}

struct ChatMediaRow: Codable {
    let message_id: UUID
    let storage_path: String     // a FULL URL, not a path — see §7
    let media_type: String       // image | video | sticker | gif | file  (CHECK constraint)
    let width: Int?
    let height: Int?
    let file_name: String?       // 0074, only meaningful for media_type == "file"
    let thumbnail_url: String?   // 0173 — EXISTS but web never writes it. See §7.
    let position: Int            // display order within the message
}

struct ChatReactionRow: Codable { let message_id: UUID; let user_id: UUID; let emoji: String }
struct ChatMentionRow: Codable { let message_id: UUID; let mentioned_user_id: UUID }
```

Every optional above is genuinely nullable in Postgres — `text`, `reply_to_id`, `edited_at`, `deleted_at`, `width`, `height`, `file_name`, `thumbnail_url`, and `area`. A non-optional Swift property on any of them will throw `DecodingError.valueNotFound` on real rows.

⚠️ `status` and `thumbnail_url` were added later (0128, 0173). If you want to keep iOS runnable against a pre-migration DB, make them optional and retry the select without them on a `42703` — that ladder idiom is everywhere in this codebase (web has it for `deleted_at` and `file_name` in `refetchMessages`). Both migrations **are** applied in production, so you may reasonably skip the retry and just make them `Optional`.

**RLS read rules, one line each (so an empty result is interpretable):**
- `committee_messages` — you may read a row iff `can_access_committee_area(committee_id, area)` **and** (`status = 'visible'` OR you are the author OR you are an admin). Empty ⇒ you are not on that committee/role (or not a lead, for `'Leads'`) — almost never "no messages".
- `committee_message_media` / `_reactions` / `_mentions` — readable iff you can read the parent message's `(committee_id, area)`. Empty ⇒ no access to the parent room. (Note these child policies carry **no** status clause — a held message's attachments are still readable; the message row itself is what disappears.)
- `committee_area_reads` — you can read only your own rows (`user_id = auth.uid()`). Empty ⇒ you have never opened that channel.
- `house_messages` — readable iff `is_house_member(house_id)` (admin OR `profiles.house_id = house_id`) and the same status clause. Empty ⇒ you are not in that house.
- `house_message_media` / `_reactions` / `_mentions` — readable iff you are a member of the parent message's house.
- `house_reads` — own rows only.
- `chat_polls` / `chat_poll_options` — readable iff you can access the poll's room (same gate as the chat).
- `chat_poll_votes` — **no select policy exists at all**; RLS default-denies every row to every role including the voter. Always empty. Reads go through RPCs only.
- `committee_roster`, `profiles`, `houses` — members-only reads, and since **0183** the predicate is **`is_approved_member()`**, not 0081's bare `auth.uid() is not null`; `profiles` additionally keeps an `id = auth.uid()` own-row exception so an unverified member can still load their own profile. Guest *or unverified* ⇒ empty, not an error.
- `committees`, `committee_areas` — public read (labels only). `committee_areas` had RLS on with **zero policies** once and silently deleted the whole subcommittee feature; fixed by 0170.

⚠️ **Verified-member gate (0181/0183).** A brand-new signup with `profiles.approved = false` sees only guest content. Both chat rooms will read as empty for them (chat was already closed to them — 0183 deliberately left the chat policies alone because `can_access_committee_area` / `is_house_member` are already stricter than "is signed in"). Do not render "no messages yet" — render the not-yet-verified state. Same gate governs `GET /media-token`, so they get no photos either.

---

#### 3. Reactions with who-reacted

Table PK is **`(message_id, user_id)`** — **one reaction per person per message**, iMessage tapback style, not a multiset. Switching emoji is an upsert on that conflict, not a second row (both chat tables carry an "update own" policy so the upsert's UPDATE half is allowed). `lib/reactions.ts`:

```ts
if (current === emoji) delete where message_id & user_id      // tapping your own emoji removes it
else upsert({message_id, user_id, emoji}, {onConflict: "message_id,user_id"})
```

⚠️ **Model this as `[UUID: String]` (user → emoji), not `[String: Set<UUID>]`.** Getting it wrong lets one person appear under two emoji, which the DB can never actually produce, and makes the "switch my reaction" tap insert instead of upsert (unique violation).

Web behavior to match:
- Long-press (420ms) a bubble opens the reaction tray: `["👍","❤️","😂","😮","😢","🎉"]` plus ↩︎ Reply, ✏️ Edit (if allowed), 🗑️ Delete (if allowed).
- Reaction pills under the bubble show `emoji count`, sorted most-used first (`reactionCounts`), with **your own** emoji's pill highlighted.
- **Tapping a pill expands an inline list of who reacted with that emoji**, resolved from the room roster, with `"You"` for yourself and `"Member"` as the fallback for an unresolvable id. Tapping again collapses. This is the "who reacted" depth — **verify in the iOS repo** that the reactor list exists and that it falls back to `"Member"` rather than showing a raw UUID.

**Where iOS can beat the web:** the tray is a hand-rolled pointer-gesture popup on web. Native gets `contextMenu` / a real tapback overlay with `UIImpactFeedbackGenerator` on commit, and the who-reacted list belongs in a `.popover`/menu section rather than pushing the message list around (web's inline expansion reflows the timeline, which fights the scroll pin).

---

#### 4. Replies, quotes, and the tombstone rule

- `reply_to_id` is a self-FK with **`on delete set null`** — a hard-deleted original just drops the quote.
- The quoted preview is rendered from the in-memory message map: author name (`"You"` if it's yours) + `replyPreview(m).slice(0, 60)`. Tapping it scrolls to the quoted message.
- `replyPreview` precedence, worth copying verbatim: `deleted_at` → `"message deleted"`; else `text`; else by first media kind → `"Sticker"` / `"GIF"` / `"📄 File"` / `"🎬 Video"` / `"📷 Photo"`; else `"Message"`.
- ⚠️ **A reply that quotes a soft-deleted message must show the tombstone text, not the original text.** The row is still there and still readable, so a naive implementation happily renders the deleted content inside the quote — which defeats the delete. This is exactly why delete is soft: the row must survive so quotes still resolve, and the *rendering* is what enforces the deletion. Verify in the iOS repo.
- ⚠️ **Swipe-right-to-reply threshold on web is 52px with an 80px cap, and the long-press timer is cancelled after 8px of movement.** If iOS uses a swipe gesture, it must not compete with the navigation back-swipe — prefer a shorter drag with a rubber-band cap, or move Reply into the context menu.

---

#### 5. 24h author edit + admin-anytime soft delete

The rule lives in **RLS**, not the UI (0023 for committee, 0065 for house), as a single UPDATE policy:

```sql
using / with check (
  (author_id = auth.uid() and created_at > now() - interval '24 hours')
  or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
)
```

- **Delete is an UPDATE** stamping `deleted_at = now()`. Web: `.update({ deleted_at: … }).eq("id", id)`.
- **Hard `DELETE` is admin-only** — a moderation escape hatch so a client can never hard-delete around the tombstone. ⚠️ Do not implement the author's own delete as a row delete; it will be denied and the message will appear undeletable.
- **Edit** stamps `edited_at` explicitly from the client (`new Date().toISOString()`), and the bubble renders `formatClock(ts) + " · edited"`.
- **Edit changes text + mentions only.** Media is untouched, so the attach button is hidden while editing and `canSend` becomes `text.trim().length > 0 || editing.media.length > 0`.
- Client-side affordance gating on web:
  ```ts
  canEdit   = !m.deletedAt && m.authorId === uid && within24h(m.ts)
  canDelete = !m.deletedAt && ((m.authorId === uid && within24h(m.ts)) || isAdmin)
  ```
- ⚠️⚠️ **`within24h` is computed from the DEVICE clock against a SERVER timestamp.** A phone with a skewed clock (or a user in an unexpected timezone whose `created_at` decoding drops the offset) will show Edit on a 3-day-old message; the UPDATE then matches zero rows and **PostgREST returns success with an empty array**, so the edit silently vanishes. On iOS: **check the affected-row count of the update and surface a real error** ("This message is too old to edit") rather than assuming success. Web does not do this and should.
- ⚠️ **Editing re-fires the mention notification.** The web edit path does `delete from *_message_mentions where message_id = …` then re-inserts the whole set, and the `after insert` trigger (`notif_on_chat_mention` / `notif_on_house_chat_mention`) fires again — so every edit re-pings everyone mentioned. Diff the mention set and only insert the genuinely new ids; that's a strict improvement over web.

---

#### 6. @mention scoping — and a real live bug to route around

**Intent:** you can only tag people who can see the room. Candidates on web come from `committee_roster.linked_user_id` for that committee slug (all areas, not area-filtered), or `profiles where house_id = <house>` for a house. The picker excludes yourself, matches on `name.lowercased().contains(query)`, and caps at 6.

Storage + rendering:
- One row per mention in `committee_message_mentions` / `house_message_mentions`, PK `(message_id, mentioned_user_id)`.
- The text itself just contains the literal `@Display Name`. Rendering builds a regex from the resolved mention names, **longest-name-first** so `"@Ann"` can't shadow `"@Annette"`, and highlights each match. Names are regex-escaped. Copy that ordering — it is the difference between correct and comically wrong highlighting.
- Removing `"@Name"` from the draft text drops that id from the pending mention list (`onComposerChange`).

🛑 ⚠️⚠️ **The committee mention INSERT policy checks the WRONG table, and the web send swallows the failure.** Migration 0024's `"cmention: insert on own message"` requires the mentioned user to be in **`committee_members`** (or be an admin) — but the picker, and committee membership itself, have keyed off **`committee_roster.linked_user_id`** since 0057. So mentioning a roster-linked member who has no `committee_members` row and is not an admin is **RLS-denied at insert**. `CommitteeChat.send()` does `await sb.from("committee_message_mentions").insert(...)` and never inspects the error, so: the message sends, the `@Name` renders as plain text, **and no notification fires** — silently, for a person who is plainly on the committee. `house_message_mentions` is fine (0065 checks `profiles.house_id`, the real house gate).

**What to do on iOS:** always check the mention-insert error and tell the sender ("Couldn't tag Alice"), rather than reproducing the silent drop. **This one genuinely needs a backend fix** — a follow-up migration should recreate that policy against `committee_roster` (member OR admin), mirroring 0065's shape. Flag it to Brian; do not ship an iOS mention picker that appears to work and doesn't.

⚠️ Mention notifications use the shared `chat_mention` kind (0030), default **on** in `notif_types`, and are **in-app only** by design — `chat_mention` is deliberately absent from both mini senders' pushable sets, so the phone push for chat rides the separate `'chat'` push category (see §11), which covers every message including mentions.

---

#### 7. Media in bubbles — and the single clearest place iOS beats the web

`storage_path` holds a **full URL**, not a path: a mac-mini media-server URL (`https://mlr-media.duckdns.org/f/chat/<room>/<ym>/<uuid>.<ext>`) or, for legacy `gif` rows, a Tenor CDN URL. `sticker` rows hold a sticker **id**, not a URL, rendered by an in-app art component (`components/Stickers.tsx` `StickerArt`). ⚠️ `sticker`/`gif` are **render-only legacy kinds** — the web composer no longer offers either (0074's note), so iOS needs to display them for old messages but does not need a sticker/GIF picker.

Rendering per `media_type`: `sticker` → local art; `gif` → image, max 224pt (`max-h-56`); `video` → inline player with controls; `file` → a chip with 📄 + `file_name` + a download affordance; `image` → tappable thumbnail opening a full-screen swipe carousel over **that message's photos only** (`photoUrls(media)` filters to `type == "image"` — deliberately not `!= "video"`, because chat also carries `file`/`gif`/`sticker` kinds and only real photos belong in a photo pager).

🛑 ⚠️⚠️ **iOS must sign every mini media URL or every chat photo will 403.** `MEDIA_AUTH` is currently `report`, **not `on`, specifically because the native app cannot sign yet** — three registered iOS devices across two members would lose every photo. The contract (see `lib/mediaToken.ts` and `media-server/media-auth.js`):
- `GET <MEDIA_URL>/media-token` with `Authorization: Bearer <supabase access_token>` → `{ token, expiresAt }`.
- Append `?t=<token>` (or `&t=`) to every `/f/…` URL. Skip `data:`/`blob:`/Supabase-avatar/`/assets/` URLs and anything already carrying `t=`.
- ⚠️ Match by **HOST**, not by `startsWith(MEDIA_URL)` — the prefix form silently un-signed every photo in the app for hours when the configured base URL and the stored URLs' host diverged.
- The token is **identical for every member within a 24h window** — that sameness is load-bearing, because a per-request token would bust the image cache on every render. Verify accepts the current *and* previous window, so a link works 24–48h.
- Fetch it with **no caching** (`URLRequest.cachePolicy = .reloadIgnoringLocalCacheData`). The web outage was a **304**: `res.ok` is false for 304, so the client concluded "no token", rendered every URL unsigned, and the whole app's photos 403'd (104 consecutive unsigned requests observed on one album). Treat 304 as "keep what you have", never as failure.
- **Refetch on every app open**, cached or not. A cached token is only a guess about what the server will accept; if the signing key rotates, a client keeps confidently signing with a dead key for up to 24h with **no self-healing**.
- ⚠️ Promote `MEDIA_AUTH` to `on` **only after** iOS ships this, verified through `report` mode's WOULD-BLOCK log.

⚠️⚠️ **`thumbnail_url` exists on `committee_message_media` and `house_message_media` (migration 0173) and the web app neither writes nor reads it.** `/upload` already returns `thumbnailUrl` — a ~400px sharp resize for photos (`THUMB_DIM = 400`), an ffmpeg frame grab seeked ~10% in for videos (capped at 3s, size-checked, never frame 0, because real phone video opens on a black frame). Web threads it through for `post_media`, `post_comment_media`, `work_item_media` and drop boxes, but the chat components pass only `{ url, type, name }`.

⚠️ **Correct the old framing while you're here: a chat bubble is NOT loading the full-resolution original.** Since `media-server/display.js`, `/upload` builds a browser-facing **display copy** inline for every photo, and *that* is what `storage_path` points at — a browser-safe JPEG with its long edge capped at `PHOTO_DISPLAY_MAX_EDGE` (3200) at quality 90, landing around **1–2.5 MB** — while the untouched upload is kept beside it as `<uuid>_orig.<ext>` (what `?dl=1` and album zips hand back). So the bubble is pulling 1–2.5 MB where a 400px preview would do. The win is still large (roughly an order of magnitude per tile) and still zero-backend-change; it just isn't "thumbnail vs full-res original":
1. On send, write `thumbnail_url: res.thumbnailUrl` into the media insert.
2. On render, load `thumbnail_url ?? storage_path` in the bubble and only fetch the display copy when the user taps into the viewer.
3. ⚠️ **Every existing chat media row has `thumbnail_url = null`** — the same "an enrichment that only runs at upload time covers none of the content already there" lesson that bit `captured_at` (0174/0175) and the thumbnail sweep. The thumbnail *files* exist on disk for every upload (they're generated inline); it's the DB column that was never written. `media-server/thumbnail-backfill.js` already generates/records missing previews across the **four** tables whose UI reads the column (`drop_box_media`, `post_media`, `post_comment_media`, `work_item_media`); **the two chat tables need adding to that `TABLES` list** (mini-side change → PR, merge, pull on the mini, `launchctl kickstart -k`). Until then, coalesce to the display copy so nothing breaks.
4. ⚠️ A video tile needs a ▶ badge once it shows a poster frame — otherwise it's indistinguishable from a photo (the Drop Box grid learned this).

**More native wins here, all real:**
- **`PHPickerViewController`** multi-select instead of a single unfiltered `<input type=file>`. Web's chat picker is deliberately one plain always-mounted button because a popup-nested file input silently delivered nothing in the installed iOS PWA (see §13) — that constraint simply does not exist natively. ⚠️ **Hand over HEIC/Live Photo stills untouched** — the mini opens HEIC with sharp/libvips, converts it to a display JPEG, and reads its EXIF; converting client-side is exactly the mistake §8 documents.
- **Background `URLSession` upload** — send a 200MB lake video and leave the app. Web cannot; its whole partial-failure protocol (§8) exists because uploads die when the tab does.
- **`AVPlayer`** with PiP + AirPlay for chat videos; the mini already transcodes to ≤1080p H.264 in the background.
- **Quick Look (`QLPreviewController`)** for `file` bubbles — preview the PDF in place instead of "download and hope".
- **Share extension** — send photos into a room straight from Photos/Files.

---

#### 8. Optimistic send, and the partial-upload-failure protocol

Web's send is optimistic and the failure semantics are hard-won. Sequence:
1. Snapshot the draft (`text`, `pending[]`, `mentionIds`, `replyTo`).
2. Insert a `temp-<timestamp>` bubble immediately with local file previews as its media; clear the composer; force `atBottom = true` so the list follows.
3. Upload each attachment **independently** in a loop, collecting `failed[]` and `stillPending[]`.
4. ⚠️⚠️ **If any upload failed: roll back the temp bubble, restore text/mentions/replyTo, and put back ONLY the failed attachments.** Restoring the whole draft re-uploaded the files that had already landed (orphaning the first copies on disk) and never told the sender which attachment was the problem. Message: `"Didn't send · " + describeFailedUploads(failed)`.
5. Otherwise insert the message row → get its `id` → insert media rows (with `position: i`) → insert mention rows → refetch, which replaces the temp bubble with the real one.
6. On a thrown error anywhere: drop the temp bubble, restore the *entire* draft, show `"Couldn't send — …"`.

Insert payloads (exact column names):
```
committee_messages: { committee_id, author_id, text: text|null, reply_to_id: id|null, area: area|null }
house_messages:     { house_id,     author_id, text: text|null, reply_to_id: id|null }
*_message_media:    { message_id, storage_path, media_type, width, height, file_name, thumbnail_url, position }
*_message_mentions: { message_id, mentioned_user_id }
```
`author_id` must equal `auth.uid()` — the insert policy requires it, so never let a preview/impersonation id reach it. (For the media/mention child tables the insert policy checks the *parent message's* `author_id`, so the same rule applies transitively.)

⚠️⚠️ **Upload the file EXACTLY as the camera produced it — do not compress, downscale, or re-encode client-side.** `prepareImageForUpload` in `lib/media.ts` is now a deliberate **no-op** (`return file;`), and `compressImage` no longer exists anywhere in the codebase. Its doc comment records why the old version was the bug: it downscaled to 1920px and re-encoded at JPEG q0.82 through a `<canvas>`, which **destroyed the full-resolution original before it ever left the phone** and **stripped every byte of EXIF** — the root cause of the whole `captured_at` saga (migrations 0174–0176 exist almost entirely to recover a date that pass destroyed). The mini now builds the display copy (`display.js`) and reads EXIF server-side from the original, so the client's only job is to hand over the bytes; HEIC included. Videos and files upload as-is too. ⚠️ Accepted trade-off: uploads are a few MB per photo instead of ~1 MB, so a large batch over cellular takes longer — which is precisely why the durable outbox below is worth more on iOS than it was on web. Upload target: `POST <MEDIA_URL>/upload?category=chat&room=<slug>` with the bearer token. ⚠️ Use the **room slug** as `room` — chat files land under `chat/<slug>/<ym>/`.

⚠️ **Moderation is asynchronous for chat.** `/upload` responds immediately and the mini grades the media in the background, so a flagged verdict lands in `media_moderation` *after* the message is already posted and retroactively holds it (0128 §5b). Do not block the send on a verdict, and do expect a message to disappear for others a few seconds later — see §9.

⚠️ Web sends on ⌘/Ctrl+Enter and inserts a newline on plain Enter, deliberately ("too easy to send by accident"). On iOS, decide once and be consistent with the rest of the app; a hardware-keyboard ⌘↩ shortcut is a nice touch.

**Where iOS can beat the web:** a real durable outbox. Persist the pending message + its file URLs to disk, upload via a background `URLSession`, retry on reachability, and show a per-bubble "sending / failed / tap to retry" state. Web's rollback is the best it can do inside a tab that may be killed mid-upload; iOS can make a failed send genuinely recoverable.

---

#### 9. Moderation status handling — new since iOS chat, and currently half-built even on web

`committee_messages.status` / `house_messages.status` ∈ `visible | pending | hidden` (0128, default `'visible'`). The read policy returns a non-`visible` row **only to its author and to admins**, so a held message silently vanishes from the room for everyone else on the next refetch.

Three paths hold a message:
1. **Text blocklist** — `moderate_content_text()` BEFORE INSERT/UPDATE trigger (2000-char cap for chat). ⚠️ It matches single-word blocklist terms as **whole words** (restored by 0160 after 0128 regressed it into substring matching and started auto-holding ordinary words like "bass"/"class"/"hello" at a fishing resort); multi-word phrases still match by substring.
2. **Flagged media at attach time** — `hold_chat_message_on_flagged_media()` AFTER INSERT on the media tables.
3. **Retroactive async verdict** — `hold_content_on_media_verdict` fires on the `media_moderation` write and holds any still-visible message whose media matches the flagged URL. **This is chat's main path**, because chat moderation is never inline.

⚠️ Members cannot change status by editing: `moderate_content_text()` pins `NEW.status := OLD.status` for non-admins unless the transaction-local GUC `mlr.mod_bypass = '1'` is set (which only the automated hold triggers do). Do not try to write `status` from the client.

⚠️ **Web currently never selects `status`** (`refetchMessages` selects `id, author_id, text, reply_to_id, created_at, edited_at, deleted_at` and nothing more), **so the author of a held message has no idea.** Their bubble looks fine to them and is invisible to everyone else. **iOS should select `status` and badge a non-visible message "⏳ Held for review"** — a strict improvement, no backend change, and it turns a mystifying "nobody replied" into an explanation. Verify in the iOS repo whether chat even reads `status` yet.

Admin side (already wired for chat): `moderation_queue()` returns held chat messages (folding the room name into `body`, `report_count` always 0), and `set_content_status(p_entity_type, p_entity_id, p_status)` accepts `'committee_message'` / `'house_message'` with `p_status ∈ ('visible','hidden')`.

🛑 ⚠️⚠️ **Member "Report this message" does NOT work for chat — the RPC rejects it.** `report_content(p_entity_type, p_entity_id, p_reason)` (0040) raises `'Unknown content type.'` for anything other than `'post'` or `'comment'`, and `apply_content_report()` (recreated in 0128) only has `post`/`comment` branches, so the ≥2-reports auto-hold would not fire either. `docs/IOS_PARITY.md` says "add Report to the chat bubble menu (`report_content`)" — **that instruction is wrong as written**; the web chat has no Report button precisely because of this. Shipping a Report button on iOS **requires a migration** widening both functions to `'committee_message'` / `'house_message'` — ⚠️ **and the `content_reports.entity_type` CHECK constraint as well** (`check (entity_type in ('post','comment'))`, 0040), or the insert still fails with a `check_violation` even after both functions accept the new types. Get that SQL from Brian first (DB changes are handed over as SQL, never applied via MCP).

---

#### 10. Unread state and mark-read

**Marking read** — call these at the end of a successful message load, i.e. every time the room's list refreshes while open:
- `mark_area_read(cid, p_area)` — ⚠️ **the first parameter is named `cid`, not `p_cid`.** Supabase keys RPC arguments **by name**; `{"p_cid": …}` fails at runtime with PGRST202 and looks like a missing function. Pass `p_area` as the real area string or `nil` for the committee-wide channel (the function coalesces to `''`).
- `mark_house_read(hid)` — ⚠️ likewise `hid`, not `p_hid`.
- ⚠️ **Never stamp a read row while impersonating.** Web guards with `if (previewMode === "off")` — an admin previewing as a member must not stamp the admin's own read row with whatever the previewed member opened. If iOS has a "view as" mode, mirror this.

**Computing the badge** (per room, in the conversation list):
```
last message  = *_messages, that room's filter, .is("deleted_at", null),
                order created_at desc, limit 1,
                embed profiles!author_id(display_name) + *_message_media(media_type)
read row      = committee_area_reads / house_reads for (room, me)
unread count  = same room filter, .neq("author_id", me), .is("deleted_at", null),
                and if read.last_read_at exists: .gt("created_at", read.last_read_at)
```
Preview text is `"<Author>: <text>"`, falling back to the first attachment's kind for a media-only message — web's `mediaPreviewLabel` is exactly three cases: `"Sticker"` / `"🎬 Video"` / `"📷 Photo"` (a `gif` or `file` therefore reads as "📷 Photo"; a nicer mapping is free on iOS).

⚠️ **Name the FK on the author embed** — `profiles!author_id(display_name)`. A bare `profiles(display_name)` embed silently returns `[]` with HTTP 300 / PGRST201 whenever two FKs link the tables. This has bitten this project before (tournaments ↔ tournament_entrants).

⚠️ Recompute summaries **when returning to the room list**, not only on message INSERT — otherwise a room you just read keeps its badge lit until someone else posts. Web added an explicit effect for this.

**Also at the foot of the conversation list: 🔎 "Search all conversations…"** (`components/ConversationSearch.tsx`, `lib/search.ts`, migrations 0129 → 0130 → 0131) — **verify in the iOS repo; it is almost certainly missing.** One box searches everything the viewer can see: the resort **Family Feed** (posts + comments), their **committee/area chats**, and their **house chat**, and each result taps through to the source message reusing the very deep-link forms in §15 (`?c=&area=&m=`, `?house=&m=`, `?post=`), so the room scrolls to + flashes it exactly like an Activity tap.
- ⚠️ It is **not** a plain Supabase query. The client `POST`s to the mini's `/search`, which embeds the query on-device (a Swift/Vapor `NLContextualEmbedding` service) and calls `search_conversations(query_embedding, query_text, match_count)` — a SECURITY DEFINER RPC executed **as the caller**, so it re-applies `can_access_committee_area` / `is_house_member` plus the members-only / `status='visible'` / not-`deleted_at` gates. Each person searches exactly their own slice, with no per-user index.
- Ranking is **keyword-first**: a strict Postgres full-text match (`to_tsvector @@ websearch_to_tsquery`), ordered by `ts_rank` then embedding similarity as a tie-break. No keyword match ⇒ zero rows ⇒ show "No matching messages", not fuzzy filler.
- Because it depends on the mini + the embed service being up, iOS should degrade to a clean "Search is unavailable" (web does) rather than an error dialog. No backend change needed.

---

#### 11. Mute, with durations (0155) — almost certainly missing on iOS

Two columns per read row: `muted boolean` (permanent) and `muted_until timestamptz` (timed). `house_reads` got **both** in 0155 — house chat had no mute at all before that.

```
effectivelyMuted = muted || (muted_until != nil && muted_until! > now)
```
⚠️ **Never test `muted` alone.** A timed mute expires by simply going stale — there is no cron, nothing clears it — so a client that ignores `muted_until` will show an un-muted bell on a room that the push senders are still skipping (or vice-versa once it lapses).

RPCs (real names, in order):
- `set_area_mute(cid, p_area, p_muted, p_muted_until)` — again `cid`, not `p_cid`. `p_muted_until = nil` with `p_muted = true` means permanent; `p_muted = false` always clears `muted_until` too (the SQL writes `case when p_muted then p_muted_until else null end`), so "unmute" fully resets the row.
- `set_house_mute(hid, p_muted, p_muted_until)`.

Web UX: tapping the bell on a muted room **unmutes in one tap**; tapping an unmuted room opens a duration sheet — `1 day / 3 days / 7 days / Until I turn it back on` (24 / 72 / 168 / nil hours). The row shows 🔕 next to the title with an accessibility label of "Muted until <when>", and a muted room's unread badge renders grey instead of accent.

⚠️⚠️ **Mute is enforced only in the mac-mini senders, not in RLS.** `apns-sender.js`'s `handleMessage` / `handleHouseMessage` query `committee_area_reads` / `house_reads` with `.or("muted.eq.true,muted_until.gt.<now>")` and skip those user ids. So a purely local iOS "mute" that never calls the RPC will keep buzzing the phone. Conversely, muting via the RPC correctly silences APNs with no client involvement.

**Chat push, for context (`type: "chat"`):** every new committee/house message pushes to everyone in the channel except the author and the muted, gated on `'chat'` being in `profiles.push_types`. `'chat'` is the **firehose** category — it covers mentions and replies too. Committee push title is `"<emoji> <Committee> — <area or 'General'>"`; recipients for `area = 'Leads'` are resolved as every lead (committee-level `is_lead` OR `' · Lead'` role) with a graceful pre-0177 fallback.

**Where iOS can beat the web:** actionable notifications. `UNTextInputNotificationAction` for inline reply (insert straight into `*_messages` from the notification), plus "Mute 1 hour" and "Mark read" actions calling the same RPCs. And **communication notifications** (`INSendMessageIntent` donation + a communication notification) so a chat push shows the sender's avatar and can be routed by the user's Focus settings — that is Messages-grade and a browser cannot do it at all.

---

#### 12. Typing indicators (0155-era, ephemeral — no table, no RPC)

`lib/hooks.ts` `useTypingChannel(roomKey, uid, myName)`:
- Realtime **broadcast** channel named `typing:<roomKey>` with `{ config: { broadcast: { self: false } } }`. Room keys: `committee:<slug>:<area ?? "">` and `house:<slug>`.
- `notifyTyping()` is **throttled to one broadcast per 2.5s** and only fires when the draft is non-empty.
- Each received `{ uid, name }` inserts the typer and arms a **4.5s** self-clearing timer; a repeat broadcast resets it.
- Renders as a small "X is typing…" line **above the composer**.

⚠️⚠️ **This must be its own channel and must never touch the message subscription.** Broadcast traffic on the same channel as the `postgres_changes` listener means every keystroke ping wakes the message refetch path. Web separates them deliberately; the comment in `CommitteeChat` says so explicitly.

⚠️ Tear the channel down on room close and clear the timers, or a stale typer sticks forever.

---

#### 13. Inline chat polls (0149) — entirely missing on iOS

A poll is a room-scoped card **interleaved into the message timeline by `created_at`**, not a pinned bar and not attached to any sender's bubble. The first cut *was* a pinned bar at the top of the room and it was scrapped as "too easy to miss".

```swift
enum TimelineItem { case message(ChatMessage), poll(ChatPoll) }   // merged, sorted by ts, then grouped by day
```

**Anonymity is enforced in SQL, not trusted to the client.** `chat_poll_votes` has **no select grant at all** — deny-all RLS, the same doctrine as `content_embeddings`. Live tallies come from denormalized `chat_poll_options.vote_count` and `chat_polls.respondent_count`, kept current by an insert/delete trigger, and those two tables *are* readable + realtime-able (`chat_poll_votes` is deliberately **not** in the publication). Do not attempt to read votes.

RPCs, real parameter names in order:
- `fetch_chat_polls_for_room(p_scope, p_committee_id, p_area, p_house_id)` → **a single `jsonb` array**, not a rowset. `p_scope` is `"committee"` or `"house"`; pass `nil` for the fields of the other scope. Each element carries `id, question, allow_multiple, anonymous, allow_other, created_by, created_by_me, created_at, closes_on, is_closed, respondent_count, options[{id,label,position,is_other,vote_count}], my_option_ids[], my_other_text`. `my_option_ids` and `my_other_text` are safe — they are the caller's own vote. In Swift, decode the RPC response as `[ChatPollRow]` from the returned JSON value.
- `create_chat_poll(p_scope, p_committee_id, p_area, p_house_id, p_question, p_options, p_allow_multiple, p_anonymous, p_allow_other, p_closes_on)` → new poll `uuid`. Any room member may create (the family-polls doctrine, **not** the meeting-organizer gate). Server-side rules: question required, ≤300 chars; blanks dropped from `p_options`, then **2–10** must remain; an `"Other"` write-in option is appended automatically when `p_allow_other` and is **not** counted against the 10; raises `'This chat is archived'` in an archived room. Fires the `chat_poll_created` notification (default **on** in `notif_types`, opt-in for push).
- `set_chat_poll_votes(p_poll, p_option_ids, p_other_text)` — **full replace** of the caller's own votes in one call; handles single vs multi, option-membership, and refuses with `'Say what "Other" means'` when the `is_other` option is picked without text. Also refuses on a closed poll or one past `closes_on`.
- `close_chat_poll(p_poll)` / `delete_chat_poll(p_poll)` — creator or admin.
- `chat_poll_voters(p_poll)` → `jsonb` array of `{option_id, user_id, name, avatar_url, other_text}`. **Returns `[]` unconditionally when the poll is anonymous** — enforced server-side, so the card never has to trust its own anonymity check. Web calls it once per card mount and re-calls when `respondent_count` changes.

Card behavior: tapping an option votes **immediately** (no sheet), with a live %-fill bar behind each row; multi-select toggles; a small avatar row under each option shows who picked it on a non-anonymous poll (an anonymous poll instead shows "N write-in answers (anonymous)" for the Other row); Close/Delete inline for the creator or an admin.

⚠️ **The poll deep-link is currently dead.** `_chat_poll_url` builds `/posts?c=<slug>&area=<area>&poll=<id>` (or `?house=<slug>&poll=<id>`), and **no client anywhere reads `?poll=`** — the notification opens the room but does not scroll to or highlight the poll. iOS can be the first to honor it; it's the same mechanism as `&m=`.

⚠️ **The "never put a file picker inside a popup" incident is why Poll lives in the ⋯ menu, not the composer.** In the installed iOS PWA, a `+` popup menu that `.click()`ed a hidden file input opened the native picker, let you choose a photo, and delivered **nothing, with no error** — three fixes that kept the popup all failed on device. The resolution was to make the picker a plain always-mounted button (a bare `<input type="file" multiple>` sibling, deliberately with **no `accept`** so iOS's own sheet still offers Photo Library / Take Photo / Choose File) and move the *other* actions (Poll) into the menu. (The deprecated standalone `/committees/<slug>/chat` route has no ⋯ menu, so it keeps a 🗳️ button in the composer gated on `!embedded` — don't copy that shape.) A native app has different plumbing, so iOS is free to put attach and poll wherever it likes — **but if photo attachment ever misbehaves, look at what the picker is nested inside first.**

---

#### 14. The meeting response bar (0116–0122)

`MeetingSection` is pinned at the **top of the chat body** (above the message list, below any header) in both rooms, and **renders nothing unless a meeting is live** — "live" meaning status `open`, else an upcoming `scheduled` one whose chosen slot is still in the future.

- Mounted only for a **live (non-archived)** room with a resolved committee id: `<MeetingSection scope={{type:"committee", committeeId, slug, area}} members={members} />`, or `{type:"house", houseId, slug}`.
- It owns its own fetch + realtime over `meetings` / `meeting_slots` / `meeting_availability`, an SWR key of `meetings.<uid>.<roomKey>` where `roomKey` is `c:<slug>|<area>` or `h:<houseId>`, and the `?meeting=<id>` deep-link.
- **Creating** a meeting is not here — it lives in the room's ⋯ menu, gated on `can_organize_meeting(p_scope, p_committee_id, p_area, p_house_id)` (admin, or a Lead of that committee/area; houses are admin-only — the function has no house branch at all). A meeting created from the menu appears in the bar on the next realtime tick, so there is no cross-component wiring to build.
- ⚠️ **"Lead" here does NOT mean 0177's unified lead.** `can_organize_meeting` still has only its original 0116 definition and was never repointed at `is_committee_lead` — it keys **solely** on a `committee_roster.roles[]` entry ending in `' · Lead'` (for `p_area IS NULL` it accepts any such role; otherwise it requires exactly `p_area || ' · Lead'`). Consequences to mirror rather than "fix": a **committee-level lead (`is_lead = true`) with no `' · Lead'` role is not an organizer**, and in the **Leads room** the check reduces to a literal `'Leads · Lead'` role nobody can hold — so "Schedule a meeting" there resolves to admins only, who aren't in that room either. Web behaves identically, so this is parity, not an iOS bug; if the product wants committee-level leads to organize, that's a separate optional migration for Brian (not one of the two 🛑 items).
- The full scheduler is a large feature in its own right; if another section of this spec covers meetings, **build the bar as a thin embed of that work** rather than duplicating it. For a chat-only v1, the bar can be omitted — but then note that a scheduled meeting is invisible from inside the room.

The ⋯ menu also carries **"✉️ Email members"** (open to anyone in the room — everyone here can already see everyone here) and **"🗳️ Create a poll"**. For a committee area the email recipient list is the committee roster filtered to that area; for `area == 'Leads'` it means everyone with a lead role (committee-level `is_lead` OR a `' · Lead'` role, selected with the same `42703` fallback).

---

#### 15. Deep links, push routing, and the PWA constraint iOS is free of

⚠️⚠️ **Web-only constraint, and it shapes the URL format iOS must parse.** On web, opening a room through the standalone route `/committees/<slug>/chat` **fails in the installed PWA** with WebKit's own "This page couldn't load" — the navigation dies in the app container *before React runs*, so nothing in-app can catch or report it. The **only** supported path is the Feed-embedded one: `/posts?c=<slug>[&area=<area>][&m=<messageId>]`, or `/posts?house=<slug>[&m=<id>]`. The difference is structural: the Feed renders the chat `embedded` as a plain inline column, while the route renders it inside a `fixed inset-0` full-screen shell with a visualViewport handler. Every server-side check comes back healthy (HTML 200, RSC 200, clean console, in-scope manifest) so this is invisible outside a real installed PWA — three fixes failed before the cause was found.

**Why this matters for iOS even though iOS has no such constraint:** every notification row's `url` column is already written in the Feed form, and **must stay that way** for web. So:
- `chat_mention` → `/posts?c=<slug>&m=<messageId>&area=<area>` (note the order: `&m=` comes **before** `&area=`).
- house `chat_mention` → `/posts?house=<slug>&m=<messageId>`.
- plain chat push (built by the mini) → `/posts?c=<slug>&area=<encoded area>&m=<id>`.
- `chat_poll_created` → `/posts?c=<slug>&area=<area>&poll=<id>`.

iOS should treat that URL as a **routing instruction to parse**, mapping `c`/`area`/`house`/`m`/`poll` onto native navigation — not expect a custom scheme, and not "fix" the format (it would break web).

⚠️⚠️ **The SQL-built URLs do NOT URL-encode the area, and four of the five real area names contain `&`.** `notif_on_chat_mention` (0063) does `'&area=' || v_area` and `_chat_poll_url` (0149) does `coalesce('&area=' || p.area, '')` — raw concatenation. The live areas are `Meals`, `Entertainment & Games`, `Art & Decorating`, `Merchandise, Fundraising & Polling`, `Logistics, Scheduling & Finance`. So a mention in Art & Decorating produces `…&m=<id>&area=Art & Decorating`, which any correct query parser splits into `area = "Art "` plus a bogus `Decorating` param — the channel key never matches and the deep link dumps you on the room list. The mini's push senders **do** `encodeURIComponent(msg.area)`, so the same event routes correctly via a plain chat push and incorrectly via the mention notification row. **iOS must parse defensively**: prefer the notification's `entity_type`/`entity_id` (`committee_message` + message id) and resolve the room from the message row, or take everything after the first `&area=` as the literal area. Also worth a migration to encode it properly — flag to Brian.

**Landing behavior once in the room** (`useDeepLinkFlash`): poll for the target message's view for up to ~3s (20 attempts at 150ms — the cold-open snapshot only holds the last 30 messages, so an older target may not exist until the full load lands), then scroll it to center and flash a ring for 2.2s. The **first** deep-link of a mount snaps without animation; a **second** one arriving while already in the room scrolls smoothly, because that motion is the useful cue that the view moved. Re-arm on a new target rather than firing once.

---

#### 16. Scroll, grouping, and load behavior (the small stuff that makes it feel right)

- **Day separators**: `groupByDay(items, ts)` + `formatDayHeading` ("Today" / "Yesterday" / "Saturday, July 27, 2026"). ⚠️ Never hand a bare `YYYY-MM-DD` to a date constructor — it parses as UTC midnight and renders as the **previous day** in Central. That bug labeled every fest sign-up slot a day early *and* corrupted the data written through the same picker; `lib/format.ts`'s `toLocalDate` is the fix every formatter now routes through.
- **Sender grouping**: consecutive messages from the same author within **5 minutes** collapse (avatar and name only on the first).
- **Smart auto-scroll**: jump to bottom on first load; smooth-follow a new message **only if already at bottom** (within 80px); otherwise show a tappable **"↓ New messages"** pill. Your own send always pins to bottom. ⚠️ Skip the initial jump-to-bottom when a `&m=` deep-link is pending, or the room visibly jumps down then scrolls back up.
- **New-messages-only entrance animation**: the initial batch mounts without animating (no open-cascade); later arrivals spring in (`type: "spring", stiffness: 500, damping: 40`). Keyed by stable message id so a refetch never re-animates the whole list. Web additionally paints a hold-then-fade cover over the room on open (`chat-unmask`) purely because `FeedView` remounts the chat on every tab navigation — a native push transition makes that unnecessary.
- **Keyboard**: re-pin to bottom when the keyboard opens/closes and whenever the composer grows (reply banner, attachment row). On web this is a `visualViewport` dance; on iOS it is `.scrollDismissesKeyboard` / safe-area handling and should be far less fragile.
- **Load + cache**: web keeps a memory SWR snapshot per `slug|area|viewer` plus a persisted **tail of the last 30 messages** (`CHAT_SNAPSHOT_MSGS = 30`; keys `chatRoom.<uid>.<slug>|<area>`, `houseChatRoom.<uid>.<slug>`) so a cold open paints the last conversation instead of a spinner. ⚠️⚠️ **The cache key must include the real signed-in identity, not a shared `"self"`.** A shared key leaked one member's cached private chat messages to the next person on the same device, because `signOut()` does not reload the page (fixed in PR #244). On iOS: scope any on-disk chat cache to the user id and **wipe it on sign-out**. Web also skips persisting entirely while an admin is previewing-as.
- Access is re-derived on every open and **may downgrade** a cached "member" to none, so revoked access never sticks.

⚠️⚠️ **Do not copy web's refetch strategy.** Every realtime event on `*_messages`, `*_message_media`, `*_message_reactions`, `*_message_mentions` triggers a **full re-read of the entire room** (all messages + all media + all reactions + all mentions + the whole `profiles` table + the committee roster), debounced 120ms. Worse, the child-table subscriptions carry **no filter** — PostgREST can't filter `committee_message_media` by committee — so *every other room's* reaction wakes *your* room's full refetch. It works at family scale and it is the single biggest thing iOS can beat: keep messages in SwiftData/SQLite and fetch deltas with `created_at > <last seen>` (plus a periodic reconcile for edits/deletes/status changes, which are UPDATEs and won't show up in a created_at delta). That's what makes chat open instantly and survive lake wifi.

---

#### 17. Honest sizing and a v1 cut

This is not a rewrite; it is roughly a dozen additive passes over two existing screens plus the conversation list. Rough shape:

- **Blocking / do first (small):** media token signing (§7) — without it every chat photo 403s the moment `MEDIA_AUTH` is promoted; the `area IS NULL` vs `''` sentinel audit (§1, §10); the mention-insert error surfacing (§6); and confirm iOS is **not** re-encoding photos before upload (§8).
- **v1 (ship together):** Leads channel + archived read-only rooms + the committee lock card / request-to-join states (§1) + mute durations + `status` handling + `thumbnail_url` in bubbles + typing indicators + smart scroll/jump pill + who-reacted audit + tombstone-in-quote audit.
- **v1.1:** inline chat polls (medium-large: a card with vote/multi/other/anonymous/avatars, plus the `?poll=` deep-link), conversation search (§10 — thin: one mini endpoint + result routing you already have), optimistic-send hardening into a durable outbox, delta sync + local cache.
- **Defer:** the meeting response bar (embed whatever the meetings section builds), Report-a-message (blocked on a migration), and any `file`-bubble Quick Look polish.

**Two things need Brian before they can ship:** the `report_content` / `apply_content_report` widening for chat entity types **plus the `content_reports.entity_type` CHECK constraint**, and the `committee_message_mentions` insert policy pointed at `committee_roster` instead of `committee_members`. Hand him the SQL; do not apply prod migrations from the app or via MCP.

⚠️ One provenance note for whoever writes that SQL: this repo's rule is **recreate a function from its CURRENT production definition, never an older migration's copy** (the 0160 incident). For the objects in this section that means `can_access_committee_area` → **0177**, `moderate_content_text` → **0160**, `request_to_join` → **0090**, `moderation_queue` / `set_content_status` → **0128**, and the members-only read policies → **0183**.
