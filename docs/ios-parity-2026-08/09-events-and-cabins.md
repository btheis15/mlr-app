<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **11 correction(s)** were applied.

### Events + RSVP, and cabin stays

Both features are **fully built on the shared Supabase project**. Every table, RLS policy and RPC named below already exists and is what the web app calls today — porting is writing Swift against live schema. **Exactly four things in this section need a backend change**, and all four are called out with 🛠️ so they can't be missed:

1. 🛠️ **`set_event_attendance` has two live overloads** and the one the web client hits does *not* stamp `confirmed = true` — the "reconfirm by re-tapping" promise of migration 0122 is broken. Needs a migration. (§A4)
2. 🛠️ **`review_cabin_stay` has lost its per-room capacity guard** (0104 recreated it from the 0032 body; 0114 carried that forward), so two members can be approved into the *same named room* for overlapping nights. Needs a migration. (§B4)
3. 🛠️ **`cabin_request` has no APNs path at all** — `handleCabinRequest` exists only in `media-server/push-sender.js` (web push); `apns-sender.js` never subscribes to `cabin_bookings`. An iOS admin/approver gets an Activity row but **no phone buzz** for a new cabin request. Needs a mac-mini change + restart. (§B10)
4. 🛠️ **`notif_on_cabin_request`'s admin deep link was reverted to `/profile`** (0091 fixed it to `/admin/cabins?booking=<id>`, 0108 clobbered it, 0114 carried it forward). Needs one more recreate, from production. (§B10)

Everything else is client work.

---

## PART A — Events + RSVP

### A1. The model that trips everyone up: DB rows **merged with an in-code seed**

`public.events` (migration [0034](supabase/migrations/0034_events.sql)) is admin-managed. But the calendar the user sees is **DB rows ∪ an in-code seed array**, merged client-side in `fetchEvents()` ([lib/events.ts](lib/events.ts)):

```ts
const dbSlugs = new Set(dbEvents.map(e => e.slug).filter(Boolean));
const seed = RESORT_EVENTS.filter(e => !e.slug || !dbSlugs.has(e.slug));
return [...dbEvents, ...seed].sort((a,b) => a.startDate.localeCompare(b.startDate));
```

The seed is `RESORT_EVENTS` in [lib/data.ts](lib/data.ts) — exactly **two** entries today:

| id / slug | kind | dates | dayRsvp |
|---|---|---|---|
| `family-fest-2026` | `family_fest` | `FAMILY_FEST.startDate` → `.endDate` (today: `2026-07-26` → `2026-08-01`) | **true** |
| `up-north-4th-2026` | `holiday` | `2026-07-03` → `2026-07-05` | false |

⚠️ **Family Fest is deliberately NOT a DB row, and must not become one.** Its dates are synthesized from `FAMILY_FEST` in `lib/data.ts` so the season model (`lib/festSeason.ts`, which drives the whole `/family-fest` takeover, the tab live-dot, and dues) has **one** source of truth. If iOS instead creates a real `events` row for Family Fest, you get two Family Fests on the calendar with two sets of RSVPs, and the seed one keeps winning on Home.

⚠️ **The merge key is `slug`, not `id`.** A DB row with `slug = 'family-fest-2026'` *replaces* the seed entry — that's the designed upgrade path. A DB row with `slug = NULL` (which is what `create_event` produces, since the RPC never sets a slug) can never collide. So: **iOS must ship its own copy of the seed array and the same slug-dedup merge**, or the 4th of July silently disappears from the native calendar while it's on web.

⚠️ **`ResortEvent.persisted`** (`true` for a DB row, `false` for a seed entry) is the flag every admin affordance keys off. `Edit`/`Delete` in `EventSheet` render only when `isAdmin && event.persisted` — because `update_event`/`delete_event` take a **uuid** and a seed slug isn't one. In Swift make this a non-optional `let isPersisted: Bool` set by the mapper, never inferred at the call site.

### A2. Attendance keys on a **stable TEXT id**, not a foreign key

`public.event_attendance` (migration [0035](supabase/migrations/0035_event_attendance.sql)):

```sql
event_id   text not null,       -- NOT a FK. uuid::text for a DB event, or a seed slug.
user_id    uuid not null references profiles(id) on delete cascade,
status     text not null check (status in ('going','maybe','not_going')),
days       jsonb,
confirmed  boolean not null default true,   -- added by 0122
primary key (event_id, user_id)
```

This is the whole reason the seed/DB merge works: `family-fest-2026` carries RSVPs exactly like a uuid does. There is **no cascade** from `events`, so `delete_event(p_id)` cleans up by hand (`delete from event_attendance where event_id = p_id::text`).

⚠️ **In Swift, `eventId` is `String` everywhere** — never `UUID`. A `UUID(uuidString:)` parse in the model layer will silently drop Family Fest and the 4th (returns nil), and you'll be debugging "why does RSVP only work on some events."

### A3. RLS read rules — one sentence each, so an empty result is interpretable

| Table | Read rule | An empty result means |
|---|---|---|
| `events` | **Public** (`using (true)`) — anon included, unchanged by 0081/0183. | Genuinely no events. |
| `event_attendance` | **`is_approved_member()`** (0081 made it members-only, [0183](supabase/migrations/0183_verified_member_reads.sql) tightened it to admin-approved). | *Not permitted* — a guest or an unverified signup. Never "nobody RSVP'd". |
| `event_work_items` | **Public** (`using (true)`, 0048). | No links. |
| `work_items` (embedded) | `is_approved_member()` + house scoping (0066/0183). | Not permitted — so a link row exists but its embed is null. |

⚠️⚠️ **`event_attendance` has NO own-row exception, and `set_event_attendance` only requires `auth.uid() is not null`.** So an **unapproved** signup can *write* an RSVP and then cannot *read it back* — including their own row. On iOS the segmented control will appear to save and then snap back to unselected on the next fetch, with no error anywhere. Web masks it briefly with an optimistic write. **Gate the whole RSVP UI on the verified-member state** and show a "waiting to be verified" card, exactly like the guest branch. Same reasoning applies to the roster: `EventCard`/`EventSheet` render *"🔒 Sign in to see who's coming"* instead of "No RSVPs yet" precisely because a false zero is worse than a lock (see the comments in both files).

> Modeling note: on web this needs no third state — `useGuest()` already folds it in (`guest = isSupabaseConfigured && (!user || !verified)`), and `Protected` swaps its copy to *"🔒 Waiting to be approved"* when `awaitingVerification`. Mirror that: **unverified == guest** for every read surface, and let the RSVP control follow the same flag.

### A4. Canonical RPC signatures — names and order matter

Supabase keys RPC arguments **by name**, so a wrong key is a runtime failure, and a *missing* key can silently select a different overload.

```
create_event(p_title text, p_start_date date, p_end_date date, p_kind text,
             p_emoji text, p_location text, p_description text,
             p_day_rsvp boolean, p_start_time time) → uuid          -- admin only (0034 + 0101)

update_event(p_id uuid, p_title text, p_start_date date, p_end_date date, p_kind text,
             p_emoji text, p_location text, p_description text,
             p_day_rsvp boolean, p_start_time time) → void          -- admin only

delete_event(p_id uuid) → void                                      -- admin only; also purges attendance

set_event_attendance(p_event text, p_status text, p_days jsonb, p_title text) → void
clear_event_attendance(p_event text) → void

sync_event_work_items(p_event_id text, p_item_ids uuid[]) → void     -- admin only (0048)
add_work_item_to_event(p_event_id text, p_work_item_id uuid) → void  -- any member, additive (0050)
```

