<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **11 correction(s)** were applied.

### Activity feed, notification preferences, and push

**Nothing in this section needs a backend change to port** — one exception, called out in §11: iOS admins get no cabin-request push because `media-server/apns-sender.js` never got a `handleCabinRequest`. That is a ~40-line mini change, not Swift. Everything else is Swift written against tables, RLS and RPCs that already exist and that the web app is using in production today.

Read this section as two independent systems that happen to share a string vocabulary:

| | **Activity feed** (durable) | **Push** (transport) |
|---|---|---|
| Storage | `public.notifications`, one row per recipient | nothing — fire and forget |
| Written by | `SECURITY DEFINER` triggers/RPCs in Postgres | the Mac mini reacting to those rows |
| Gate | `profiles.notif_types` | `profiles.push_types` |
| Survives the mini being down? | **yes** | no, silently |
| Includes the chat firehose? | **no** — only chat `@mentions` | yes (`chat` category) |

⚠️ **These are not layers of one feature, they are two features with an ordering dependency.** For every *feed-backed* kind the mini's only trigger is a `notifications` INSERT — so if `notif_types` suppresses the row, **there is no push either**, no matter what `push_types` says. A member with `push_types = ['new_post']` and `notif_types` missing `new_post` gets absolutely nothing and every settings screen looks correct. Surface that dependency in the iOS UI (or at minimum, never let the push row read "on" while the matching Activity row reads "off"), because on web it produces a steady stream of "push is on but I get nothing" reports that look like an APNs problem and are not.

---

#### 1. `public.notifications` — the feed table (migration 0030)

```
id           uuid   pk default gen_random_uuid()
recipient_id uuid   not null → profiles(id) on delete cascade
type         text   not null      -- see the kind table in §4
actor_id     uuid   null → profiles(id) on delete set null
title        text   not null      -- DENORMALIZED at write time, already user-facing
body         text   null          -- snippet/preview, usually left(…, 140)
url          text   null          -- app-relative deep link, e.g. "/posts?post=…&comment=…"
entity_type  text   null          -- 19 real values, see below
entity_id    uuid   null
created_at   timestamptz not null default now()
seen_at      timestamptz null
read_at      timestamptz null
expires_at   timestamptz null
```

⚠️ **`entity_type` has NINETEEN live values, not the four 0030's comment lists.** This is what the mini forwards as `target_type`, so a Swift switch built off a short list silently falls through. Read off every trigger/RPC in the tree:

`post` · `committee_message` · `house_message` · `committee` · `committee_join_request` · `cabin_booking` · `cabin` · `event` · `help_request` · `work_item` · `house_stay` · `meeting` · `chat_poll` · `tournament` · `private_activity` · `schedule` · `activity` · `profile` · `broadcast` · `admin_test`

(`event`, from `event_rsvp`, is written with `entity_id` **NULL** — more evidence for treating `target_*` as a hint, never the route.)

**RLS read rule, one sentence:** you see a `notifications` row **only** when `recipient_id = auth.uid()` — so an empty feed means "nothing has happened involving you", never "you lack permission to see it". There is no admin override and no cross-member read; an admin cannot inspect someone else's feed from the client at all.

Two more policy facts that matter for Swift:

- **There is no INSERT policy and no UPDATE policy.** A client `insert`/`update` on `notifications` fails, always. Every write goes through the RPCs in §3 or a `SECURITY DEFINER` trigger. Do not try to optimistically insert a local row into the table; keep optimism purely in your view model.
- **There *is* a DELETE policy** (`recipient_id = auth.uid()`). Nothing on web uses it — see §12, this is free native polish.
- ⚠️ `notifications` is **not** affected by the verified-member lockdown (0181/0183). Only migration 0030 has ever declared a policy on this table (verified by grep across every migration), so an approved-gate newcomer still reads their own rows normally. Don't add an `approved` check client-side.

**`title` and `body` are already-composed prose**, built in SQL — `'Jane commented on your post'`, `'🚨 Bob needs help now  ·  📍 by the boathouse'`. Render them verbatim. Do **not** try to re-derive copy from `type` + `actor_name`: the SQL wording carries emoji, location suffixes, group rosters ("In this slot: Alice, Bob."), and lead-time phrasing that you will not reproduce, and it will drift the moment a migration changes a trigger.

**Codable shape.** Every column except `id`, `recipient_id`, `type`, `title`, `created_at` is nullable, and `type` is an open string set from the client's point of view (§4 note on `new_member`):

```swift
struct AppNotification: Codable, Identifiable, Hashable {
    let id: UUID
    let type: String            // ⚠️ String, NOT an enum — see §4
    let actorId: UUID?
    let title: String
    let body: String?
    let url: String?
    let entityType: String?
    let entityId: UUID?
    let createdAt: Date
    var seenAt: Date?
    var readAt: Date?
    let expiresAt: Date?
    let actor: Actor?           // joined, see below
    struct Actor: Codable, Hashable {
        let displayName: String?
        let avatarUrl: String?
    }
    var isUnread: Bool { readAt == nil }
    var isExpired: Bool { (expiresAt ?? .distantFuture) <= Date() }
}
```

⚠️⚠️ **The actor join MUST name the foreign key.** `notifications` has **two** FKs to `profiles` (`recipient_id` and `actor_id`), so a bare `.select("*, profiles(display_name, avatar_url)")` is ambiguous and PostgREST answers **HTTP 300 / `PGRST201`** with **zero rows and no thrown error in most client wrappers** — a permanently empty Activity tab that looks like an RLS problem. Web's working select string is the literal spec:

```
id, type, actor_id, title, body, url, created_at, seen_at, read_at, expires_at,
actor:profiles!actor_id(display_name, avatar_url)
```

`.eq("recipient_id", uid).order("created_at", ascending: false).limit(100)`. Web caps at 100 and has no pagination — a keyset paginator on `created_at` is a straightforward native improvement.

**Realtime:** `notifications` was added to the `supabase_realtime` publication in 0030. Web subscribes `event: "*"`, `filter: "recipient_id=eq.<uid>"` and simply refetches (debounced 300 ms) rather than patching rows. ⚠️ The table does **not** have `replica identity full`, so a DELETE's `old` record carries only the primary key — a `recipient_id=eq.` filter therefore cannot match a DELETE, and delete events will not reach you. If you build swipe-to-dismiss, remove the row locally; do not wait for a realtime echo (verify against your own logs, but plan for it).

---

#### 2. The read model: `seen_at` vs `read_at` vs `expires_at`

Three fields, three distinct jobs. Getting this wrong is the most visible possible bug (a badge that never clears, or clears too early).

- **`seen_at` drives the tab badge, and nothing else.** Opening the Activity screen stamps every unseen row seen. It is a bulk "I have looked at the list" marker.
- **`read_at` drives per-row emphasis** (web: bold title + a tinted row background + an accent dot). Set when the member *taps that specific row*.
- **`expires_at` removes a row from the badge count while leaving it in the list.** Web renders an expired row at 60% opacity with a " · expired" suffix on the timestamp. ⚠️ **Three sources set it, not one** — admin broadcasts (`send_broadcast_notification`'s `p_expires_at`), `signup_reminder` (self-expires an hour after the slot, or three hours after a manual send), and — the one people miss — **every help kind**: `notif_on_help_request`/`notif_on_help_response` pass `help_requests.expires_at` straight through, and `request_help` defaults that column to `greatest(now(), needed_at) + 6 hours`, so it is effectively never null. `help_request`, `help_urgent` and `help_response` rows therefore drop out of the badge routinely and sit in the list dimmed. Expect it; don't treat an expired help row as a bug.

**Badge query — copy it exactly:**

```
notifications
  .select("id", head: true, count: .exact)
  .eq("recipient_id", uid)
  .is("seen_at", value: nil)
  .or("expires_at.is.null,expires_at.gt.\(nowISO8601)")
```

Web renders `"99+"` above 99. Note the `.or(...)` — an unseen-but-expired row must **not** count. Miss that clause and an old broadcast pins a permanent badge.

⚠️ **The badge count is time-dependent, so it must be recomputed, not just invalidated by realtime.** A row with a future `expires_at` silently drops out of the count when that moment passes with no database event to notify you. Recompute on foreground and on a timer, not only on a realtime tick.

---

#### 3. Every RPC, with real parameter names in order

Supabase keys RPC arguments **by name**, so a wrong key is a runtime `PGRST202`, not a compile error. These are read straight from the migrations.

| RPC | Signature (exact) | Notes |
|---|---|---|
| `mark_notifications_seen` | `()` — no args | `update … set seen_at = now() where recipient_id = auth.uid() and seen_at is null`. Call on Activity-screen appear. Idempotent, cheap. |
| `mark_notification_read` | `(p_id uuid)` | Sets `read_at = coalesce(read_at, now())` **and** `seen_at = coalesce(seen_at, now())`. Scoped to `recipient_id = auth.uid()` inside the function — you cannot mark someone else's. |
| `mark_all_notifications_read` | `()` | `read_at = now(), seen_at = now() where read_at is null`. Backs the "Mark all read" pill. |
| `send_broadcast_notification` | `(p_title text, p_body text, p_url text, p_audience text, p_expires_at timestamptz, p_event_id text, p_exclude_not_attending boolean)` | Admin-gated (`raise exception 'Not authorized'`). Returns `integer` = recipients reached. `p_audience ∈ {'everyone','admins'}` — ⚠️ **`'beta'` was removed in 0100**, passing it raises `'Unknown audience'`. `p_event_id` is **text**, not uuid (seed events like `family-fest-2026` are string ids). Inserts `type = 'broadcast'` **directly**, bypassing `notif_types`. |
| `send_test_notification` | `(p_user uuid, p_title text, p_body text)` | Migration 0156. Admin-gated. Returns the new row's `uuid`. Both text params default null → `'🔔 Test notification'` / `'An admin sent this to check your notification settings.'`. Inserts `type = 'admin_test'` directly, bypassing `notif_types`. |
| `set_notification_test_confirmed` | `(p_user uuid, p_value boolean)` | Migration 0157. Admin-gated, returns void. Stamps `profiles.notifications_confirmed` + `_at` + `_by` together. |
| `send_signup_slot_reminder_now` | `(p_kind text, p_item uuid, p_slot_id uuid, p_slot_start text, p_minutes int, p_email boolean)` | **Current signature is 0168's 6-arg form** (0158 shipped a 5-arg version that 0159 dropped). Returns `int`. Gated on `_can_manage_item_signups` / `_can_manage_activity_item_signups`. |
| `_notify` | `(p_recipient, p_type, p_actor, p_title, p_body, p_url, p_entity_type, p_entity_id, p_expires_at)` | ⚠️ **`revoke all … from public, anon, authenticated`** — the fan-out helper is not callable from any client. Listed only so nobody tries. |
| `run_signup_reminders`, `run_scheduled_broadcasts`, `process_help_reminders`, `run_tournament_match_reminders` | `()` | **Four** `pg_cron`-only jobs, all `* * * * *`, all revoked from `authenticated`. Sign-up reminders (0140), scheduled/queued broadcasts + event & callout reminders (0097), the help-request "⏰ helping Brian at 2:00" nudge and short-handed re-broadcast (0039, job `mlr-help-reminders`), and `tournament_match_ready` for a match with a `scheduled_at` + `reminder_minutes` (0148). All four fire with every app closed and the mini asleep — so feed rows appear with no user action and no mini involvement. |

**Preference writes are NOT RPCs.** `notif_types`, `push_types`, `push_self_notify`, `push_prompted`, `notify_new_members` are written with a plain `update` on `profiles` under **column-level grants** (`grant update (notif_types)` in 0029; `grant update (push_types, push_self_notify, birthday, address)` in 0020; `grant update (push_prompted)` in 0034; `grant update (notify_new_members)` in 0026). A single `.update([...]).eq("id", uid)` writing several of these at once is correct and is what web does. Trying to write `is_admin`, `house_id`, `approved`, or `notifications_confirmed` in that same statement fails the **whole** update — keep the settings patch to granted columns only.

---

#### 4. Every notification kind

31 distinct `type` strings exist in the database. The client `NotifType` union in `lib/types.ts` lists 30. **`new_member` is the missing one** — see the warning after the table.

Columns: **Pref row** = has a toggle in `NotifPrefs`; **admin** = that row is only rendered to admins; **Push** = the member-facing push category (`push_types` value); **APNs** = present in `apns-sender.js`'s `PUSHABLE` set.

| `type` | Source (migration) | Recipients | Pref row | Push | APNs |
|---|---|---|---|---|---|
| `post_comment` | `notif_on_post_comment` on `post_comments` (0030, url fixed 0164) | the post's author | ✅ | `post_comment` **on by default** (0163 backfill) | ✅ |
| `post_reply` | same trigger (0030/0164) | every *other* prior commenter, distinct, minus actor & post author | ✅ | `post_reply` on by default | ✅ |
| `post_mention` | `notif_on_post_mention` on `post_comment_mentions` (0030/0164) | the mentioned member | ✅ | `post_mention` on by default | ✅ |
| `post_tag` | `notif_on_post_tag` on `post_tags` (0030) | the tagged member (actor = post author) | ✅ | `post_tag` on by default | ✅ |
| `post_reaction` | `notif_on_post_reaction` on `post_reactions` (0030) | the post's author | ✅ | **none — in-app only, deliberate** | ❌ |
| `new_post` | `notif_on_new_post` on `posts` (0030) | every profile with `new_post` in `notif_types` | ✅ | `new_post` **on by default** (0161) | ✅ |
| `chat_mention` | `notif_on_chat_mention` on `committee_message_mentions` — ⚠️ live body is **0063**'s, not 0030's (new url shape) — plus the house twin `notif_on_house_chat_mention` (0065) | the mentioned member | ✅ | ⚠️ **none** — see §11 | ❌ |
| `committee_join` | `notif_on_join_review` on `committee_join_requests` UPDATE (0030) | the requester | ✅ | `committee_join` (off) | ✅ |
| `committee_join_request` | `notif_on_join_request` INSERT **or** UPDATE→pending (0042, live body **0091**) | every `is_admin` + `committee_members.role = 'Lead'` | ✅ **admin** | `committee_join_request` (off, admin row) | ✅ |
| `cabin_request` | 0033, live body **0114** | admins + the place's non-admin `approver_user_id`; whole trigger short-circuits on `request_notify = false` | ✅ **admin** | ⚠️ **not a `PushType`** — bespoke sender path | ❌ **§11** |
| `cabin_decision` | 0033 | the requester | ✅ | `cabin_decision` on by default | ✅ |
| `cabin_message` | `send_cabin_message` (0120) | approved guests whose `check_out >= today`, minus sender | ✅ | `cabin_message` on by default | ✅ |
| `event_rsvp` | inside `set_event_attendance` (0036 — an RPC, not a trigger; see §12's overload warning) | everyone with the pref (opt-in by design), ⚠️ **only on a member's FIRST transition into `going`** — Maybe/Can't-make and every later edit are silent | ✅ | `event_rsvp` (off) | ✅ |
| `help_request` | `notif_on_help_request` (0037, live body 0100) | `_help_recipients` = willing + present | ✅ | `help_request` on by default | ✅ |
| `help_response` | 0037 | the requester | ✅ | `help_response` on by default | ✅ |
| `help_urgent` | 0046 | **every** member | ✅ **locked** | ⚠️ **override** — no category | ✅ |
| `work_item_comment` | 0068 | item creator + prior commenters | ✅ | **none — in-app only** | ❌ |
| `work_item_mention` | 0068 | the mentioned member | ✅ | **none — in-app only** | ❌ |
| `work_item_created` | 0070 | MLR item → everyone; house item → that house + all admins | ✅ | `work_item_created` (off) | ✅ |
| `house_stay_created` | 0071 | the house's members + all admins | ✅ | `house_stay_created` (off) | ✅ |
| `meeting_proposed` | `create_meeting` (0116) | every member of the room | ✅ | `meeting_proposed` (off) | ✅ |
| `meeting_scheduled` | `finalize_meeting` (0116) | every member of the room | ✅ | `meeting_scheduled` (off) | ✅ |
| `chat_poll_created` | `create_chat_poll` (0149) | the room | ✅ | `chat_poll_created` (off) | ✅ |
| `signup_reminder` | `run_signup_reminders()` cron (0140/0168) + `send_signup_slot_reminder_now` (0158→0168) | `coalesce(user_id, added_by)` per signup row | ✅ | `signup_reminder` **on by default** (0159) | ✅ |
| `tournament_published` | 0144 | entrants with accounts | ✅ | (off) | ✅ |
| `tournament_match_ready` | 0144, plus the `run_tournament_match_reminders()` cron (0148) | the two entrants | ✅ | (off) | ✅ |
| `tournament_champion` | 0144 | entrants | ✅ | (off) | ✅ |
| `private_activity_invite` | `create_private_activity` (0150), only when the organizer ticks notify | the invited roster | ✅ | (off) | ✅ |
| `broadcast` | `send_broadcast_notification` / `run_scheduled_broadcasts` | audience `everyone`\|`admins`, minus `not_going` | ❌ **deliberate** | ⚠️ **override onto `alerts`** | ✅ |
| `admin_test` | `send_test_notification` (0156) | exactly one member | ❌ **deliberate** | ⚠️ **override** | ✅ |
| `new_member` | `notif_on_new_member`, INSERT + UPDATE OF `joined_at` (0062, live body **0085**) | `is_admin AND coalesce(notify_new_members, true)`, minus the joiner — and the whole trigger early-returns for the App Review account (`contact_email = appreview@…`, 0077) and for `invited_via = 'invite_link'` (0085) | ❌ | separate sender path (§10) | ❌ (no duplicate push — intentional) |

**Admin-gated *in the prefs UI*** is exactly two rows: `committee_join_request` (Committees section) and `cabin_request` (Cabin stays section). Both are `adminOnly: true` in `NotifPrefs.tsx`, and a section whose every row is filtered out renders nothing at all. This is cosmetic honesty, not security — the fan-out predicates already restrict who ever receives these — but mirror it, because a non-admin toggling "New cabin stay requests" and then never receiving one reads as a broken app. (`PushToggle` filters one row the same way — see §6.)

**One `locked` row:** `help_urgent` renders as a static row with a `🔒 Always on` chip and no switch. That is backed in SQL: migration 0047 rewrote `_notify` so `help_urgent` is the one type inserted **regardless** of `notif_types`. The only way to silence it is the OS notification permission — say so in the row's subtitle, as web does.

⚠️⚠️ **Type your `type` field as `String`, never a closed Swift enum.** `new_member` rows are in production and are absent from web's own `NotifType` union — which is why web's `TYPE_EMOJI[n.type]` lookup returns `undefined` for them and the corner badge on an admin's "👋 Someone joined the resort" row renders **blank**. A closed `enum` + `Decodable` in Swift does worse than render a blank glyph: it throws, and one unknown type **fails the decode of the whole page of 100 rows**, blanking the entire Activity tab. Decode `type` as `String`, map it to a glyph through a dictionary with a sensible fallback (web uses per-kind emoji; `🔔` is the obvious default), and treat any unknown type as displayable. Every future migration that adds a kind ships to the database before it ships to the App Store.

---

#### 5. `profiles.notif_types` — the in-app prefs (migration 0029)

`text[] not null`, column default rewritten by **thirteen** migrations as kinds were added (latest: 0150). ⚠️ **There is no CHECK constraint and no allow-list** on this array — a typo'd string in Swift is accepted by Postgres and silently matches nothing forever. Same for `push_types`.

- Gate mechanics: `_notify()` returns early unless `p_type = any(recipient.notif_types)`, and also early-returns when `p_recipient is null` or `p_recipient = p_actor` (**you are never notified of your own action** — do not re-implement that check client-side, and do not be surprised when your own post produces no row).
- Three kinds bypass it entirely by inserting into `notifications` directly rather than calling `_notify`: `broadcast`, `admin_test`, `new_member`. A fourth, `help_urgent`, bypasses it *inside* `_notify` (0047).
- `NotifPrefs.tsx` is a **hand-authored** list of 28 rows in 10 sections (Your activity · Social · Committees · Cabin stays · Events · House calendar · Work items · Meetings & Polls · Family Fest · Help requests), not derived from the type union. 28 rows vs 29 member-selectable types: `admin_test` is deliberately omitted (there is nothing to opt into).
- The web file's own comment says the sections were laid out **to match the iOS app's `NotifPrefsView`**, and asks that section order stay in sync. **Verify in the iOS repo** which of the 28 rows exist there — the ones added most recently on web (`cabin_message`, `private_activity_invite`, `chat_poll_created`, `signup_reminder`, the three `tournament_*`, `work_item_comment`, `work_item_mention`, `house_stay_created`, `meeting_proposed`, `meeting_scheduled`) are the likely gaps, plus the `adminOnly` filtering and the `locked` `help_urgent` treatment.
- Client fallback: `DEFAULT_NOTIF_TYPES` (28 entries) is used when the column reads null — do **not** default to an empty array, which silently mutes a member whose profile row hasn't loaded.

**Toggling is a whole-array replace**, not an element operation: read the current array, add or remove the one string, write the array back. Two devices toggling different rows within the same round-trip will clobber each other — acceptable on web, worth a note in the iOS view model (re-read before write, or accept last-writer-wins as web does).

---

#### 6. `profiles.push_types` — the separate phone-push opt-in (0020, unified in 0034)

A **separate** `text[]`. Its 25 legal values are `PushType` in `lib/types.ts`, and `PushToggle.tsx`'s `TYPES` list has exactly 25 rows — verified one-to-one. Keep them that way (see §9). ⚠️ One of those rows is `adminOnly: true` (`committee_join_request`) and the render does `TYPES.filter((t) => !t.adminOnly || isAdmin)` — so a **non-admin sees 24 rows, not 25**. Mirror that filter for the same reason `NotifPrefs` has one.

Three categories have their **own senders** and no feed row behind them:

- **`chat`** — the firehose. Every new `committee_messages` row (roster-scoped by `area`, including the private `'Leads'` channel) and every new `house_messages` row. Muting is honored: `committee_area_reads` / `house_reads` with `muted = true` **or** `muted_until > now()` (migration 0155).
- **`alerts`** — `announcements` INSERT. Skips `show_banner = false` (an email-only send, migration 0126) and skips anyone with `event_attendance.status = 'not_going'` on the announcement's linked `event_id` when `exclude_not_attending` (0096/0127).
- **`birthdays`** — `media-server/birthday-notifier.js`, a daily local-time job that already calls APNs via `createApnsDelivery()`.

Everything else is a feed mirror where **the push category string is identical to the notification `type` string**. That identity is what makes the whole thing work and also what makes a typo invisible.

**Default set.** `DEFAULT_PUSH_TYPES` (14): `alerts`, `birthdays`, `committee_join`, `cabin_decision`, `cabin_message`, `post_tag`, `post_mention`, `post_reply`, `chat`, `help_request`, `help_response`, `post_comment`, `new_post`, `signup_reminder`. Off-by-default (11): `committee_join_request`, `event_rsvp`, `work_item_created`, `house_stay_created`, `meeting_proposed`, `meeting_scheduled`, `chat_poll_created`, the three `tournament_*`, `private_activity_invite`.

**Master-switch semantics — this is a convention, not a column.** There is no `push_enabled` boolean anywhere. `PushToggle` computes `anyOn = push_types.count > 0`, and:

- Master **on** → register the device, then write the full `DEFAULT_PUSH_TYPES` set.
- Master **off** → write `[]`, then unregister the device.
- Unticking the **last** individual category is treated as master-off: it writes `[]` **and** unregisters.
- While `push_types` is empty the category list is rendered dimmed and non-interactive.

⚠️ **The override kinds key off exactly this emptiness.** Both senders gate `help_urgent` and `admin_test` on `push_types.length === 0` → skip. So an empty `push_types` *is* the off switch for emergencies too, and a populated `push_types` with no registered device is a member who "has push on" and receives nothing. Do both halves, in that order, or emergency pushes and the admin's diagnostic test will disagree with the UI.

⚠️⚠️ **`push_types` is per-ACCOUNT, not per-device.** A member with the iPhone app *and* the installed web PWA shares one array. Turning push off in the native app silences their browser too, and vice versa. Web has the same problem and it has caused real confusion; do not paper over it with device-local state that drifts from the column.

**The one-time first-run prompt (`profiles.push_prompted`, 0034) — port this too.** It is the only thing that gets a brand-new member's push turned on at all, and the section's grant list is not enough to build it from:

- `WelcomeIntro`'s **step 2** (the guided first-run sheet, shown when a brand-new member's profile is still sparse) explains push and drops them into the real `PushToggle`, **master on by default → untick what you don't want**. Reaching that step stamps `push_prompted = true` so nobody is asked twice.
- The standalone `PushPrompt` is the fallback nag for members who never saw the intro; it holds off entirely while the intro is pending. ⚠️ On iOS *before* the app is installed, `WelcomeIntro` deliberately leaves `push_prompted` **unset**, because push cannot work yet and the prompt has to be re-askable after install. Native has no install step, so ask once in-flow and stamp it.
- Migration 0034 backfilled `push_prompted = true` for everyone who already had non-empty `push_types` (already-decided ⇒ never re-prompted).
- Client fallback is `push_prompted ?? true` — i.e. **assume already prompted** when the column reads null, so a partial profile read can never nag a returning member.

**Recovery affordance worth porting:** `PushToggle` has a "Not getting notifications? Re-register this device" link that force-refreshes the subscription. Its comment records why — iOS rotates/drops a token after a re-install or OS update while the push service keeps *accepting* the dead subscription (the comment cites a 201 for web push), so pushes vanish with no error anywhere. Native has the same failure mode (`apns_subscriptions` rows go stale, and a device whose token rotated was simply never re-registered), so keep the button.

---

#### 7. Device registration — `apns_subscriptions` (migration 0052)

```
user_id      uuid not null → profiles(id) on delete cascade
device_token text not null
environment  text not null default 'production' check (environment in ('sandbox','production'))
created_at   timestamptz not null default now()
updated_at   timestamptz not null default now()
primary key (user_id, device_token)
```

**RLS read rule:** you see only rows where `user_id = auth.uid()` — own-rows for all four commands (`select`/`insert`/`update`/`delete`, all `to authenticated`). An empty read means "this account has registered no devices", never a permission failure. The mini reads everyone's via the service-role key.

Write path is a plain upsert with `onConflict: "user_id,device_token"` — the migration header names `PushService.saveToken` as the existing iOS caller, so this already exists; **audit it for the points below** rather than rewriting it.

⚠️ **`environment` is per-row and the mini routes on it**: `api.sandbox.push.apple.com` for `'sandbox'`, `api.push.apple.com` otherwise. A debug build that registers `'production'` gets `400 BadDeviceToken`, and `sendToUser` **deletes the row** on `BadDeviceToken`/`Unregistered`/`410` — so the device silently deregisters itself and the tester concludes push is broken. Gate it: `#if DEBUG` → `"sandbox"`, else `"production"` (TestFlight and App Store builds are both production).

⚠️ Re-upsert the token on **every** launch and on every `didRegisterForRemoteNotificationsWithDeviceToken`, not just on first permission grant — that is the only thing that heals the rotated-token case above, and it is exactly why the web side keeps a manual re-register button.

⚠️ On sign-out, **delete this account's row for this device**. `apns_subscriptions` cascades on profile delete but nothing cleans up an account switch on a shared phone, and the row survives to push the previous member's private chat titles to the new member's lock screen. (Web has the analogous class of bug on record — a shared cache key leaked one member's private chat to the next user, fixed in PR #244. Same shape, different table.)

---

#### 8. Exactly how the mini decides to send an APNs push

`media-server/apns-sender.js` `handleFeed(n)`, on every `notifications` INSERT delivered over Realtime. This is the whole decision, in order:

1. `if (!n || !n.id || !n.recipient_id || !PUSHABLE.has(n.type)) return;` — **not in the set ⇒ silent no-op forever.**
2. `once("notif:" + n.id)` — an in-memory de-dupe `Set`, cleared past 5000 entries. **A mini restart empties it**, so a replayed row can re-push.
3. Read `profiles.push_types` for `n.recipient_id`.
4. Gate, three branches:
   - `help_urgent` or `admin_test` → **override**: send if `push_types.length > 0`, ignore category picks.
   - `broadcast` → send only if `push_types.includes("alerts")` (there is no `broadcast` category).
   - everything else → send only if `push_types.includes(n.type)`.
5. Build the payload and `sendToUser` to every row in `apns_subscriptions` for that user, pruning dead tokens.

**The exact JSON your `userInfo` will contain:**

```json
{
  "aps": {
    "alert": { "title": "<n.title>", "body": "<n.body, sliced to 180>" },
    "sound": "default",
    "badge": 1,
    "category": "EVENT_REMINDER | HELP_REQUEST | CHAT_MENTION | COMMITTEE_JOIN_REQUEST | WORK_FOLLOWUP"
  },
  "url": "https://mlr-app-omega.vercel.app/posts?post=…&comment=…",
  "target_type": "<n.entity_type, when present>",
  "target_id": "<n.entity_id, when present>",
  "request_id": "…", "committee_id": "…"
}
```

Four things to internalize:

- ⚠️ **`url` is ABSOLUTE, prefixed with the mini's `APP_URL`** (default `https://mlr-app-omega.vercel.app`), because the same relay feeds the web PWA. Strip the origin and route the remaining path + query with your own navigator. Do **not** hand it to `UIApplication.open` — that bounces the member into Safari and out of the app they just tapped.
- ⚠️ `target_type` / `target_id` are `entity_type` / `entity_id` passed straight through and are **often absent or coarser than the url** (`post_comment` sets `entity_id` to the *post* id while the url carries `&comment=`; `event_rsvp` sets `entity_id` to NULL outright). **The url is the authoritative deep link; `target_*` is a hint.** Route on the url, fall back to `target_*`.
- ⚠️ `"badge": 1` is **hard-coded** — every push sets the icon badge to literally 1, never the real unseen count. See §12; this is the single easiest place for iOS to beat the web app.
- ⚠️ Extra `payload.userInfo` keys are **flattened to the top level**, not nested under a `userInfo` object. `committee_join_request` carries `request_id` + `committee_id` (the mini re-reads `committee_join_requests` because `entity_id` is the *request* id and the inline Approve action needs the committee too). `work-followup.js` carries `work_item_id` + `request_id` with `category: "WORK_FOLLOWUP"`.

**Deep-link paths you must handle — 24 shapes, all read out of the live trigger/RPC bodies** (an earlier draft of this spec listed 15 and silently dropped six whole kinds):

| Kind(s) | url shape |
|---|---|
| `post_comment` · `post_reply` · `post_mention` | `/posts?post=<uuid>&comment=<uuid>` |
| `post_tag` · `post_reaction` · `new_post` | `/posts?post=<uuid>` |
| `chat_mention` (committee, 0063) | `/posts?c=<slug>&m=<uuid>[&area=<area>]` |
| `chat_mention` (house, 0065) | `/posts?house=<slug>&m=<uuid>` |
| `meeting_proposed` · `meeting_scheduled` (`_meeting_url`, 0122) | `/posts?c=<slug>[&area=<area>]&meeting=<uuid>` · `/posts?house=<slug>&meeting=<uuid>` · `/events?meeting=<uuid>` (family scope) |
| `chat_poll_created` (`_chat_poll_url`, 0149) | `/posts?c=<slug>[&area=<area>]&poll=<uuid>` · `/posts?house=<slug>&poll=<uuid>` |
| both helpers' fallback | `/posts` |
| `committee_join` | `/committees/<slug>` (approved) · `/committees` (declined) |
| `committee_join_request` (0091) | **`/admin/committees?committee=<slug>`** — the admin approval queue, not the public roster page |
| `cabin_request` (admins) · `new_member`-adjacent | `/profile` |
| `cabin_request` (a place's non-admin approver) · `cabin_decision` · `cabin_message` | `/request-stay` |
| every help kind | `/help-requests` |
| `work_item_created` · `work_item_comment` · `work_item_mention` | `/?work=<uuid>` |
| `house_stay_created` (0071) | **`/house/calendar?house=<slug>`** |
| `new_member` | `/people?member=<uuid>` |
| `signup_reminder` (schedule) · `tournament_*` (fest) | `/family-fest/schedule/<uuid>` |
| `signup_reminder` (activity) | `/family-fest` |
| `event_rsvp` (0036) | **`/events`** (bare) |
| `private_activity_invite` · `tournament_*` (private activity) | `/events?activity=<uuid>` |
| any row with a null `url` | `/` (the sender's fallback) |

⚠️⚠️ **The committee `chat_mention` url is NOT percent-encoded, and `area` comes last.** The trigger concatenates the raw area name: `'/posts?c=' || slug || '&m=' || message_id || '&area=' || v_area`. Real area names contain ampersands and commas — `"Entertainment & Games"`, `"Art & Decorating"`, `"Merchandise, Fundraising & Polling"` — so a stored url is literally `…&m=<uuid>&area=Entertainment & Games`, which a strict `URLComponents` query parse will split into a bogus extra parameter. Parse defensively: take everything after the *first* `&area=` as one raw value rather than trusting the query tokenizer. (Only the mini's chat-*firehose* push url runs `encodeURIComponent(area)`; the feed row does not.)

⚠️ **Never route a chat notification to `/committees/<slug>/chat`.** Migration 0030 originally emitted that shape; 0063 superseded it with the `/posts?c=` feed form precisely because the standalone route dies in the installed PWA. Old `notifications` rows created before 0063 may still hold the legacy url — normalize `/committees/<slug>/chat?m=<id>` to your native committee-chat screen rather than dead-ending. Same for pre-0108 `cabin_request` rows, which briefly carried `/admin/cabins?booking=<uuid>` (0091) before 0108/0114 recreated the trigger off an older body and reverted it to `/profile`.

**The five non-feed APNs paths** (each has its own gate, none of them touch `PUSHABLE`):

| Handler | Trigger | Gate |
|---|---|---|
| `handleMessage` | `committee_messages` INSERT | `push_types` has `chat`, roster/area/`'Leads'` scoping, minus muted, minus author |
| `handleHouseMessage` | `house_messages` INSERT | `push_types` has `chat`, `profiles.house_id` members, minus muted, minus author; skips `deleted_at` |
| `handleAlert` | `announcements` INSERT | `push_types` has `alerts`; skips `show_banner = false`; excludes `not_going` |
| `maybeNewMember` → `handleNewMember` | `profiles` INSERT/UPDATE with a `joined_at` under 10 min old | `is_admin` **and** `notify_new_members`; skips `invited_via = 'invite_link'`. ⚠️ **Not gated on `push_types` at all**, and ⚠️ unlike `push-sender.js` it does **not** skip the App Review account — see §11 |
| `birthday-notifier.js` / `work-followup.js` | daily job / 10-min poll | `birthdays` category / no push gate (work-followup also only fires while the linked work item is still `open`) |

⚠️ `handleMessage`/`handleHouseMessage` sleep **500 ms** before reading the message row (the client's media/mention child rows land after the parent). If you ever add a mini-side handler, keep that delay.

⚠️ Both senders resubscribe 5 s after `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`. **There is no unsent-row ledger for push** — unlike email, a push missed during a dropped channel is gone with no sweep to recover it. Which is exactly why the durable feed exists: **an iOS Activity screen that reconciles on foreground is the recovery mechanism for every push the mini dropped.** Treat it as reliability infrastructure, not a nice-to-have list.

---

#### 9. ⚠️⚠️ The three-place invariant — the most expensive bug class in this feature

**A notification kind pushes only when it appears in all three of:**

1. the client's `PushType` union **and** a matching `PushToggle` row (so the string can legally be in `push_types` and a member can see/toggle it),
2. the mini's pushable set (`apns-sender.js` `PUSHABLE` / `push-sender.js` `PUSHABLE_FEED_TYPES`),
3. an actual `notifications` row inserted with that exact `type`.

Missing any one produces **zero pushes, forever, for everyone, with no error in any log, on any device, at any layer.** Two production incidents, both recorded in the code comments:

- ⚠️⚠️ **`broadcast` was invisible to every recipient.** `send_broadcast_notification` inserts `type = 'broadcast'`, and `'broadcast'` was never a real `PushType` — so `pushTypes.includes(n.type)` could never be true. An admin checking "🔔 Activity tab" in `AdminBroadcastComposer`, or "🔔 Also send a notification" on a Home callout, saw the item land in everyone's Activity feed and **nobody was buzzed** — including admins with every category on. No admin action and no member setting could have produced a push through this path. Fixed by adding `"broadcast"` to both senders' pushable sets and **special-casing it onto the existing `alerts` category** rather than minting a `PushType` — no migration, no client change. **The lesson for iOS: `broadcast` and `admin_test` will never appear in any member's `push_types`. If you build a "which categories are on?" diagnostic screen off the `PushType` union, it will report these two as off while they are in fact the two that always fire.**
- ⚠️ **`help_request` and `help_response` had no `PushToggle` row at all.** Both are real `PushType` values, both in `DEFAULT_PUSH_TYPES`, both correctly in the pushable sets — but the hand-authored row list simply omitted them. Every member was receiving these pushes with **no way to see or turn off those two specifically**, short of the blunt master switch. Fixed by adding both rows. The invariant was verified by diffing the `PushType` union against `TYPES`' `value`s — **do the same diff in Swift, and put it in a unit test**, because these two lists are hand-maintained in both codebases and nothing else checks them.

⚠️ And the fourth place nobody thinks about: **`notif_types`.** A feed-backed kind's push depends on the feed row existing. That is why `NotifPrefs` and `PushToggle` are not independent, and why "one switch controls feed + push" is the documented intent for these kinds.

---

#### 10. Admin surfaces in scope here

- **The "🔔 Activity tab" broadcast channel** — `send_broadcast_notification`, one row per recipient at send time. Audience `everyone`/`admins`, optional tap-through `p_url`, optional `p_expires_at` (badge-only expiry), plus `p_event_id` + `p_exclude_not_attending` which drop anyone who RSVP'd `not_going`. It is one of three independent channels in `AdminBroadcastComposer` (Banner / Activity tab / Email) — the other two are the `announcements` table and are outside this section, but note the **push rides the banner, not the email**: `handleAlert` returns early on `show_banner = false`.
- **Scheduled sends** — `run_scheduled_broadcasts()` on `pg_cron` inserts the same `type = 'broadcast'` rows, re-deriving `expires_at` relative to when it actually posts. Fires with every phone asleep and the mini off. Nothing for iOS to do beyond expecting broadcast rows to appear with no user action.
- **Notification Test** (`/admin/notification-test`) — two tools worth porting because they exist *for* iOS support calls: `send_test_notification(p_user, p_title, p_body)` pings **one** member with an override push (bypasses both `notif_types` and category picks; only a fully-off `push_types` blocks it — which is itself the diagnostic signal), and `set_notification_test_confirmed(p_user, p_value)` records "I watched it land on their phone" into `profiles.notifications_confirmed` / `_at` / `_by`. Client seam: `lib/notificationTest.ts`, which reads the roster with a **pre-migration fallback** (drops the three columns from the select on error and returns everyone unconfirmed) — keep that shape.

---

#### 11. iOS-specific gaps this audit found in the shared backend

These are not "iOS hasn't built it yet" — these are places where the two senders have **diverged**, so an iPhone member gets a different result from a browser member today.

- ⚠️⚠️ **`cabin_request` never pushes to an iPhone. This needs a mini change.** `push-sender.js` has a bespoke `handleCabinRequest` on `cabin_bookings` INSERT (gated on `notif_types` containing `'cabin_request'`, honoring `request_notify = false`, and including a non-admin `cabins.approver_user_id`). **`apns-sender.js` has no such handler and does not subscribe to `cabin_bookings` at all**, and `cabin_request` is absent from `PUSHABLE`. So an admin — or the private-house owner who is the designated approver and has no admin access — gets the Activity row and, on iPhone, **no push**. Port `handleCabinRequest` into `apns-sender.js`; ~40 lines, same shape, `apns.sendToUser` instead of `sendToUser`.
- ⚠️ **`chat_mention` is not pushable on either sender.** A committee/house `@mention` produces a `chat_mention` feed row, but the type is in neither `PushType` nor `PUSHABLE`. It reaches a phone only incidentally, via the `chat` firehose — so a member who turns `chat` off to escape the firehose loses `@mention` pushes entirely, which is the exact opposite of what they wanted. Consequence: `apns-sender.js`'s `categoryFor("chat_mention") → "CHAT_MENTION"` is **unreachable dead code** (the firehose payload sends `type: "chat"`, which maps to `null`), so the `CHAT_MENTION` category registered in iOS's `NotificationActions.swift` never appears on a real notification. Fixing it properly is a `PushType` + toggle row + pushable-set change (all three places) — worth raising with Brian as a product call.
- ⚠️ **`push_self_notify` does nothing on iOS.** `apns-sender.js` declares `SELF_NOTIFY_IDS` at line 163 and **never reads it again** (verified by grep); `push-sender.js` threads it through both chat handlers. So the "🧪 Notify me of my own actions" switch — the only way to test push without a second person, and it is gated to one email — is web-push-only. If you are testing native push, that switch will not help you; use the admin `send_test_notification` tool instead.
- ⚠️ **The App Review account leaks to iOS admins.** The SQL trigger (0077) and `push-sender.js`'s `handleNewMember` both explicitly skip `appreview@muskellungelakeresort.com`, so the reviewer login stays invisible to the family. `apns-sender.js`'s `handleNewMember` has **no such check**, so an admin on iPhone gets a "👋 New member joined" push for the review account that a browser admin never sees. Four lines in the same file as the `handleCabinRequest` port.
- ⚠️ `post_reaction`, `work_item_comment`, `work_item_mention` are in-app only on both senders. That is deliberate, not a bug — don't "fix" it.

---

#### 12. Where iOS can beat the web app

Every item here is something a browser structurally cannot do, and most of them are small.

- **A badge that is correct without the app being open.** The single highest-value item. Today `aps.badge` is hard-coded `1`, so the icon shows `1` after any push regardless of the real count, and Web Push on iOS cannot set an app badge at all. Two routes: (a) have the mini compute the recipient's unseen-unexpired count and send it as `aps.badge` — a `select count(*)` next to the existing `push_types` read in `handleFeed`, four lines; or (b) keep it native — set `mutable-content: 1` and let a `UNNotificationServiceExtension` fetch the count, or reconcile with `UNUserNotificationCenter.setBadgeCount` on every foreground plus every `didReceiveRemoteNotification`. Route (b) needs no mini change and also lets you *decrement* the badge when the member reads an item on another device. Do (b) first.
- **Real actionable buttons, with the payload already in place.** `categoryFor()` already stamps `EVENT_REMINDER`, `HELP_REQUEST`, `COMMITTEE_JOIN_REQUEST` (with `request_id` + `committee_id` in `userInfo`), and `work-followup.js` stamps `WORK_FOLLOWUP` (with `work_item_id` + `request_id`). Wire the RPCs behind `UNNotificationAction`s so a member never opens the app. ⚠️ **These four RPCs do not all follow the `p_*` convention — a wrong key is a runtime `PGRST202`, so copy the argument names exactly:**
  - **"On my way"** on a `help_request` → `respond_to_help(p_request: uuid, p_note: text?)`
  - **Going / Can't make it** on an `event_rsvp` → `set_event_attendance(p_event: text, p_status: text, p_days: jsonb?, p_title: text?)`. ⚠️⚠️ **Two overloads are live and only one notifies.** 0036 created the 4-arg `(text,text,jsonb,text)` carrying the `event_rsvp` fan-out; 0122 later added a 3-arg `(text,text,jsonb)` (it stamps `confirmed = true`) whose body contains **no `_notify` call at all**. Web always sends `p_title` (`lib/events.ts`) and so hits the notifying overload — **always send `p_title`**, or the RSVP saves and nobody hears about it.
  - **Approve / Decline** on a `committee_join_request` → ⚠️ `review_join_request(req_id: uuid, approve: boolean)` — bare `req_id`/`approve`, **not** `p_id`/`p_approve`. Use the forwarded top-level `request_id`.
  - **"Done" / "Still open"** on `WORK_FOLLOWUP` → `mark_work_item_done(p_id: uuid)`
  
  Web push on iOS has no action buttons whatsoever — this is a capability gap, not a polish gap. ⚠️ Use a background-executing action handler and mark the notification read via `mark_notification_read(p_id:)` in the same handler, or the Activity row stays bold after the member has clearly acted on it.
- **A thumbnail in the notification.** `post_comment`, `new_post` and drop-box activity are all photo-driven, and a lock-screen preview is most of the value. Needs `mutable-content: 1` plus an image URL in the payload (a `thumbnail_url` — every `*_media` table has the column since 0173), then a `UNNotificationServiceExtension` downloads it into a `UNNotificationAttachment`. ⚠️ Two hard constraints: the mini's `/f` reads are token-signed (`?t=`, `MEDIA_AUTH`), so the extension must sign the URL the same way the app does — and the extension is a **separate process** with its own container, so plan the token hand-off deliberately. Currently `MEDIA_AUTH=report` **specifically because native iOS cannot sign yet**; do this after the media-token work lands, not before.
- **Grouping and summaries.** 31 kinds fanned out per-recipient means a live fest evening produces a wall of individual banners. Set `aps["thread-id"]` from the mini (derive it from `entity_type`+`entity_id`, so every comment on one post collapses into one thread) and add a `UNNotificationCategory` `categorySummaryFormat` — "%u more comments on your post". iOS then does the grouping and the summary text for free. Web push gets one flat banner per row and always will.
- **Live Activities during fest week.** The one genuinely native-only feature with an obvious home here: a Lock Screen / Dynamic Island Live Activity for the live fest week showing today's next event and the member's own next sign-up slot. The data already exists and is already time-resolved server-side — `run_signup_reminders()` computes each slot's absolute instant in `America/Chicago` — so the ActivityKit content state is a direct read, and the `signup_reminder` push can carry the update. Scope this as its own project, not as part of the feed port.
- **Local notifications as a reliability backstop.** The mini is a Mac mini in a house; when its Realtime channel drops, **push is simply lost with no ledger and no sweep**. Once the app knows a member's slot times (`fest_schedule_slots`), schedule `UNCalendarNotificationTrigger`s on-device for their own slots. Then a fest reminder fires even if the mini is off, the router is down, or APNs is degraded. No browser can do this.
- **Swipe-to-dismiss.** The `notifications: own delete` RLS policy has existed since 0030 and **no web surface uses it.** A native swipe action on the row is a two-line delete, and it is a real inbox that currently cannot be cleaned out. (Remove locally; don't wait for a realtime DELETE — §1.)
- **Offline feed.** Web caches a persisted snapshot under `notifFeed.<uid>` in `localStorage` (200 KB cap, 24 h TTL) purely to avoid a skeleton flash. Native has no such cap — keep the last few hundred rows in a local store, render instantly, reconcile in the background, and the Activity tab works on the drive up with no signal.
- **Haptics and permission timing.** `lib/haptics.ts` is Android-only and a documented **no-op on iOS** — every haptic in this app is currently dead weight on the platform that has the best haptics. And where web must ask for notification permission behind an install-to-Home-Screen walkthrough (`InstallFirstNudge`, `PushToggle`'s iOS hint), native asks once, in-flow, from `WelcomeIntro`'s step 2 equivalent — and stamps `push_prompted` unconditionally, since unlike web there is no pre-install state to wait for (§6). Delete the "add to Home Screen first" copy path entirely on iOS.

---

#### 13. Depth audit for what iOS already has

iOS has APNs push (`apns_subscriptions` shows 3 registered devices across 2 members) and a `NotifPrefsView`. **Do not treat either as done** — the web side has grown ~15 kinds and several read-model refinements since. Every line below must be **verified in the iOS repo**, which is not on this machine.

**`NotifPrefsView`:** all 28 rows present? · 10 sections in web's order? · `adminOnly` filtering on `committee_join_request` + `cabin_request`, including hiding a section that empties out? · `help_urgent` rendered as a locked "🔒 Always on" row with no switch? · array-replace write through the column grant, with optimistic rollback on failure? · fallback to `DEFAULT_NOTIF_TYPES` (not `[]`) when the column reads null?

**Push settings:** does a `PushToggle` equivalent exist at all, with all 25 rows — and is `committee_join_request` filtered out for non-admins (24 rows for them)? · master switch = `push_types.isEmpty`, and does master-off both clear the array *and* delete the `apns_subscriptions` row? · does unticking the last category do the same? · is `DEFAULT_PUSH_TYPES` (14 entries, in sync) written on master-on? · is there a "re-register this device" recovery action? · admin-only `notify_new_members` switch? · **is there a one-time first-run push prompt that stamps `push_prompted`, and does it read the column as `?? true` so a partial profile load never re-nags?**

**Registration:** `environment` correct per build configuration? · re-upsert on every launch and every token callback? · row deleted on sign-out?

**Push handling:** `url` origin stripped and routed in-app (not Safari)? · **all 24 deep-link shapes handled** — including `&comment=` (0164), the `&meeting=` / `&poll=` / `?c=…&m=…&area=` chat forms with their **unencoded** area values, `/admin/committees?committee=`, `/house/calendar?house=`, bare `/events`, and the legacy `/committees/<slug>/chat?m=` + `/admin/cabins?booking=` forms? · `target_type`/`target_id` treated as a hint under the url (and tolerant of a null `entity_id`)? · top-level `request_id`/`committee_id`/`work_item_id` read from `userInfo`? · tapping a push marks the row read via `mark_notification_read`? · foreground pushes not double-presented?

**Activity feed screen:** the prompt's inventory of what iOS has does **not** list an Activity feed — verify whether one exists. If it does: FK-hinted actor join? · `mark_notifications_seen()` on appear? · per-row `mark_notification_read(p_id:)` on tap? · `mark_all_notifications_read()` action? · expired rows dimmed and excluded from the badge (remembering that help rows expire too)? · badge query including the `.or(expires_at…)` clause and recomputed on foreground rather than only on realtime? · realtime channel filtered `recipient_id=eq.<uid>`? · **`type` decoded as `String` with an unknown-type fallback** (the `new_member` trap)? · day grouping (web groups by local day with "Today"/"Yesterday" headings)?

---

#### 14. Size, and the v1 cut

Honestly: the **feed screen plus the read model is small** — one table, one filtered query, three no-arg-or-one-arg RPCs, one realtime channel, one count query. Call it 2–3 days including the badge. The **two preference screens are tedious rather than hard** — 28 + 25 hand-authored rows with copy, sections, admin filtering, and one locked row; a day each, mostly typing. The **push plumbing already exists** and the work is audit-and-repair, not construction. The genuinely large items are the ones in §12 that need a notification service extension (attachments, extension-side badge) and Live Activities.

**v1 cut, in this order:**

1. **Activity feed + read model + accurate badge.** This is the reliability floor — it is what recovers every push the mini dropped, and the badge is the most-seen surface in the app.
2. **Audit the push payload handler** against §8: url routing across all 24 shapes, the `&comment=` param, the unencoded `&area=` parse, `type` as `String`. Cheap, and each one is a silently-wrong tap today.
3. **Registration hardening** (§7): `environment`, re-upsert, sign-out delete. Three small fixes that between them explain most "I stopped getting notifications" reports.
4. **The two preference screens**, brought to full parity — including the first-run prompt + `push_prompted` (§6), without which a new member never gets push at all.
5. **The three-place-invariant unit test** (§9) — diff your push-category list against the mini's set and against the toggle rows. This is 20 lines and it is the only thing that will stop the next `broadcast`-class incident.
6. **Actionable categories** (§12) — highest-delight-per-hour once the plumbing is right, and the payloads are already being sent. Copy the RPC argument keys verbatim; two of the four don't use `p_*`.

**Defer from v1:** notification attachments (blocked on native media-token signing anyway), Live Activities, on-device local-notification backstop, swipe-to-dismiss, offline feed persistence, keyset pagination past the first 100 rows, and the admin Notification Test tools (two admins use them, on a laptop).

**Raise with Brian, don't decide alone:** whether `chat_mention` should become a real push category (§11), and whether the `cabin_request` APNs handler (plus the two-line App Review skip in `apns-sender.js`) ships as part of this work or as a mini-side follow-up.