`p_kind` ∈ `family_fest | work_weekend | holiday | custom`. The composer only offers the last three (`KINDS` in `EventComposer.tsx`) and coerces an edited `family_fest` to `custom`.

🛠️⚠️⚠️ **INCIDENT — `set_event_attendance` currently has TWO live overloads, and it is the same class of bug as the `request_cabin_stay` double-7-arg incident.**

- [0035](supabase/migrations/0035_event_attendance.sql) created `(text, text, jsonb)`.
- [0036](supabase/migrations/0036_event_rsvp_notifications.sql) **dropped** that and created `(text, text, jsonb, text)` — the `p_title` version, which fans out the `event_rsvp` notification on a *fresh* going (the title has to come from the client because a seed event has no `events` row to read a title from).
- [0122](supabase/migrations/0122_family_meetings_to_events.sql) then did `create or replace function set_event_attendance(p_event, p_status, p_days)` — **re-creating the 3-arg overload from scratch**, to add `confirmed = true` to the UPDATE branch. It never dropped or touched the 4-arg one.

Net effect, live today: **both exist.** `(text,text,jsonb)` stamps `confirmed = true` but sends **no** notification; `(text,text,jsonb,text)` sends the notification but **never touches `confirmed`**. The web client always passes `p_title`, so it resolves to the 4-arg version — meaning **a carried-over unconfirmed RSVP can never be reconfirmed by re-tapping**, the "(hasn't confirmed)" tag never clears, and the auto-queued 14-day `onlyUnconfirmed` reminder keeps targeting people who *have* answered.

- **Verify before writing Swift:** `select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'set_event_attendance';` — expect two rows.
- **Do not "work around" it by dropping `p_title` on iOS.** That would silently pick the other overload, so iOS would flip `confirmed` correctly but stop sending the `event_rsvp` notification, and the two clients would behave differently for the same tap. That divergence is far worse to debug than the original bug.
- **The fix is a migration**: merge both bodies into one canonical `(p_event, p_status, p_days, p_title)` that both notifies *and* sets `confirmed = true`, then `drop function set_event_attendance(text, text, jsonb)`. Write it from the **current production definitions of both**, not from 0036's or 0122's copy — that's the [0160](supabase/migrations/0160_restore_blocklist_whole_word.sql) lesson this very function violated.
- Until it's merged: **iOS must send all four keys** (`p_days: nil` and `p_title: nil` are fine) so it matches web behavior exactly.

### A5. Per-day RSVP for multi-day events, and how it rolls up

Gated on `events.day_rsvp` **and** more than one day (`showDays = event.dayRsvp && days.length > 1` in `EventSheet.tsx`). `EventComposer` only offers the toggle when the range is genuinely multi-day, and stores `dayRsvp: multiDay && dayRsvp`.

`days` jsonb is a flat map of ISO day → status: `{"2026-07-27":"going","2026-07-28":"not_going"}`. The **overall `status` column is the rolled-up answer**, and the client is responsible for keeping the two consistent. Port these four pure functions from `lib/events.ts` verbatim:

- `eventDays(start, end?) -> [String]` — every inclusive ISO day. Loops with **local** date math (`toISODate`), capped at 366 iterations so a reversed range can't hang.
- `effectiveStatus(status, days) -> AttendanceStatus` — `going` if the column is going **or any day value is going**; else `maybe` if anything is maybe; else `not_going`. This defensively re-derives the roll-up so a drifted row still reads correctly.
- `goingByDay(summary.going, days)` — per-day roster. **A "going" row with an empty/absent `days` map counts on EVERY day** (the whole-week default); one with a map counts only on its `going` days. Feed it `summary.going` (already day-aware), never the raw rows, or a maybe/can't-make leaks in.
- `myGoingDays(mine, days) -> Set<String>` — the viewer's own day chips.

**The day-toggle write semantics** (`toggleDay` in `EventSheet.tsx`) are load-bearing and non-obvious:

| Resulting selection | What is written |
|---|---|
| 0 days | `set_event_attendance(status: "not_going", days: nil)` |
| **all** days | `set_event_attendance(status: "going", days: nil)` — collapses to a plain going, **no map** |
| some days | `status: "going"` + a **complete** map with `"going"`/`"not_going"` for *every* day in the range |

⚠️ The all-days case deliberately writes `days = nil` rather than an all-going map. That's what makes "going for the whole week" the cheap default and keeps `goingByDay` counting them on every day. Don't "simplify" it to always sending a map.

⚠️ **`hideMaybe = event.dayRsvp`** — a day-RSVP event drops the Maybe button entirely (`AttendanceControl`), and `CountChips` hides the maybe tally to match. The question for Family Fest is *which days*, not *whether*. (With today's dates that's **seven** day chips: 2026-07-26 → 2026-08-01 inclusive.)

### A6. Unconfirmed RSVPs carried over from a meeting poll (0122)

`finalize_meeting_as_event(p_meeting, p_slot, p_kind, p_title, p_description, p_location) → uuid` inserts an `events` row with `source = 'meeting'` + `source_meeting_id`, and copies every `meeting_availability` vote of `yes`/`if_need_be` on the winning slot into `event_attendance` as `going`/`maybe` with **`confirmed = false`**. `'no'` voters get **no row** (declining one candidate slot isn't declining the event).

- The roster tags an unconfirmed name with a quiet **"(hasn't confirmed)"** (see `RosterGroup` in `EventSheet.tsx`) — visible to whoever's planning, ignorable for everyone else.
- It also auto-queues one `scheduled_broadcasts` row 14 days before the start (at 09:00 America/Chicago, skipped if that's already past) with `payload.onlyUnconfirmed = true`; `run_scheduled_broadcasts()` reads that flag and **restricts** (not excludes) the send to people with no attendance row or one with `confirmed = false`.
- ⚠️ `confirmed` is `not null default true`, so **every normal RSVP is `true`** — decode it as a plain `Bool` with no optionality, and only render the tag when it's `false`.
- ⚠️ See §A4: reconfirming is currently broken server-side. Build the UI (re-tap clears the tag) but expect it not to stick until the migration lands.

### A7. Event-targeted broadcast filtering (0096 / 0127)

An admin can link a Home callout, a banner alert, or an Activity-tab notification to an event with *"only show to people attending"* (default **on** once an event is picked). The rule is deliberately narrow and lives in [lib/eventTargeting.ts](lib/eventTargeting.ts):

> Hide it **only** from someone who explicitly RSVP'd "Can't make it". A no-response member (or Going/Maybe) still sees it — they might still come, and seeing it could nudge them to RSVP.

Two halves, and iOS needs both:

- **Client-side** for anything rendered live from a row — Home callouts and the announcement banner. `home_callouts` / `announcements` just carry `event_id text` + `exclude_not_attending boolean not null default true`; the client runs `isHiddenForEventTarget(mine, eventId, excludeNotAttending)` against the viewer's own RSVP map. **Port that function** — three lines, and without it an iOS viewer sees callouts web hides.
- **Server-side** for anything persisted per-recipient: `send_broadcast_notification(p_title, p_body, p_url, p_audience, p_expires_at, p_event_id, p_exclude_not_attending)`. iOS already collects the target per `docs/ios-parity-2026-07.md` — **verify it passes both trailing params**. (`p_audience` ∈ `everyone | admins` since 0100 dropped `beta`.)

There's a third half **iOS never touches**: [0127](supabase/migrations/0127_event_targeted_email.sql) dropped the 1-arg `alert_recipients(text)` and recreated it as `alert_recipients(audience text, p_event_id text, p_exclude_not_attending boolean)` — **service-role only** — so the mac mini's `alert-mailer.js` also skips `not_going` members on the *email* copy of an event-linked banner. Nothing to port; just don't be surprised that the same rule exists in a third place.

⚠️ `event_attendance.status` is *always* the rolled-up value (the client keeps it in sync even for day-RSVP events), which is why a plain `status = 'not_going'` check server-side is equivalent to `effectiveStatus()`. Don't add day-awareness to the server rule.

### A8. Reminders, and the `start_time` anchor

`events.start_time time` (nullable, [0101](supabase/migrations/0101_event_reminders.sql)) exists **only** to give the reminder picker something to count back from. With it set, offsets can be hour-based ("2 hours before"); without it, day-based offsets default to firing at 9am, and with no anchor at all `ReminderScheduler` falls back to an absolute date/time picker.

- A reminder is **not a new system** — it's a `scheduled_broadcasts` row tagged with `payload.sourceType='event'` / `sourceId` / `sourceLabel`, fired by a `pg_cron` tick inside Postgres (every minute, `run-scheduled-broadcasts`; works with every app closed, mini asleep).
- ⚠️ `ReminderScheduler` is mounted **only when editing an existing event** (`event?.persisted`) — a brand-new unsaved event has no id to attach a queued row to. Same constraint on iOS: save first, then reminders.
- Decode `start_time` from Postgres `time` as a **String** and slice to `HH:mm` (`r.start_time.slice(0,5)` on web). It is not a `Date`.

### A9. Events ↔ work items

`event_work_items(event_id text, work_item_id uuid, added_by, added_at)`, PK `(event_id, work_item_id)`. `event_id` is **TEXT, not a FK** — same reason as attendance: seed events must be linkable.

- Read: `event_work_items` embed `work_items(*)`, filtered by `event_id`. Public-read on the link table, approval+house-gated on `work_items`, so **filter out null embeds** (web does `.filter(Boolean)`).
- Write: `sync_event_work_items(p_event_id, p_item_ids)` replaces the whole set atomically (admin); `add_work_item_to_event(p_event_id, p_work_item_id)` is purely additive and open to any member.
- `EventSheet` renders the list to everyone but shows "+ Add" only to admins.

### A10. Data flow, optimistic writes, realtime — the parts worth copying

`useEvents()` in [lib/hooks.ts](lib/hooks.ts) is the single implementation Home and `/events` share. Behaviors to reproduce in a Swift `EventsService` / `@Observable` store:

- **Three parallel fetches** on reload: `fetchEvents()`, `fetchAttendance()` (all rows, for the counts), `fetchMyAttendance(asUserId?)`.
- **Per-event in-flight lock**: a second tap on the same event's control *awaits the existing write* rather than firing a second RPC that could settle out of order. `AttendanceControl` also disables its buttons while saving.
- **Optimistic `mine` + a separate `countShift` nudge.** The optimistic write updates the viewer's own row instantly *and* nudges only the numeric tally (`from` bucket −1, `to` bucket +1), leaving the name lists alone until the real rows land — otherwise the counts visibly lag a beat behind the tap. `countShift` is cleared on every successful reload.
- **Rollback on failure**, not silent swallow: on an RPC error it restores the previous `mine` row (or removes it) and drops the count shift, and `AttendanceControl` shows an inline "Couldn't save — try again."
- **Stale-while-revalidate snapshot, in two layers.** `useEvents` remounts on every tab navigation, so it holds the last `{events, rows, mine}` in a module-level cache *and* persists it under `events.<uid|guest>` (`lib/swrCache`, 200KB cap) — restored in a post-mount effect only (never during SSR), rewritten after every successful reload, and **never written while previewing as someone else**. Without it Home and `/events` blank out and pop back in on every visit. ⚠️ The key **must** include the account: `mine` is the viewer's own RSVPs, and a shared cache key hands one member's private rows to the next person who signs in on that device.
- **Realtime**: one channel on `public.events` + `public.event_attendance` (both `replica identity full`, both published), **debounced 250ms**, calling a full reload. Only the full `/events` screen subscribes; Home loads once.
- ⚠️ **"Is this mine?" must resolve through the effective user id** (`previewAsId ?? userId`), and **every write must no-op while previewing**. If iOS has an admin "View as", `fetchMyAttendance` takes an explicit `asUserId` for exactly this — never let the seam resolve the session itself.

### A11. What to audit in the iOS repo (it has `EventsView`/`EventsService`/`EventComposer` already)

Verify each of these in `mlr-app-ios`; the web version has grown a lot since the native one was written:

- Does the merge include the **seed array + slug dedup**, or does it only read the table? (4th of July / Family Fest presence is the tell.)
- Is `p_start_time` passed on create **and** update? Is `startTime` decoded and shown?
- Does it send **all four** `set_event_attendance` keys (§A4)?
- Is `confirmed` decoded, and is the "(hasn't confirmed)" tag rendered?
- Is `source = 'meeting'` handled (it's a new enum value — an exhaustive Swift `enum` without it will fail decoding; use a `default` case)?
- Per-day: does the toggle implement the **collapse-to-nil-map on all-days** rule, and the complete-map-on-partial rule?
- Is `hideMaybe` driven off `dayRsvp` on the control *and* the count chips?
- Does the roster have the **per-day filter pills** (Everyone + one per day, each with its going count)?
- Guest/unverified: does it show a lock affordance rather than a false "No RSVPs yet"? (`EventCard`, `EventSheet`, and the per-day chip counts all suppress the number.)
- Are **declined** events tucked into a collapsible "Can't make it (N)" group, and dropped from Home entirely? Are **past** events in their own collapsed group?
- Does the Home spotlight also **drop Family Fest while the fest takeover is live**? `UpcomingEvents` filters `kind !== "family_fest"` when `ffSeason?.isTakeover`, on top of the `not_going` filter — skip it and the fest shows up twice on Home during fest season.
- Is the `?open=<eventId>` deep link handled (that's where `finalize_meeting_as_event`'s notification points: `/events?open=<uuid>`)?
- Are **work items** shown in the event sheet?
- Is the `event_rsvp` category present in the notification-prefs and push-toggle screens? The **in-app** kind is ON in the `notif_types` default (added by 0046 and carried by every later default rewrite) but was **never backfilled** onto members who signed up before that; the **push** category is genuinely opt-in — `event_rsvp` is a `PushType` and is in `apns-sender.js`'s `PUSHABLE` set, but it is deliberately absent from `DEFAULT_PUSH_TYPES` (0036: a popular event would otherwise spam the resort).
- Does the Events tab also host the two features in §A14, or does it show only the calendar?

### A12. Where iOS can beat the web app — Events

- **Real `EKEventStore` export.** The web app's Google-Calendar feed is still a deferred stub (`fetchGcalEvents()` returns `[]`). Native can offer **"Add to Calendar"** on any event — write an `EKEvent` with the title, `startDate`/`endDate` (all-day when `start_time` is nil), location and notes. That's the single highest-value native win here and it needs zero backend work.
- **Local notifications as a belt-and-braces reminder.** The server cron only fires what an admin scheduled. A member could set their *own* private reminder via `UNCalendarNotificationTrigger` — no rows, no permissions, works offline.
- **Actionable push.** A `UNNotificationCategory` with **Going / Maybe / Can't make** actions on the `event_rsvp` and `broadcast`-with-event pushes lets someone RSVP from the lock screen; a `UNNotificationServiceExtension` can call the RPC. Web push cannot do this.
- **Widget + Live Activity.** A small "Up next Up North" widget (nearest event + relative day + your RSVP) is exactly Home's spotlight card, always on the home screen. During the live fest week, a Live Activity showing "Day 3 of 7" is a genuinely better version of the `FestStatus` takeover.
- **Haptics + confetti already have a spec**: `AttendanceControl` fires `haptic("success")` and confetti only on a *fresh* going (not a re-tap of the same choice) — mirror that with `.success` notification feedback, and `.light` on any other change.
- **Offline calendar.** `events` is public-read and tiny; cache it in SwiftData (the native home for §A10's persisted snapshot) and the calendar is fully browsable with no network, RSVPs queued for replay.
- **Handoff / Shortcuts.** "Hey Siri, am I going to the work weekend?" is a one-parameter App Intent over data already in memory.

### A13. Codable shapes — Events

```swift
struct ResortEvent: Decodable, Identifiable {
    let id: String              // uuid-as-string OR a seed slug — NEVER UUID
    let slug: String?           // nil for admin-created rows; the merge key
    let kind: String            // family_fest|work_weekend|holiday|custom — decode as String, switch with a default
    let title: String
    let emoji: String?
    let description: String?
    let location: String?
    let startDate: String       // "YYYY-MM-DD" — keep as String
    let startTime: String?      // "HH:MM:SS" from pg `time`; slice to HH:mm
    let endDate: String?        // nil ⇒ single-day
    let dayRsvp: Bool
    let source: String          // admin|gcal|meeting
    var isPersisted: Bool       // set by the mapper: true for DB rows, false for seed
}

struct EventAttendanceRow: Decodable {
    let eventId: String
    let userId: String
    let status: String                    // going|maybe|not_going
    let days: [String: String]?           // ISO day -> status; nil for whole-run
    let confirmed: Bool                   // not-null default true
    let profiles: ProfileLite?            // embedded display_name + avatar_url
}
```

⚠️ The embedded `profiles` relation comes back as **an object or an array** depending on how PostgREST resolves the FK — both `lib/events.ts` and `lib/cabins.ts` defensively handle both. In Swift, decode with a custom `init(from:)` that tries the object then the single-element array, or you'll get intermittent `typeMismatch` failures that look like a server change.

⚠️ **Never build a `Date` from a bare `"YYYY-MM-DD"`.** `ISO8601DateFormatter` and `Date(...)`-style parses treat it as **UTC midnight**, which renders as the *previous day* in Central. This exact bug labeled every fest sign-up slot a day early across the entire web UI, and — because the same bad label was feeding a picker — it **corrupted 10 stored rows** before anyone noticed (see the 0168 incident in `CLAUDE.md`). Use `DateComponents` + a `Calendar` with an explicit `TimeZone`, or keep dates as strings and compare them lexicographically (which is what every helper in `lib/events.ts` does).

### A14. Two other features live on the same screen — don't ship a calendar-only Events tab

`app/events/page.tsx` is not just the calendar. Both of these are separately specced (see their own sections), but the **iOS Events screen has to host them** or they have no entry point at all:

- **Family date polls (0122).** `MeetingSection` with `scope: { type: "family" }` renders near the top for every signed-in member (vote), and an admin-only **"📅 Propose dates"** button (`fetchCanOrganize({type:"family"})`) opens `MeetingComposer`. Finalizing one is what produces the `source = 'meeting'` events + unconfirmed RSVPs in §A6, and `?meeting=<id>` deep-links into it.
- **Private activities (0150).** An always-visible **"🎉 Create an activity"** button (guests get `promptSignIn()`), a **"Your activities"** list from `usePrivateActivities()`, a collapsed **"Finished & archived (N)"** disclosure, `PrivateActivityComposer` / `PrivateActivitySheet`, and the `?activity=<id>` deep link. These are member-created, **invite-only** get-togethers visible only to the people they're shared with — a completely different visibility model from the admin-managed `events` table, so don't try to fold them into `ResortEvent`.

---

## PART B — Cabin stays

### B1. Vocabulary and shape

`public.cabins` is the roster of **bookable places** — started as the resort's two shared houses, now an open-ended admin-managed list that includes private family houses. `public.cabin_bookings` is one stay request.

⚠️ **`check_out` is the DEPARTURE date and is EXCLUSIVE.** A stay occupies the nights `[check_in, check_out)`; `nights = check_out - check_in`; the DB enforces `check (check_out > check_in)`. "All Family Fest Days" = `check_in = FAMILY_FEST.startDate`, `check_out = endDate + 1` — with today's dates (`2026-07-26` → `2026-08-01`) that's `FF_CHECK_IN = 2026-07-26`, `FF_CHECK_OUT = 2026-08-02`, **7 nights**. Both constants are in [lib/cabins.ts](lib/cabins.ts) and derive from `FAMILY_FEST`, so never hard-code either the dates or the night count (migration 0032's header still says "5 nights" from when the fest ran 7/27–8/1 — it's stale). Getting the exclusivity off by one silently over- or under-books the last night, and the capacity math will look mysteriously wrong.

Key columns beyond the obvious:

- `cabins`: `kind text not null default 'cabin' check (kind in ('cabin','house'))` — **a display badge only**, no booking behavior differs; `approver_user_id uuid` (null = all app admins); `bed_count int` (informational — relabeled "extra beds outside the bedrooms" once the place has named rooms); `notes text` (free-form, shown to members); `active boolean`; `sort_order int`; `room_count int` (the pre-rooms capacity number).
- `cabin_bookings`: `status pending|approved|denied|cancelled`, `guests int`, `notes`, `review_note`, `reviewed_by/at`, `booked_by` (which admin placed it on someone's behalf), `request_notify boolean not null default true`, and **four email-claim columns** — `decision_email_sent_at`, `edit_notify_requested_at`, `edit_email_sent_at`, `cancel_email_sent_at`, `cancelled_by`.

### B2. RLS read rules — one sentence each

| Table | Read rule | An empty result means |
|---|---|---|
| `cabins` | **Public** (`using (true)`) — browse-first, no PII; explicitly left public by 0081 and 0183. | Genuinely no places (or none `active`, if you filtered). |
| `cabin_rooms` | **Public** (`using (true)`, 0092). | This place has no named rooms → **use the plain room-count flow**, not an error. |
| `cabin_bookings` | `user_id = auth.uid() **or** is_cabin_approver(cabin_id)` (0114). | You have no bookings *and* you approve nothing. Not "the queue is empty" unless you know you're an approver. |
| `cabin_booking_rooms` | Follows the parent booking's rule (0114). | Same. |
| `cabin_messages` | `is_cabin_approver(cabin_id)` (0120). | You don't run that place. |

There are **no INSERT/UPDATE/DELETE policies on `cabin_bookings` or `cabin_booking_rooms` at all** — every write goes through a SECURITY DEFINER RPC so capacity + authorization live in one place. A direct table write from Swift will fail, by design.

`cabins` / `cabin_rooms` writes *are* direct table writes, gated on `profiles.is_admin` (0089 update / 0114 insert / 0092 `cabin_rooms: admin write` FOR ALL). ⚠️ **That means a per-place approver who is not an app admin can review bookings for their place but CANNOT edit the place or its rooms** — `AdminCabinDetails` is `isAdmin`-gated on web to match. Don't offer that editor to an approver on iOS; the writes would just be denied.

⚠️ **Realtime**: `cabin_bookings`, `cabin_booking_rooms`, `cabin_messages` **are** published; `cabins` and `cabin_rooms` are **not**. Places and rooms must be refetched manually after an edit.

### B3. Canonical RPC signatures

```
request_cabin_stay(p_cabin uuid, p_check_in date, p_check_out date, p_guests int,
                   p_notes text, p_for_user uuid, p_room_ids uuid[],
                   p_notify boolean) → uuid                                  -- 8 args (0115)

review_cabin_stay(p_booking uuid, p_approve boolean, p_note text,
                  p_notify boolean) → void                                   -- 4 args (0104→0114)

cancel_cabin_stay(p_booking uuid, p_notify boolean) → void                   -- 2 args (0109→0114)

admin_update_cabin_booking(p_booking uuid, p_check_in date, p_check_out date,
                           p_guests int, p_notes text, p_notify boolean) → void   -- (0095→0105→0114)

set_booking_rooms(p_booking uuid, p_room_ids uuid[]) → void                  -- (0092→0106→0114)

cabin_availability(p_check_in date, p_check_out date)
  → TABLE(cabin_id uuid, slug text, name text, room_count int, available int,
          beds_total int, beds_available int)                                -- 7 cols (0111)

cabin_room_availability(p_cabin_id uuid, p_check_in date, p_check_out date)
  → TABLE(room_id uuid, name text, beds int, description text,
          active boolean, available boolean)                                 -- 6 cols (0094)

create_cabin(p_name text, p_kind text, p_room_count int, p_bed_count int,
             p_notes text, p_approver_user_id uuid) → public.cabins          -- admin only (0114)

is_cabin_approver(p_cabin_id uuid) → boolean                                 -- (0114)

send_cabin_message(p_cabin uuid, p_subject text, p_body text,
                   p_email boolean) → int (recipient count)                  -- (0120)
```

Service-role only (the mac mini; iOS must never call these): `cabin_booking_notification(p_booking)`, `cabin_message_recipients(p_message)`.

⚠️⚠️ **INCIDENT — `request_cabin_stay` once had TWO coexisting 7-arg overloads, and one parameter was silently ignored for months.** [0092](supabase/migrations/0092_cabin_rooms.sql) added `(…, p_for_user, p_room_ids uuid[])`; [0108](supabase/migrations/0108_cabin_request_notify_toggle.sql) meant to layer `p_notify` on top but instead defined a *separate* `(…, p_for_user, p_notify boolean)` and only dropped the older 6-arg form. Both 7-arg versions lived side by side. Because the client always sent `p_room_ids` and never `p_notify`, every call resolved to 0092's overload — whose INSERT never mentions `request_notify` — so **any "don't notify" intent had never once taken effect**, silently falling back to the column default of `true`. [0115](supabase/migrations/0115_request_cabin_stay_dedupe.sql) merged both feature sets into the single canonical **8-arg** function and dropped both strays.

**The invariant to verify is "exactly one function", not "the client sends eight keys":**
```sql
select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'request_cabin_stay';
```
Expect exactly one row. If you ever see two, stop and fix the DB before writing client code. For reference, web's `requestStay()` sends **seven** named keys — `p_cabin, p_check_in, p_check_out, p_guests, p_notes, p_for_user, p_room_ids` — and omits `p_notify` entirely, letting the DB default (`true`) apply; that's fine now that only one function exists, and iOS matching those seven keys (or all eight) is equally fine. What is *not* fine is inventing a subset that could match some future resurrected overload, which PostgREST would report as a perfectly ordinary success. (Also note: `revoke all … from public, anon` on all of these — an anonymous call is a permission error, not an empty result.)

Swift call shapes: `p_room_ids` is `[String]?` — pass `nil` (web sends null when the set is empty). `p_days`-style jsonb doesn't appear here. `create_cabin` returns a **single object** (a `public.cabins` composite), not an array. `send_cabin_message` returns a bare **Int**. The `void` ones return no body.

### B4. 🛠️🚩 `review_cabin_stay` has LOST its per-room capacity check — verify this before trusting approval

[0092](supabase/migrations/0092_cabin_rooms.sql) gave `review_cabin_stay` a two-branch capacity guard: a booking **with rooms attached** was checked per-room against other approved bookings of the *same* room; one with none fell back to the original cabin-wide `room_count` math.

[0104](supabase/migrations/0104_cabin_review_email_toggle.sql) then recreated the function to add `p_notify` — **from the 0032 body**, not 0092's. The per-room branch vanished. [0114](supabase/migrations/0114_cabin_places_kind_approver.sql) recreated it again (to widen the gate to `is_cabin_approver`) carrying 0104's already-regressed body forward. So the live 4-arg function runs **only** the cabin-wide `room_count` check.

Why it matters concretely: `request_cabin_stay` and `set_booking_rooms` both check room overlap against **approved** bookings only. Two members can each request the *same* named room for overlapping nights while both are pending; both pass. The approver approves the first, then the second — 0092's per-room branch would have refused it, but the surviving cabin-wide check compares against `cabins.room_count` (4 for Red & White House, which has 5 named rooms), so **the double-booking is accepted**. The two guests find out on arrival.

- **Verify first**, don't assume: `select pg_get_functiondef(oid) from pg_proc where proname = 'review_cabin_stay';` and look for `cabin_booking_rooms`.
- This is a **server-side** fix (restore 0092's room branch inside 0114's gate + `p_notify` body, recreated from the current production definition). iOS should not try to compensate client-side — but the iOS approval UI should surface the RPC's thrown message verbatim, which is the only place a capacity refusal appears (`'% is already booked for one or more of those nights'`, `'No rooms left in % for one or more of those nights'`).
- Same lesson, third time in this codebase: **never `create or replace` one of these functions from an older migration's copy-pasted body.** Always start from `pg_get_functiondef` on production.

### B5. Named rooms and per-room availability

`cabin_rooms(id, cabin_id, name, beds, description, active, sort_order)`, unique on `(cabin_id, name)`. `cabin_booking_rooms(booking_id, room_id)` — **a booking may reserve more than one room** (one room per bed needed: *"Need 2 beds? Pick 2 rooms."*).

- ⚠️ **A place with ZERO `cabin_rooms` rows keeps the original plain room-count flow, untouched.** This is additive, never a replacement. `hasRooms = rooms.count > 0` is the branch in `CabinRequestSheet` — and an empty `cabin_room_availability` result means *"no named rooms"*, not an error.
- **A named room is an exclusive-claim unit regardless of its own `beds` count.** `cabin_room_availability` marks a room fully unavailable the moment *any* approved booking overlaps it. `beds_available` therefore sums the `beds` of the rooms that are still *entirely* open.
- **`cabin_availability` derives `room_count`/`available` from `cabin_rooms` whenever any exist** for that place (falling back to the manual `cabins.room_count` otherwise), so the two can't drift once rooms are defined. `beds_total`/`beds_available` are **nil** for a place with no named rooms — that's the signal to fall back to `cabins.bed_count` for display (exactly what `CabinCard` does).
- **An approved booking with NO room picked still consumes a slot** ([0108](supabase/migrations/0108_cabin_availability_unassigned_bookings.sql)): the room-based branch subtracts one per approved, room-less, overlapping booking — and 0111 subtracts one bed for it too. Before that fix a place could read "4 of 4 rooms left" with a real guest already coming.
- ⚠️ **Closing a room (or a whole place) only blocks NEW picks.** `cabin_room_availability`, `request_cabin_stay` and `set_booking_rooms` all gate on `active`, but none of them touch existing `cabin_booking_rooms` rows — so a room can be closed to future bookings without disturbing anyone already in it. Don't add a cleanup step.
- ⚠️ **When editing an existing booking, a room it already holds comes back `available: false`** (it's blocked by *this very booking*). `EditBookingSheet` patches it locally before rendering: `rooms.map { selected.contains($0.roomId) ? $0.with(available: true) : $0 }`. Skip that and an admin can never re-save a booking without dropping its own room.
- ⚠️ **`set_booking_rooms` deletes all existing links unconditionally before inserting.** Passing `nil` or `[]` **clears** the assignment — it is not a no-op. That's the documented way to un-assign, but it will surprise you.
- `CabinRoomPicker` is one shared component across three call sites (new request, admin edit, member self-pick). Build the SwiftUI equivalent once; it renders name, `🛏️ N beds`, the `description` line, and a status of *"Temporarily closed"* (`!active`) vs *"Already booked"* (`!available`), disabling a row only when `!available && !selected`.

### B6. The per-place approver — and why the queue lives on the *member-facing* screen

`cabins.approver_user_id` null = "all app admins review this place" (the unchanged default). Set to a member, and **that one person** reviews it — critically, **they need not be an app admin** (the intended case is the owner of a private house who has no admin access at all).

`is_cabin_approver(p_cabin_id) → boolean` = *app admin OR that place's named approver*. It is the gate on `review_cabin_stay`, `cancel_cabin_stay`, `admin_update_cabin_booking`, `set_booking_rooms`, **and** the read RLS on `cabin_bookings` / `cabin_booking_rooms` / `cabin_messages`. So a non-admin approver can see and act on requests **for their own place(s) only** — nothing else in the app opens up.

⚠️ **This is why the approval queue must be mounted on the member-facing stay screen, not the admin screen.** `/admin/cabins` stays admin-gated, so web mounts `AdminCabinBookings` on `/request-stay` itself for non-admins (`{!isAdmin && <AdminCabinBookings />}`), and the component computes its own `canManage = isAdmin || (await fetchMyApproverCabinIds(userId)).count > 0`, rendering **nothing** for everyone else. An app admin sees the full queue only in the admin section (all places, not just ones they're named on). Reproduce that split exactly, or a non-admin approver has literally no way to learn a request arrived.

`fetchMyApproverCabinIds(userId)` is a plain select — `cabins.select("id").eq("approver_user_id", userId)` — which works because `cabins` is public-read. You can also call `is_cabin_approver` per place; the list query is one round-trip.

### B7. Booking on behalf of a member (0087)

`p_for_user` on `request_cabin_stay`: an **admin only** may pass another member's id (non-admins may omit it or pass their own — enforced server-side). The booking lands under *that member's* `user_id`, with `booked_by` stamped to the admin, so the queue shows "booked by {admin}" instead of implying the member did it.

⚠️ **The web flow then auto-approves it immediately** — `CabinRequestSheet` calls `reviewStay(id, true, nil, notify)` right after `requestStay` succeeds, rather than leaving it pending for the same admin to approve a second time. The `notify` checkbox ("Email {name} a confirmation") feeds `p_notify` on that review call. If the auto-approve fails (capacity), web keeps the booking as pending and tells the admin so — don't roll back the request.

The member picker is admin-only and lives on the stay screen as a "Booking for / Yourself" row.

### B8. Admin edit, and the four notify toggles (the "claim-a-row" pattern)

The emails are all sent by the mac mini's `alert-mailer.js`, which claims a row atomically. The RPCs therefore **pre-stamp** a timestamp to *suppress* a send rather than calling anything:

| Action | RPC + param | Default | Mechanism |
|---|---|---|---|
| Approve / deny | `review_cabin_stay(p_notify)` | **true** | `p_notify = false` pre-stamps `decision_email_sent_at = now()`, so the mailer's `where decision_email_sent_at is null` finds nothing. |
| Admin edits dates/guests/notes | `admin_update_cabin_booking(p_notify)` | **false** | `p_notify = true` stamps `edit_notify_requested_at`; the mailer claims by advancing `edit_email_sent_at` to match — so **each** edit can independently send or skip. |
| Cancel | `cancel_cabin_stay(p_notify)` | **true** | Pre-stamps `cancel_email_sent_at` whenever the **requester cancels their own** stay (nothing to tell them) or `p_notify = false`. An admin cancelling *someone else's* stay is the only case left for the mailer. |
| New request → notify admins | `request_cabin_stay(p_notify)` | **true** | Different mechanism: `notif_on_cabin_request` fires **synchronously in the same INSERT**, so there's no later row to claim — it needs the real `request_notify` column, which the trigger *and* the mini's push handler both read. |

⚠️ Edit defaults to **off** on purpose (most edits are small corrections and this is an email members have never received before); approve/deny and cancel default to **on**. Preserve those defaults — they're a product decision, not an accident.

⚠️ There is **no UI wired to `request_cabin_stay(p_notify)` or `cancelStay(notify:)` on web** — both are plumbing-only escape hatches (the former exists so a real SQL/RPC test booking doesn't spam every admin; note `requestStay()` doesn't even send the key). Don't invent checkboxes for them on iOS without asking.

**What the queue actually looks like** (`AdminCabinBookings`, mounted at both `/admin/cabins` and — for non-admins — `/request-stay`): two sections, **"Pending (N)"** and **"Upcoming stays (N)"** (the approved roster). A pending row shows the requester, place, stay, `booked by {admin}` when set, the member's own `notes` in quotes, then:

- a free-text input placeholdered *"Optional note (included in their email)"* → `p_note` → `cabin_bookings.review_note` (this is the only channel for "sorry, the upstairs room is already taken" — the requester sees it on their own booking row and in the decision email),
- an **"Email them a confirmation"** checkbox (default checked) → `p_notify`,
- **Approve / Deny / Cancel** buttons plus an **Edit** link into `EditBookingSheet`.

An **approved** row in "Upcoming stays" keeps **Edit** and **Cancel**. Port all of it — an approver with no cancel and no note has to fall back to the web app.

`admin_update_cabin_booking` edits **dates, guests, notes only** — not rooms (that's `set_booking_rooms`) and not status. `EditBookingSheet` calls both in sequence so the whole request is editable in one sheet, and it works on a **pending or already-approved** booking. Capacity is still only enforced at `review_cabin_stay()` time, so an admin *can* edit an approved booking into a conflict — accepted behavior, not a bug to fix client-side.

### B9. Messaging the current guests of a place (0120)

`send_cabin_message(p_cabin, p_subject, p_body, p_email) → Int`. Gated on `is_cabin_approver(p_cabin)`. Recipients are the **distinct members with an APPROVED booking whose stay hasn't ended** (`check_out >= current_date`). Body max 2000 chars, subject optional. It inserts a `cabin_messages` log row and fans out a `cabin_message` in-app notification via `_notify` (which honors each member's pref and skips the sender), returning the count so the UI can say *"Sent to 4 guests staying at Red & White House."* (The returned number is the distinct-guest count minus the sender — not a delivery receipt, since `_notify` still drops anyone who turned the kind off.)

- The `p_email` checkbox queues the optional email; the mini's `handleCabinMessage` uses the service-role `cabin_message_recipients(p_message)` RPC and BCCs. That path **does** respect `profiles.email_alerts` (unlike the transactional approve/deny/edit/cancel emails, which override it) — the web copy says so: *"Only reaches guests who have email alerts on."*
- The button lives at the top of the queue component, so **both** admins and non-admin approvers get it. If the viewer runs exactly one place, auto-select it and hide the picker (`fetchManageableCabins(userId, isAdmin)`: all places for an admin, else the ones where `approver_user_id = me`).
- Count `0` is a success state, not an error: *"Message saved — no one has an upcoming stay there right now."*

### B10. Notifications and pushes

| Kind | Audience | In-app default | Phone push |
|---|---|---|---|
| `cabin_request` | every app admin + the place's named approver (if not already an admin) | **on** (row is `adminOnly` in prefs) | 🛠️ **web push only — nothing on iOS** |
| `cabin_decision` | the requester, on `pending → approved/denied` | **on** | yes, in `DEFAULT_PUSH_TYPES` and in both senders' pushable sets |
| `cabin_message` | current + upcoming approved guests | **on** (0120 added it to the `notif_types` default *and* backfilled every existing profile) | yes, in `DEFAULT_PUSH_TYPES` |
| `event_rsvp` | everyone with the kind on, minus the actor; **only on a fresh transition into `going`** | **on in the `notif_types` default since 0046, but never backfilled** onto earlier members | opt-in (a `PushType`, and in APNs' `PUSHABLE`, but *not* in `DEFAULT_PUSH_TYPES`) |

⚠️ `cabin_request`'s prefs row is `adminOnly: true` in `NotifPrefs`, so a **non-admin approver receives the notification** (the DB default puts `cabin_request` in everyone's `notif_types`) **but has no toggle for it anywhere**. Match that, or decide deliberately to show the row to approvers too — don't accidentally hide the notification instead.

🛠️⚠️⚠️ **`cabin_request` never reaches an iPhone.** `notif_on_cabin_request` (a trigger) writes the in-app rows, but the **push** comes from a bespoke `handleCabinRequest()` in [media-server/push-sender.js](media-server/push-sender.js) that subscribes to `cabin_bookings` INSERT directly — because a cabin request predates the generic feed relay. `apns-sender.js` subscribes only to `committee_messages`, `house_messages`, `announcements`, `notifications` and `profiles`; `cabin_request` is not in its `PUSHABLE` set and there is no `cabin_bookings` listener. So an iOS-only admin or approver learns about a new request only by opening the app. Fix is a mac-mini change (mirror `handleCabinRequest` into `apns-sender.js`, honoring `request_notify`, the `status !== 'pending'` skip, and the `cabin_request` entry in `notif_types` exactly as the web sender does, including the non-admin approver) plus a `git pull` + `launchctl kickstart -k`. ⚠️ Note `cabin_request` is a **`NotifType` but not a `PushType`** — the web handler gates on `notif_types`, not `push_types`; match that, don't invent a new push category.

🛠️⚠️ **Deep links — and a second clobbered fix.** [0091](supabase/migrations/0091_admin_notif_deep_links.sql) deliberately changed the `cabin_request` notification url from `/profile` to **`/admin/cabins?booking=<id>`** so an admin could act on the tap, and `AdminCabinBookings` still reads `?booking=` to scroll to and flash-ring that request. But [0108](supabase/migrations/0108_cabin_request_notify_toggle.sql) recreated `notif_on_cabin_request` **from the 0033 body** (to add the `request_notify` early-return) and reverted the url to `/profile`; [0114](supabase/migrations/0114_cabin_places_kind_approver.sql) carried that forward. Live today: admins get `/profile`, the named approver gets `/request-stay`. **Verify with `pg_get_functiondef` before building the iOS route table**, and don't "fix" it client-side by pattern-matching `/profile` — that url is also legitimately used elsewhere. The durable fix is one more recreate, from production. Other links: `cabin_decision` → `/request-stay`, `cabin_message` → `/request-stay`, `finalize_meeting_as_event` → `/events?open=<uuid>`, `event_rsvp` → `/events`.

### B11. Date math — a genuine trap sitting in `lib/cabins.ts`

`addDays()` and `todayISO()` in `lib/cabins.ts` build a local-midnight `Date` and then do `.toISOString().slice(0,10)`. In a **negative**-offset zone (Central — everyone who uses this app) that round-trips correctly. In a **positive**-offset zone it returns the **previous day**. `lib/events.ts` explicitly avoids this by re-serializing with `toISODate()` (a local `getFullYear/getMonth/getDate`) and says so in a comment. The web app never trips it only because the family is all in the States.

⚠️ **Do not port the `toISOString` version.** In Swift, do all date arithmetic with `Calendar.current.date(byAdding: .day, …)` and format with a `DateFormatter` pinned to `"yyyy-MM-dd"`, `Locale(identifier: "en_US_POSIX")` and an explicit `TimeZone` — then a member who opens the app from Europe still sees the right nights. And see the §A13 warning: this codebase has already lost 10 rows of real data to a `YYYY-MM-DD` parse.

Port `nights(checkIn, checkOut)`, `formatStay` (`"Jul 26 → Aug 2 · 7 nights"` for the current fest window) and `ffNights()` as string-based helpers.

### B12. What to audit in the iOS repo (cabins are the *most* complete area already)

Per `docs/ios-parity-2026-07.md`, native already has `set_booking_rooms`, `PickMyRoomSheet`, `AdminCabinDetails`, book-on-behalf and the email toggles. Verify in `mlr-app-ios`:

- Does `requestStay` use the canonical function — the same key names web sends (`p_cabin, p_check_in, p_check_out, p_guests, p_notes, p_for_user, p_room_ids`), plus `p_notify` only if you actually wire the escape hatch? And does `pg_proc` still show exactly one `request_cabin_stay`? (§B3)
- Does the `Cabin` model carry `kind` and `approver_user_id`? Is the *"🏠 Private house"* badge rendered for `kind == "house"`?
- Is there a `create_cabin` path ("＋ Add a place") and an approver picker in the places editor? Both were listed as **missing**.
- Is `CabinMessageSheet` / `send_cabin_message` present? Listed as **missing**.
- Does the queue's `canManage` = `isAdmin || approvesSomething`, and is it mounted on the **member-facing** stay screen for non-admins? Listed as **missing**.
- Does the queue have **both** sections — "Pending (N)" *and* the "Upcoming stays (N)" approved roster — with the optional **review note** input, the notify checkbox, and **Cancel** on both pending and approved rows? (§B8)
- Does `cabin_availability` decoding handle the **7-column** shape (`beds_total`/`beds_available`, 0111) and treat nil as "fall back to `cabins.bed_count`"?
- Does the request sheet have the **"Not sure yet"** skip, and does the member's own booking row offer **"Choose your room"** (`set_booking_rooms`, widened to the requester by 0106) when `rooms.isEmpty && cabin has named rooms && status ∈ {pending, approved}`?
- Does `EditBookingSheet`'s equivalent apply the **available-override for already-held rooms** (§B5)?
- Are the notify checkboxes wired to the right defaults (approve **on**, edit **off**)?
- Is `cabin_message` in the notification-prefs and push-toggle lists? It was added *and backfilled* by 0120, so every existing member already has it on.
- Realtime: is the member's own list filtered (`user_id=eq.<uid>`) and the queue unfiltered? Note that **neither is debounced on web** — `/request-stay`'s `my-cabin-bookings-<uid>` channel and `AdminCabinBookings`' `admin-cabin-bookings` channel both call `load()` directly; the 250ms debounce lives only in `useEvents`. Debouncing on iOS is fine, just don't go hunting for a web equivalent.
- `previewAsId`: does `fetchMyBookings` accept an explicit user id, and do writes no-op during preview?

### B13. Where iOS can beat the web app — cabins

- **A real date-range picker.** The web sheet is two `<input type="date">` boxes with a manual "check-out must be after check-in" error. A native two-month `MultiDatePicker`/range calendar that shows **per-night availability inline** — the data is already there via `cabin_availability` per range, and `ffNights()` gives you the fest window's nights (it's exported but currently unused on web, so it's yours) — turns the app's single most fiddly form into its nicest one. This is the standout native win in this section.
- **Actionable approve/deny push.** A `UNNotificationCategory` with **Approve / Deny** on `cabin_request` (once §B10 ships the APNs path) lets the person who owns a private house clear their queue from the lock screen. That's the exact user for whom opening an app is the friction.
- **Calendar + Wallet-shaped stay card.** Write the approved stay to `EKEventStore` as an all-day multi-day event ("Red & White House — Upstairs South Room"), and surface it as a Live Activity / widget while it's current.
- **Map + directions** from the place's `notes`/name, and a share sheet for the gate code from a `cabin_message`.
- **Offline read.** `cabins` and `cabin_rooms` are public-read, tiny, and *not* realtime — so they're perfect SwiftData cache candidates; the whole "places to stay" browse works with no signal, which matters at a lake in Tomahawk.
- **Rich guest message.** Deliver `cabin_message` with the place name as the notification **subtitle** and the body as a long-form `UNNotificationContent` — a "water's off this weekend" note is readable without opening anything.

### B14. Codable shapes — cabins

```swift
struct Cabin: Decodable, Identifiable {
    let id: String
    let slug: String
    let name: String
    let kind: String                 // "cabin" | "house" — display badge only
    let roomCount: Int
    let bedCount: Int?               // informational; "extra beds" once named rooms exist
    let notes: String?
    let active: Bool
    let sortOrder: Int
    let approverUserId: String?      // nil ⇒ all app admins review
}

struct CabinAvailability: Decodable {
    let cabinId: String; let slug: String; let name: String
    let roomCount: Int; let available: Int
    let bedsTotal: Int?              // nil ⇒ no named rooms → fall back to Cabin.bedCount
    let bedsAvailable: Int?
}

struct CabinRoomAvailability: Decodable {
    let roomId: String; let name: String; let beds: Int
    let description: String?
    let active: Bool                 // false ⇒ "Temporarily closed"
    let available: Bool              // false ⇒ closed OR overlapping approved booking
}

struct CabinBooking: Decodable, Identifiable {
    let id: String
    let cabinId: String
    let cabinName: String?           // embedded cabins(name)
    let userId: String?              // present in the queue query, absent in "mine"
    let bookedBy: String?            // an admin booked this on someone's behalf
    var rooms: [(id: String, name: String)]   // from cabin_booking_rooms → cabin_rooms(name)
    let checkIn: String              // "YYYY-MM-DD"
    let checkOut: String             // DEPARTURE, EXCLUSIVE
    let guests: Int
    let notes: String?
    let status: String               // pending|approved|denied|cancelled
    let reviewNote: String?
    let createdAt: String
}
```

⚠️ Embedded relations (`cabins(name)`, `cabin_rooms(name)`) again come back **object-or-array**; handle both (§A13). ⚠️ `guests` is *informational* — capacity is counted in **rooms**, never guests, so never derive availability from it.

---

## Honest sizing, and a v1 cut

| Chunk | Size |
|---|---|
| Events: seed∪DB merge + calendar + basic RSVP + counts | **M** — mostly already in `EventsService`; audit, don't rebuild |
| Events: per-day RSVP + roster day-filter + unconfirmed tag | **M** |
| Events: admin composer (start_time, day_rsvp, reminders, work items) | **M** |
| Events: targeted-broadcast client filter | **S** |
| Cabins: request/review/cancel/edit + rooms (already largely present) | **M** — audit |
| Cabins: per-place approver + member-facing queue (incl. review note + cancel + upcoming-stays roster) | **M** |
| Cabins: add-a-place + approver picker | **S** |
| Cabins: message guests | **S** |
| 🛠️ `set_event_attendance` overload merge (migration) | **S**, but blocking correctness |
| 🛠️ `review_cabin_stay` per-room guard restore (migration) | **S**, but blocking correctness |
| 🛠️ `cabin_request` APNs handler (mac mini) | **S**, needs a mini restart |
| 🛠️ `notif_on_cabin_request` deep-link restore (migration) | **XS** |

**Suggested v1 cut:** ship Events read + overall RSVP + who's-coming + the per-day picker (that's what people actually use), plus the full cabin **request → approve → confirm** loop including the per-place approver queue. Defer: the event admin composer's reminder scheduler and work-item picker (both reachable on web meanwhile), the "propose dates" family poll entry point (§A14), and cabin place/room *authoring* (an admin can add a place on web; iOS only needs to book into it). Do **not** defer the four 🛠️ backend items — every one of them fails silently, and all four will be blamed on the new client.
