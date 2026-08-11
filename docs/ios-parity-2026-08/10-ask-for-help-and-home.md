<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **9 correction(s)** were applied.

### Ask for Help, presence, and the Home cards

Everything in this section is **already in the shared Supabase project**. There is exactly **one place a backend change would be needed** (geofence-derived presence — see "Where iOS can beat the web app" under Presence), and it is called out explicitly. Everything else is "write Swift against schema that exists."

Read the source of truth before you start: migrations `0037`, `0038`, `0039`, `0046`, `0047`, `0058_help_work_item_followup`, `0059`, `0100` (Ask for Help); `0083`, `0093`, `0096`, `0097`, `0098`, `0101`, `0102`, `0103`, `0122`, `0126`, `0137`, `0172_callout_drop_box_and_fest_album` (callouts + the broadcast tick); `0057` (`can_edit_fest()`'s live body); `0081` + `0183` (the read gates). Web reference implementations: `lib/helpRequests.ts`, `lib/presence.ts`, `lib/eventTargeting.ts`, `lib/calloutCompletions.ts`, `lib/festContent.ts`, `components/HelpRequestsView.tsx`, `components/AskForHelpSheet.tsx`, `components/WillingToHelpToggle.tsx`, `components/CalloutStack.tsx`, `components/CalloutCard.tsx`, `components/HomeSpotlight.tsx`, `components/WhosUpNorthCard.tsx`, `components/WeatherCard.tsx`, `components/BirthdaysCard.tsx`, `components/OnThisDayCard.tsx`, `components/ActivePollCard.tsx`.

---

## 1. Ask for Help

A member who is **at the resort** posts a short request for a hand. Members who (a) opted into **Willing to help** and (b) are **also at the resort today** get an in-app notification + phone push, tap **On my way** (the only response), and everyone sees open requests in a shared log at `/help-requests` (reached from the Home quick-actions grid's **Ask for Help** tile, `HomeQuickActions`). The requester says how many people they need; once that many are on the way the request reads **✅ Covered** and everyone eligible is told so nobody else bothers. `category = 'urgent'` bypasses the whole filter and alerts **every member**.

The log has two sections: **Open requests**, and a **"Recently handled"** tail — the last 10 non-`open` requests as one-line rows (`✅ Resolved` / `✖️ Cancelled`, first name + description). Don't drop the tail; without it a request vanishes the instant someone resolves it.

### 1a. Tables and their read rules (one sentence each — an empty result is usually "not permitted", not "no data")

| Table | Read rule (post-`0183`) |
|---|---|
| `help_requests` | `is_approved_member()` — any **admin-verified** signed-in member sees every request; a guest or an unverified new signup sees **zero rows, no error**. |
| `help_responses` | `is_approved_member()` — same; this is how you learn who is on the way. |
| `help_request_items` | `is_approved_member()` — same; the bring-list. |
| `profiles.willing_to_help` | rides the `profiles` read policy (`is_approved_member() or id = auth.uid()`), so you can always read your own flag. |
| `event_attendance` | `is_approved_member()` — resort-wide RSVPs, the primary presence source. |
| `cabin_bookings` | `user_id = auth.uid() or is_cabin_approver(cabin_id)` — ⚠️ **a plain member sees only their OWN bookings.** |
| `house_stays` | `is_house_member(house_id)` — only your own house's stays. |
| `events` | public (`using (true)`) — guests included, so the event window can be computed before sign-in. |

⚠️ **There are NO client write policies on any of the three help tables.** Every write goes through a `SECURITY DEFINER` RPC. A direct `.insert()` will fail — do not try.

### 1b. The RPCs — real names, real parameter order

Supabase keys RPC arguments **by name**, so a wrong key fails at runtime. These are the live signatures.

```
request_help(
  p_description  text,                -- required, non-empty after btrim
  p_category     text     = null,      -- 'hand'|'move'|'setup'|'ride'|'supplies'|'urgent'
  p_where_text   text     = null,
  p_lat          double precision = null,
  p_lng          double precision = null,
  p_needed_at    timestamptz = null,   -- defaults to now() server-side
  p_needed_count int      = 1,         -- clamped to >= 1
  p_audience     text     = 'present', -- 'present' | 'all_willing'
  p_eligible     text[]   = '{}',      -- the client's live-event snapshot
  p_strict       text[]   = '{}',      -- day-RSVP events on a real event day
  p_today        text     = null,      -- 'YYYY-MM-DD'; NULL raises
  p_expires_at   timestamptz = null,   -- default greatest(now, needed_at) + 6h
  p_items        text[]   = '{}',      -- "what to bring" labels, in order
  p_work_item_id uuid     = null,      -- optional work_items link
  p_followup_at  timestamptz = null    -- "did it get done?" nudge time
) RETURNS TABLE (id uuid, notified int)

respond_to_help(p_request uuid, p_note text = null)      -- "on my way"; idempotent
withdraw_help(p_request uuid)                             -- delete your own response
claim_help_item(p_item uuid, p_claim boolean)             -- toggle a bring-list claim
set_help_status(p_request uuid, p_status text)            -- 'resolved'|'cancelled'|'open'
```

**Return shape:** `request_help` is `RETURNS TABLE`, so PostgREST hands back a **JSON array of one object** — `[{"id":"…","notified":3}]`. In Swift decode `[RequestHelpResult]` and take `.first`, exactly as the web does (`Array.isArray(data) ? data[0] : data`).

⚠️⚠️ **`request_help` almost certainly has TWO live overloads in production, and the older one is BROKEN.** Migration `0046` created a **13-arg** version (…`p_expires_at, p_items`) and dropped only the 12-arg. `0058_help_work_item_followup` then `create or replace`d a **15-arg** version (adding `p_work_item_id, p_followup_at`) — a *different* signature, so it created a **new** function and left the 13-arg one in place, still granted to `authenticated`. `0100` then removed `is_beta_tester()` from the 15-arg version **and dropped the function `is_beta_tester()` entirely** — but the stale 13-arg body still calls it. So:

- If iOS sends the 15-key set the web sends, it resolves to the good function.
- If iOS omits `p_work_item_id`/`p_followup_at`, PostgREST may match the stale 13-arg overload and you get `function public.is_beta_tester() does not exist`, or an ambiguity `300`/`PGRST203`. Either failure looks like "asking for help is just broken."

**Mitigation (no backend change):** always send **all 14 keys the web client sends** — `p_description, p_category, p_where_text, p_lat, p_lng, p_needed_at, p_needed_count, p_audience, p_eligible, p_strict, p_today, p_items, p_work_item_id, p_followup_at` (the web deliberately omits `p_expires_at` and lets the default apply). Pass explicit `null`/`[]` rather than dropping keys — `p_work_item_id`/`p_followup_at` exist only on the good overload, so sending them is what disambiguates. **Verify** first with:
```sql
select oid::regprocedure from pg_proc where proname = 'request_help';
```
If two rows come back, the clean fix is a one-line migration `drop function public.request_help(text,text,text,double precision,double precision,timestamptz,int,text,text[],text[],text,timestamptz,text[]);` — hand the SQL to Brian, do not run it via MCP. This is the same class of bug migration `0115` fixed for `request_cabin_stay`, where two coexisting 7-arg overloads silently made a `p_notify` intent a no-op.

### 1c. Presence WITHOUT geolocation — how "at the resort" is actually decided

A PWA cannot track location in the background, so presence is derived from data the app already has. Two independent halves, and you must build both:

**The client snapshot (`helpTargeting` / `eventTargeting` in `lib/helpRequests.ts`):**
- `EVENT_PRESENCE_GRACE_DAYS = 2`.
- `eligibleEvents(events, today, graceBefore, graceAfter)` = every event where `addDays(startDate, -graceBefore) <= today <= addDays(endDate ?? startDate, +graceAfter)` (defaults: `graceBefore = 2`, `graceAfter = graceBefore`). So a Fri–Sun event is "live" Wed–Tue.
- `eligible` = those event ids. `strict` = the subset that is `dayRsvp && isOngoing(event, today)` (a day-RSVP event on a real event day).
- `eventTargeting(event, today)` is the schedule-ahead variant: `eligible = [event.id]`, `strict = []` unless it is a day-RSVP event happening today.
- `isOngoing(ev, today)` = `ev.startDate <= today && today <= (ev.endDate || ev.startDate)`.
- `effectiveStatus(status, days)` = `"going"` if the overall status is going **or any** day in the `days` map is going; else `"maybe"` if anything is maybe; else `"not_going"`.
- ⚠️ **`amIPresent(mine, events, today, bookingCoversToday)`** is the client mirror of the server's requester gate and the value behind `atResort` in §1g's `canAsk`: `true` if `bookingCoversToday`, else effective-`going` to any `eligibleEvents(...)` entry. **`bookingCoversToday` is a second network read** — `HelpRequestsView` calls `fetchMyBookings(previewAsId ?? undefined)` and looks for `status === "approved" && checkIn <= today && checkOut > today` (half-open, matching the SQL). Skip it and a member whose only presence signal is an approved cabin stay is locked out of a request the **server would have accepted**.

**The server resolver (`_help_recipients`, DEFINER-only, no client grant) — this is what actually decides recipients:**
```
willing_to_help = true
AND id <> requester
AND 'help_request' = any(notif_types)
AND ( audience = 'all_willing'
      OR exists(event_attendance row for one of p_eligible where:
           if event_id in p_strict → (days is null/empty AND status='going') OR days->>p_today = 'going'
           else                    → status='going' OR any day in days = 'going')
      OR exists(cabin_bookings where status='approved' AND check_in <= p_today AND check_out > p_today) )
```

**The requester gate inside `request_help`** mirrors that exactly (day-aware for the strict set) — minus the `willing_to_help` / `notif_types` terms, which apply only to recipients — **plus** an admin bypass (`0038`): an app admin can post from anywhere for test/demo. Everyone else gets `'You can ask for help once you're at the resort — RSVP "going" to a current event first.'`

⚠️ **The server TRUSTS the client's event-window snapshot.** It does not recompute which events are live — it only checks "are you RSVP'd going to one of the ids you handed me." That is deliberate (Family Fest's dates live in `lib/data.ts`, not the DB, and it keeps the demo-date override testable) and it is the reason help stays **event-gated**: you can only ever reach an event's going-attendees, never arbitrary members. Do **not** "harden" this on the iOS side by inventing your own event ids — mirror `helpTargeting`.

⚠️ **`p_today` is currently the DEVICE's local calendar date, not resort-local.** `useDemoDate().today` returns `toISODate(new Date())`, which uses `getFullYear/getMonth/getDate` — device timezone. The migration comments say "resort-local", and `days`/`check_in`/`check_out` are all resort-calendar values, so the correct semantic is **`America/Chicago`**. For Swift, compute it with an explicit Chicago calendar:
```swift
var cal = Calendar(identifier: .gregorian)
cal.timeZone = TimeZone(identifier: "America/Chicago")!
```
This is a deliberate divergence from web (an improvement) and only shows up for a member whose phone is outside Central near midnight. Flag it to Brian rather than silently matching the web's bug.

⚠️⚠️ **Never parse a bare `"YYYY-MM-DD"` into a `Date`.** This codebase already ate a full incident on it (`0168`: every sign-up slot was labeled a day early because `formatDate` did a bare `new Date("2026-07-31")`, which is **UTC** midnight and renders as the previous day in Central — and the relative-only reminder copy made the mismatch unfalsifiable, which is why `_format_slot_when()` now states the resolved day + time). All the date math here is **string comparison on ISO dates** (`from <= today && today <= to`). Keep it that way in Swift: compare `String`s, or use `DateComponents`. `ISO8601DateFormatter` will bite you the same way `new Date()` did.

⚠️ **`addDays()` in `lib/cabins.ts` is subtly wrong and must not be ported literally.** It does `new Date(iso + "T00:00:00")` (local midnight) then `.toISOString().slice(0,10)` (UTC). That round-trips correctly only for zero or negative UTC offsets. In any positive-offset zone it returns the **previous** day, silently shifting the ±2-day grace window. In Swift use `cal.date(byAdding: .day, value: n, to: …)` on the Chicago calendar.

### 1d. The bring-items checklist (`0046`)

`help_request_items(id, request_id, label, position, claimed_by, claimed_at, created_at)`. Lines are created **inside `request_help`** from `p_items` (blank labels are dropped, `position` is the 0-based array index) — there is no "add an item later" RPC. Claiming is `claim_help_item(p_item, p_claim)`:

- **Race-safe by construction:** `update … set claimed_by = auth.uid() where id = p_item and (claimed_by is null or claimed_by = auth.uid())`, then `if not found then raise 'Someone else is already bringing that'`. One bringer per item, first tap wins.
- **Claiming an item also inserts a `help_responses` row** (`on conflict do nothing`) — bringing something counts toward the head-count. Releasing a claim deliberately **leaves your "on my way" in place**.
- Refuses if the parent request is not `status='open'`.

UI contract from `HelpCard`: render a `n/N covered` tally (items claimed / items listed), disable rows claimed by someone else, label them `"{FirstName}'s bringing"` vs `"You're bringing"`, and keep the per-item busy lock **independent** of the per-request lock so checking an item doesn't disable the whole card.

### 1e. Head-count fulfilment (race-safe) and the notification fan-out

`notif_on_help_response()` (AFTER INSERT on `help_responses`):
1. Counts responses.
2. **Race-safe tip to fulfilled:** `if v_count >= needed_count and fulfilled_at is null then update … set fulfilled_at = now() where id = … and fulfilled_at is null; v_now_fulfilled := found;` — the conditional UPDATE + `FOUND` guarantees only the **first** response to cross the line fires the "covered" fan-out, even if two land in the same instant.
3. If not the tipping response: ping the requester — `"{actor} is on the way 🚶"` with `On the way: n of N`, or `"{actor} is also on the way 🙌"` / `"n coming now — you only asked for N!"` when over-subscribed. Over-subscription is allowed: status stays `open` until resolved.
4. If it **is** the tipping response: fan `"✅ Covered — {requester} has enough help"` out to the whole eligible audience (all profiles for urgent, `_help_recipients` otherwise) **plus** a `"✅ You've got enough help"` to the requester.

⚠️ **`fulfilled_at` is sticky.** `withdraw_help` deletes your response but never clears it — a request that hit its number stays "covered" even if someone backs out. Render "Covered" from `fulfilledAt != nil || committed >= needed`, exactly as the web does, and don't try to recompute it downward.

### 1f. Urgent goes to EVERYONE (`0046` + `0047`)

`notif_on_help_request()` branches on `NEW.category = 'urgent'`:
- **urgent** → `_notify(p.id, 'help_urgent', …)` for **every** profile except the requester. No willing, no present, no filter.
- **anything else** → `_notify(r.id, 'help_request', …)` over `_help_recipients(...)`.

`0047` made `_notify` treat `'help_urgent'` as **non-suppressible**: it skips the `notif_types` membership check entirely for that one type. So urgent cannot be muted in-app — `NotifPrefs` renders its row with `locked: true` and copy saying the only way to silence it is the OS notification permission. (CLAUDE.md's Ask-for-Help section still says urgent is "mutable in Profile → Notifications" — that line is stale; the SQL and `NotifPrefs` agree it is not.) Both mini senders treat `help_urgent` as an **override push**: buzz anyone whose `push_types` is non-empty, regardless of their per-category picks.

⚠️ **`help_urgent` is a `NotifType` but NOT a `PushType`.** Don't add it to a push-category picker — there is nothing to opt into, and a picker row would imply it can be turned off. `help_request` and `help_response` **are** real `PushType`s, both in `DEFAULT_PUSH_TYPES` (on by default), and both must have a visible opt-out row (web shipped without them for a while and members had no way to untick them individually — see the audit note in `CLAUDE.md`).

⚠️ **`notified_count` undercounts for urgent.** `request_help` computes it as `count(*) from profiles where id <> me and 'help_urgent' = any(notif_types)`, but `0047` later made `_notify` deliver urgent regardless of `notif_types`. So the "Sent to N" line the requester sees is lower than reality for urgent requests. Faithful port; don't "fix" it client-side, and don't build a UI that asserts N is exact.

Notification titles/bodies are composed **in SQL** — glyph by category (`urgent 🚨 / move 🪵 / setup 🔧 / ride 🚗 / supplies 🛒 / else 🙌`), `"{name} needs a hand 🙌 · 📍 {where}"` or `"🚨 {name} needs help now"`, body = `left(description,140)` plus `· ⏰ by {h:mm AM}` when scheduled. Every row deep-links `url = '/help-requests'`, `entity_type = 'help_request'`, `entity_id = <request id>`. **iOS must route `entity_type='help_request'` to its own Ask-for-Help screen** and ideally scroll to `entity_id` — don't try to open a web path.

APNs already maps this: `apns-sender.js`'s `categoryFor()` returns **`"HELP_REQUEST"`** for both `help_request` and `help_urgent`, and its comment says that mirrors "the categories registered in `NotificationActions.swift`." So an iOS category by that name already exists — **verify in the iOS repo** whether its action buttons actually call `respond_to_help`, or whether the category is registered but inert.

### 1g. Scheduling ahead for a future event (client-only — no migration)

`HelpRequestsView` computes `goingFuture` = events with `startDate > today` that the viewer is `effectiveStatus === "going"` to, sorted ascending. `AskForHelpSheet` shows a **"When do you need help?"** picker: `Right now — I'm at the resort today` (only when `presentNow`) plus one row per future event. Picking a future event:
- targeting → `eventTargeting(event, today)` (`eligible=[event.id]`, `strict=[]`, so it matches anyone going on **any** day),
- `p_needed_at` → `"{event.startDate}T09:00:00"` converted to an ISO instant (the morning of the event),
- `p_audience` → forced to `'present'` (the "notify everyone willing" escape hatch is **hidden**),
- the specific-time picker is **hidden** (the request is anchored to the event date).

No server change was needed: the requester gate and `_help_recipients` both key off `event_attendance` for whatever ids they are handed, so a future event id reaches exactly that event's going-attendees and the requester passes the gate by being one of them.

`atResort = amIPresent(mine, events, today, bookingCoversToday)` (§1c), and `canAsk = !previewAsId && (atResort || goingFuture.length > 0 || isAdmin)`.

### 1h. Reminders and the work-item follow-up (you receive these; you don't build them)

- **`process_help_reminders()`** runs every minute via `pg_cron` (job `mlr-help-reminders`, `0039`). For a genuinely scheduled request (`needed_at > created_at + 20 min`) within `now()+15min` and not older than `now()-30min`, it stamps `reminder_sent_at` (guards re-sends) and (1) reminds everyone who said they're on the way, (2) if still short, **re-broadcasts** to the eligible set and nudges the requester. Fires with the app closed. iOS gets these as ordinary `help_request`/`help_response` rows + pushes — nothing to implement beyond handling the type.
- **`work-followup.js`** on the mini is **APNs-only, i.e. iOS-only today.** When a request carries `work_item_id` + `followup_at` and `followup_sent = false`, once `followup_at` passes it pushes the requester `"Did it get done?"` with `category: "WORK_FOLLOWUP"` and `userInfo: { work_item_id, request_id }`, then stamps `followup_sent = true` (an already-done task sends nothing but is still stamped). **The iOS app must register a `WORK_FOLLOWUP` category with a "Yes, done" action that calls `mark_work_item_done`** (RPC signature: `mark_work_item_done(p_id uuid)`) — otherwise this push is a dead end. The web has no equivalent at all. `AskForHelpSheet` computes `followupAt` as 9 PM Chicago today, or 8 AM tomorrow if it's already past 6 PM.

### 1i. The "Willing to help" opt-in

`profiles.willing_to_help boolean not null default false`, with a **column-level grant**: `grant update (willing_to_help) on public.profiles to authenticated`. So it is a plain `.update({ willing_to_help: … }).eq("id", uid)` — **no RPC** — and the narrow grant is what stops a client touching `is_admin`/`house_id`/`approved` in the same statement. Web reads it in `IdentityProvider`'s profile select and writes it via `updateUser({ willingToHelp: … })` with optimistic state + rollback on error.

Copy matters here (`WillingToHelpToggle`): "When you're at the resort, get a heads-up if someone nearby needs a hand. You decide whether to jump in — and you're only pinged while you're actually up there." It is the real switch for *receiving* pings; `notif_types`/`push_types` only mute or route.

### 1j. Swift shapes

```swift
enum HelpRequestStatus: String, Codable { case open, resolved, cancelled }

struct HelpRequestRow: Decodable {
  let id: UUID
  let userId: UUID                 // help_requests.user_id
  let description: String
  let category: String?            // nil = untyped; 'urgent' is the emergency
  let whereText: String?
  let lat: Double?                 // opt-in pin only
  let lng: Double?
  let neededAt: Date               // NOT NULL (defaults to now())
  let neededCount: Int             // NOT NULL, >= 1
  let status: HelpRequestStatus
  let fulfilledAt: Date?           // nil until the count is hit; STICKY
  let notifiedCount: Int
  let createdAt: Date
  let expiresAt: Date?             // past it the badge clears; the row stays
  let requester: ProfileEmbed?     // see the FK-naming warning below
  let helpResponses: [HelpResponseRow]?
  let helpRequestItems: [BringItemRow]?
}
```
`lat`/`lng`/`whereText`/`category`/`fulfilledAt`/`expiresAt`/`claimedBy`/`claimedAt`/`note` are all genuinely nullable — model them as optionals, never as `0`/`""` sentinels. `days` on `event_attendance` is a `jsonb` map `[String: String]?` and is legitimately null or `{}`.

Timestamps are Postgres `timestamptz` serialized with fractional seconds and an offset; use a `JSONDecoder.dateDecodingStrategy` that tolerates variable fractional-second digits (`.custom` with two `ISO8601DateFormatter`s, with and without `.withFractionalSeconds`) — a strict `.iso8601` will throw on some rows.

⚠️⚠️ **`help_requests` has TWO foreign keys to `profiles` (`user_id` and `resolved_by`), so an unqualified `profiles(...)` embed returns HTTP 300 / `PGRST201` and reads as an empty list with no error.** You must name the constraint, exactly as the web does:
```
id, user_id, description, category, where_text, lat, lng, needed_at, needed_count, status,
fulfilled_at, notified_count, created_at, expires_at,
requester:profiles!help_requests_user_id_fkey(display_name, avatar_url),
help_responses(user_id, note, created_at,
  responder:profiles!help_responses_user_id_fkey(display_name, avatar_url)),
help_request_items(id, label, position, claimed_by, claimed_at,
  claimer:profiles!help_request_items_claimed_by_fkey(display_name))
```
ordered `created_at desc`. This is a known repeat offender in this codebase (it silently broke the tournaments↔entrants embed) — any table with a second FK to an embedded child needs the hint.

A to-one embed can decode as an **object or a one-element array** depending on how PostgREST resolves the relationship; the web mapper defends against both (`Array.isArray(p) ? p[0] : p`). In Swift, write a small `ProfileEmbed` decoder that accepts either shape rather than assuming one.

### 1k. Realtime

`help_requests`, `help_responses`, `help_request_items` all have `replica identity full` and are in the `supabase_realtime` publication. The web subscribes to all three on one channel (`help-requests-live`) with a **250 ms debounced full reload** rather than patching rows — a claim, a response and a fulfilment fan-out can all land within a tick. Mirror the debounce; per-event incremental patching here is not worth the complexity.

### 1l. Other gotchas

- ⚠️ **Anti-spam is a cap of 10 concurrent open requests per member**, not a cooldown: `'You have several open requests already — resolve or cancel some first.'` Surface that message verbatim; it is actionable.
- ⚠️ **`respond_to_help` and `claim_help_item` require `status='open'`; `withdraw_help` does not.** `'That request is no longer open'` is a normal outcome when two people act at once — treat it as a state refresh, not a crash.
- ⚠️ **`set_help_status` accepts `'open'`** (reopen), and is gated to the requester **or** an app admin. It also clears `resolved_by`/`resolved_at` on reopen.
- ⚠️ **"Is this MINE?" must resolve through the effective viewer, not `auth.getUser()`.** The web's `useIdentity().effectiveUserId` = `previewAsId ?? userId`, and `HelpRequestsView` was specifically rewritten to use it — a raw session lookup returns the real admin during an admin's "view as" preview, leaking their own Resolve/Cancel affordances onto the previewed member's screen. **Every write additionally no-ops while previewing.** If iOS has no preview mode, still centralize "my id" in one place rather than calling the auth client from view code.
- ⚠️ The web's confirmation copy is deliberately honest about reach, and there are **three** strings — keep all three:
  - `notified > 0` → `"🔔 Sent to N person/people. They'll get a ping and can say they're on the way."`
  - `notified == 0` and `audience == 'present'` → `"Posted to the log. No one else is checked in as here right now — it'll be seen when people arrive or open the app."`
  - `notified == 0` and `audience == 'all_willing'` → `"Posted. No willing helpers are reachable right now — it's in the log for when people open the app."`
- ⚠️ `HELP_TYPES` keys are the contract with SQL — `hand | move | setup | ride | supplies | urgent`, default `hand`. The SQL `case NEW.category` maps those exact strings to glyphs. A new key silently falls through to `🙌`. (There is no CHECK constraint on `category`, so a typo won't error — it just loses its glyph and its urgent behaviour.)
- Requester-only affordances on a card: **Mark resolved** / **Cancel** and the `Sent to {notified_count}` line. Everyone else gets **On my way** / **Can't make it**; an admin also gets a plain **Resolve**.

### 1m. Where iOS can beat the web app — Ask for Help

Real, not padding:

1. **Actionable notifications.** The `HELP_REQUEST` APNs category already ships. "On my way" and "Can't make it" as lock-screen buttons calling `respond_to_help`/`withdraw_help` means a helper commits in two seconds without unlocking — the single highest-value native win in this whole feature. Add a per-item "I'll bring the tables" action for a request with a bring-list.
2. **One-tap precise pin, reliably.** Browser geolocation in an installed PWA needs the tab foregrounded and frequently just fails (`AskForHelpSheet` has a whole error path for it). `CLLocationManager` with `requestLocation()` plus **MapKit reverse-geocode** can fill `p_lat`/`p_lng` **and** pre-fill `p_where_text` with a real place name — and render the shared pin as an inline `Map` instead of the web's "Open map →" link out to Google Maps.
3. **Live Activity / Dynamic Island for an open request you're on the way to** — `n of N on the way`, ticking toward the `needed_at` time. Nothing on the web can do this, and it is exactly the "I'm walking over there" moment.
4. **Widget + Control Center control:** a small widget showing open requests / "Up North today", and a Lock Screen control that opens the ask sheet.
5. **Shortcuts / Siri:** "Hey Siri, ask MLR for help" → the sheet pre-filled with the last-used type. An App Intent donating "Ask for help" makes it Spotlight-searchable.
6. **Haptics:** a success haptic on "On my way", a distinct one on ✅ Covered. The web's `lib/haptics.ts` is a **no-op on iOS** (it only wraps `navigator.vibrate`, which iOS Safari doesn't implement) — this is free, exclusive polish.
7. **Critical alerts for `urgent`** would be the honest ideal (bypasses silent/Focus). Be realistic: it needs an Apple-granted entitlement, and Apple grants it sparingly for non-safety apps. Ship urgent as a **time-sensitive** interruption level first (`interruption-level: time-sensitive` in the APNs payload — a mini change, not an app change), and treat critical alerts as an ask, not a plan.

### 1n. v1 cut for Ask for Help

Ship: post a request (type · what · how many · where free-text · optional pin), the log with **On my way**/withdraw **and the "Recently handled" tail**, ✅ Covered, resolve/cancel your own, the Willing-to-help toggle, and correct handling of incoming `help_request`/`help_response`/`help_urgent` notifications. Defer: the bring-items checklist, the schedule-ahead future-event picker, the work-item link + `WORK_FOLLOWUP` action, and the specific-time picker. Do **not** defer the `p_today`/`p_eligible`/`p_strict` snapshot, the `notif_types` gate, or the cabin-stay half of `amIPresent` — get those wrong and the feature reaches nobody (or nobody can post), which is indistinguishable from "it doesn't work."

---

## 2. Presence as a shared primitive, and "Who's up north"

`lib/presence.ts` is the same rule widened from "am I present" to "**who** is present," so the Home strip and Ask for Help can't drift apart. Three sources, unioned and de-duped by user id, sorted by name — note `mergePresence(a, b)` takes exactly **two** lists (the caller concatenates cabins + house stays and merges that against attendance; the first list's name/avatar wins a tie):

1. **`presentFromAttendance(events, rows, today, grace = 0)`** — pure/sync, no network. Deliberately **stricter** than Ask for Help: `graceBefore = 0` always (an event that hasn't started never counts, no matter how close) and `graceAfter` defaults to `0` (when the event ends, the card clears). Day-aware via `days[today]` on a real event day. On a lingering-after shoulder it widens grace around **that person's own last "going" day**, not the event's full run — otherwise someone who RSVP'd Sun–Tue would show as up north all week because the *event's* graced window ran that long.
2. **`presentFromCabins(today)`** — `cabin_bookings` where `status='approved' and check_in <= today and check_out > today`. ⚠️ **RLS means a non-admin sees only their OWN row here** (`user_id = auth.uid() or is_cabin_approver(cabin_id)`). This source contributes essentially nothing for a regular member; it is not a bug and it must not be "fixed" by widening RLS. Note the **half-open** interval: `check_out` is exclusive.
3. **`presentFromHouseStays(today)`** — `house_stays` where `start_date <= today <= end_date`. ⚠️ `end_date` is **INCLUSIVE** here (a one-night stay has `end = start`) — the opposite convention from cabins. Only `created_by` is surfaced; free-text `guest_names` have no profile to show. RLS scopes this to your own house.

Every one of these returns `[]` on failure and **never throws**. `WhosUpNorthCard` self-hides for guests and whenever the merged list is empty; it shows up to 8 avatars + `+N more`, and tapping opens a roster sheet → `MemberSheet`. It reads `fetchEvents()`/`fetchAttendance()` directly rather than the events hook, because the hook only exposes summaries rolled up over an event's whole run and loses the per-day `days` map this needs.

⚠️ **Wording is a product decision, not filler.** "Up North **today**", never "right now", and the sheet says "Based on who's RSVP'd or booked for today — not their exact arrival time, so someone here may still be on their way." This is inferred from RSVPs, and the copy must not promise more than the data supports.

Cache key is **date-scoped**: `whosUpNorth.<uid>.<today>`, 30-minute TTL. That is load-bearing — yesterday's list can never paint, because yesterday's key isn't today's key. Use the same discipline for any iOS cache of day-derived data.

### Where iOS can beat the web app — presence (the flagship opportunity)

**The honest framing first:** presence is inferred on the web because a PWA cannot know location in the background. A native app **can** — `CLLocationManager` significant-location-change or a `CLCircularRegion` geofence on the resort (`45.53492, -89.69830`, the coordinates `WeatherCard` already uses for Tomahawk), with explicit consent, waking the app on arrival. **But: the server-side gate is what actually decides recipients.** `_help_recipients` reads `event_attendance` and `cabin_bookings` and nothing else. A geofence on the phone cannot, by itself, make anyone receive a help request.

Two ways to cash that in:

- **No backend change — convert arrival into the DB state the server already reads.** On geofence entry, the app knows you're physically up north and can prompt: *"You're at MLR — RSVP going to {live event} so you can ask for help and get asked?"* One tap writes `event_attendance` via the existing RSVP path and the member is instantly present by the server's own rule. This also kills the feature's worst dead-end: today a member standing at the pavilion gets "You can ask for help once you're at the resort — RSVP going to a current event first," which reads as nonsense to someone who is *obviously* at the resort. Native turns that error into a one-tap fix. **This is the highest-value native win and it needs zero schema work.** It also fixes the Willing-to-help toggle's implicit promise ("you're only pinged while you're actually up there") from an approximation into something close to true.
- **With a backend change — make geofenced presence a first-class source.** This is the one migration this section would need, and it is small: a `member_presence(user_id uuid, present_on date, source text, updated_at timestamptz, primary key (user_id, present_on))` table, own-row RLS, written by a `SECURITY DEFINER` `set_my_presence(p_on date, p_source text)`, plus **one extra `OR exists(...)` clause in `_help_recipients` and in `request_help`'s requester gate** (recreate both from their current `0100` bodies — `0100` genuinely is the newest definition of those two, but **verify with `pg_get_functiondef` before editing anything**: this codebase has a standing rule about recreating a function from the *current production* definition, after `0128` silently reverted `0044`'s whole-word blocklist fix by copy-pasting an older body, and `run_scheduled_broadcasts()` has since been re-created twice more the same way — see §3f). Do **not** ship this without Brian's sign-on: it turns a location permission into something that changes who gets notified, which is a privacy decision, not an engineering one. And gate it hard — geofence entry only ever *adds* presence for today; it must never be the thing that makes someone reachable when they've turned the permission off.

Also genuinely better on iOS: a **"Up North today" widget**; a **`MapKit` view of who's where** if the pin data is ever there; and **`.significantLocationChange` battery cost is near zero** compared to anything a browser could attempt.

---

## 3. The Home call-out stack

The Home "what's happening" slot is a Robinhood-style **swipe-away card stack** so temporary call-outs don't push the page down. `HomeSpotlight` assembles it; `CalloutStack` renders and animates it.

### 3a. Data model

`home_callouts` (migration `0083`, plus `0093`/`0096`/`0101`/`0137`/`0172`) — the live column set the web selects (`CALLOUT_COLUMNS` in `lib/festContent.ts`):

`id uuid` · `title text?` · `body text?` · `image_url text?` · `links jsonb not null default '[]'` (ordered array of `{href, label}`) · `starts_on date?` · `ends_on date?` (inclusive) · `dismiss_id text NOT NULL` · `position int not null default 0` · `is_active boolean not null default true` · `event_id text?` · `exclude_not_attending boolean not null default true` · `deadline_at timestamptz?` · `signup_item_id text?` · `drop_box_id uuid? references drop_boxes(id) on delete set null`.

⚠️ `created_at` and `created_by` exist **on the table** but are **not** in `CALLOUT_COLUMNS` — no read path ever selects them (`created_by` is only *written*, by `saveCallout`'s insert). Don't put them in the Swift `Decodable` for a callout read.

⚠️ `link_href`/`link_label` were **dropped** in `0093` — if you see them referenced anywhere, that's stale.

**Read rule:** `home_callouts` is **public** (`for select using (true)`) — guests included, and it was deliberately **not** swapped to `is_approved_member()` by `0183`, because Home is browse-first and a callout carries no PII. **Write rule:** `for all using (can_edit_fest()) with check (can_edit_fest())`.

⚠️ **`can_edit_fest()`'s live body is `0057_roster_is_membership`, not `0083`/`0053`:** app admin (`profiles.is_admin`) **OR** a **`committee_roster`** row with `committee_slug = 'family-fest'` and `linked_user_id = auth.uid()`. The original `0053` body joined the legacy `committee_members` → `committees` pair; that version is dead, and `committee_roster` is the membership source of truth. If a fest-committee member can't save a callout, check `committee_roster.linked_user_id`, not `committee_members`.

There is no RPC; the web writes the table directly (`saveCallout`/`deleteCallout`). Realtime is enabled (`home_callouts` sits on its **own** channel in `lib/useFestContent.ts`, so a pre-`0083` database can't fail the shared fest-tables channel join).

`home_callout_completions(callout_id, user_id, completed_at)` (migration `0098`), PK `(callout_id, user_id)`. **Read rule:** `for all using (user_id = auth.uid()) with check (user_id = auth.uid())` — you only ever see your own; no RPC needed. **Not** in the realtime publication.

### 3b. Two dismissals that must not be confused

| | Swipe / ✕ | "✓ I did this — don't show again" |
|---|---|---|
| Scope | **Session only** | **Permanent**, cross-session, cross-device |
| Storage | `sessionStorage["mlr.callouts.dismissed"]` = array of **`dismiss_id`** | a row in `home_callout_completions`, keyed on the callout's **stable `id`** |
| Comes back? | Yes, on the next app open | Never |
| Guests | works (local) | `promptSignIn()` — there's nothing to attach a row to |

⚠️⚠️ **The two keys are different columns on purpose.** Session dismissal keys on the mutable, editor-versioned `dismiss_id` (the Planner suggests `slug+date`) so a *re-issued* callout resurfaces even inside a session where the old one was swiped — `HomeSpotlight` literally passes `id: c.dismissId` as the `StackItem` id, while `onMarkDone` passes `c.id`. Permanent completion keys on the immutable `id` so an editor bumping `dismiss_id` can't resurrect a card you already acted on. Swap them and you get either nagging or silent loss.

⚠️⚠️ **"Session" on iOS is process lifetime, not `UserDefaults`.** The web's contract is explicit: a swiped card **comes back the next time the app is opened**. If you persist swipes to `UserDefaults` you have silently converted the session dismissal into the permanent one and deleted the feature's whole point (a callout gets one more chance to be seen tomorrow). Hold it in an in-memory store owned by the app object, reset on cold launch. `sceneWillEnterForeground` is *not* a new session — don't reset there.

The permanent completion is **optimistic + persisted in one step** (`mutateCompleted(addId)` before the write, `.then(() => mutateCompleted(addId))` after, so an in-flight pre-write fetch can't clobber it), the completed-id set rides a locally persisted cache (`calloutsDone.<uid>`) so the card is filtered out **from the very first paint** on the next cold open — the web explicitly fixed a "shows for half a second then vanishes" flash here. Upsert with `onConflict: "callout_id,user_id", ignoreDuplicates: true` so a double-tap can't throw. Key it on the **real** uid, never a preview identity.

### 3c. Stack mechanics (numbers to match)

- Items are passed **front-to-back**: swipeable callouts first (ordered by `position` ascending — the read is `.order("position")` — so `position = 0` is the front card), then the **permanent base** — `FamilyFestSpotlight`, `swipeable: false`. The base can never be removed, which is what keeps the slot exactly one card tall no matter how many callouts are live.
- `SWIPE_THRESHOLD = 140` px of horizontal travel — deliberately long so scroll jitter never flings a card. `PEEK = 8` px per card behind. `MAX_PEEK = 2` visible plates. `FLY_MS = 260`.
- Axis lock: the gesture ignores the first 6 px, then locks to whichever axis dominates; vertical lets the page scroll (`touch-action: pan-y`).
- Only the **front card's content is mounted**; the cards behind are decorative `inset-0` plates peeking a fixed sliver, so the stacked look is height-independent.
- One `.callout-wiggle` hint per session the first time a swipeable card is on top; skipped under reduce-motion (`sessionStorage["mlr.callouts.wiggled"]`).
- ⚠️ **In-card controls must not be eaten by the drag.** The web marks every button/link `data-callout-no-drag` and bails out of `onPointerDown` on them, because the tiniest trackpad drift between mousedown and mouseup would lock the horizontal axis, mark the gesture "dragged," and make `onClickCapture` swallow the button's own click — the control silently did nothing. The SwiftUI analogue: put the `DragGesture` on the card background with a `minimumDistance` and let `Button`s take their own taps; verify "I did this", each link, and the ✕ all still fire mid-tiny-drag on a real device.

### 3d. Show window, targeting, and the fallback rule

`isLive(callout, today)`:
```
if !isActive → false
if today == nil → show ONLY if both startsOn and endsOn are nil
if startsOn && today < startsOn → false
if endsOn && today > endsOn → false        // endsOn is INCLUSIVE
else true
```
The `today == nil` hedge exists because web prerenders with no date and an expired card would flash on every cold open. **On iOS `today` is available synchronously, so drop the hedge** — but keep the window rule and keep the comparisons as **ISO string compares** (see the `0168` warning above; `CalloutCard` also renders `Due {formatDate(endsOn + "T00:00:00")}` — appending the time is what makes that safe).

**Event targeting** (`0096` + `lib/eventTargeting.ts`) is applied **client-side** for callouts, because callouts render entirely on the client: `isHiddenForEventTarget(mine, eventId, excludeNotAttending)` hides the card **only** from someone whose rolled-up `effectiveStatus` for that event is `not_going`. A no-response member, or Going/Maybe, still sees it — deliberately, since they might still come and seeing it could nudge an RSVP. `exclude_not_attending` defaults to **true** once an event is picked. Do not invert this or extend it to no-response members.

⚠️ **`fetchFestContent` falls back to `FALLBACK_CALLOUTS` (the seeded t-shirt flyer) on a table-missing ERROR only — never on an empty result.** An empty `home_callouts` legitimately means "no call-outs," and resurrecting a seed card an editor deliberately deleted would be a bug. This exact seed-fallback idiom is what hid the `committee_areas` RLS incident for weeks (`0170`: RLS was switched on out-of-band with zero policies, reads silently returned `[]`, and `fetchCommitteeAreas()`'s in-code `FAMILY_FEST_AREAS` seed made the one committee anyone looks at render perfectly healthy). If iOS ships a seed fallback at all, gate it on the *error*, not on emptiness — and prefer shipping none.

### 3e. The three kinds of action a card can carry

1. **`links`** (jsonb array, `0093`) — each renders on its **own line** so two actions read as separate. `tel:` also renders the formatted number; `http(s)` opens externally; `mailto:` otherwise. Label falls back to `📞 Call` / `Open link` / `✉️ Email`.
2. **`signup_item_id`** (`0137`) — a `fest_schedule_items` id (**text**, not an FK, so it tolerates in-code seed ids). Renders **📝 Sign up** → the fest schedule detail screen for that item (`/family-fest/schedule/<id>` on web). ⚠️ **The button is gated on the linked item actually being `signup_enabled`, not merely on the id being set** — the picker was widened past signup-only items so a callout can borrow an activity's content. `HomeSpotlight` resolves that from the fest schedule it already has in hand (`schedule.find(s => s.id === c.signupItemId)?.signupEnabled`); no extra round-trip. Distinct from `event_id`, which is targeting only — a callout can do both at once.
3. **`drop_box_id`** (`0172`) — a real FK to `drop_boxes`. Renders **📸 Add & see photos** → the drop-box folder (`/drop?box=<id>` on web). The official Family Fest 2026 album has a **fixed, seeded id** `0000fe57-2026-4000-8000-000000000001` (`FEST_ALBUM_BOX_ID` in `lib/data.ts`), so the app can deep-link it without a lookup.

`hasText` in `CalloutCard` decides whether the text block renders at all: an image-only flyer with no title/body/links/`endsOn`/signup/dropbox renders as a bare edge-to-edge image. Every field is optional — build for "image only" and "text only" both.

⚠️ `saveCallout` **retries without `drop_box_id`** if the write errors mentioning that column (pre-`0172` degradation). Any iOS write path should do the same rather than hard-failing — an unknown column fails the whole statement.

### 3f. Callout reminders and `excludeCalloutDone`

A callout reminder is not a new system — it's a `scheduled_broadcasts` row (`0097`) tagged `payload.sourceType='callout'` / `sourceId` / `sourceLabel`, fired by the `pg_cron` `run_scheduled_broadcasts()` tick (job `run-scheduled-broadcasts`, every minute). Two payload flags matter to this section:

- **`payload.excludeCalloutDone`** (`0102` always-on → `0103` made it a checkbox, default on, `coalesce(…, true)` so pre-flag rows behave as before). When set, the tick excludes any recipient with a `home_callout_completions` row for that callout id — so "I did this" also suppresses the nag. It is the **only part of `0101`'s reminder-tagging trio (`sourceType`/`sourceId`/`sourceLabel`) that the tick acts on**: `sourceLabel` stays a purely opaque editor label, and `sourceId` matters only through this flag. Don't over-read that as "the one payload field it reads" — the tick also consumes `title`/`body`/`url`, `audience`, `expiryHours`, `eventId`, `excludeNotAttending`, `onlyUnconfirmed`, `showBanner` and the legacy `alsoBanner` as real data. ⚠️ The callout-done exclusion is applied in the `kind='notification'` branch only, **not** in the `'announcement'`/banner branch.
- ⚠️⚠️ **The live body of `run_scheduled_broadcasts()` is NOT `0103`'s.** `0122_family_meetings_to_events` re-created the whole function (adding `onlyUnconfirmed`) and `0126_unified_broadcast_composer` re-created it again (adding `showBanner`) — **`0126` is the current definition.** If anything ever needs changing there, recreate from `pg_get_functiondef` in production, never from `0102`/`0103`. This is the same copy-an-older-body trap that caused the `0128`/`0044` blocklist regression.
- **`home_callouts.deadline_at`** (`0101`) is the "due by" moment reminder offsets count down from — **distinct from `starts_on`/`ends_on`, which only gate the show window.** Without an anchor the scheduler falls back to an exact date/time. `0101` also adds `events.start_time` as the event-side anchor and `update_scheduled_broadcast()` for editing a still-queued row in place.

Reminders can only be attached to an item that already has an id (save first, then add reminders — the web only shows `ReminderScheduler` when *editing* an existing event/callout). iOS doesn't need to *author* these for v1; it needs to render the resulting `broadcast` notifications, which are already handled by the Activity feed.

⚠️ Related, already fixed on the web but worth knowing: `send_broadcast_notification` inserts rows with `type='broadcast'`, which was **never a real `PushType`** — so for a long time the "🔔 Activity tab" channel never pushed to any phone, on either sender. Both mini senders now include `"broadcast"` in their pushable sets and special-case it to gate on the recipient's **`alerts`** category. If a broadcast lands in the feed but no phone buzzes, that's the shape of the bug — not an iOS problem.

### 3g. Where iOS can beat the web app — the callout stack

- **Real card-stack physics.** SwiftUI can mount every card cheaply, give the stack genuine depth/parallax, and use a `DragGesture` with velocity-based fling and rubber-banding instead of the web's hand-tuned 140 px threshold + manual axis lock. The web can only afford to render the front card and fake the rest with static plates; iOS doesn't have to fake it.
- **`.sensoryFeedback`** on dismiss and on "I did this" — a callout stack is exactly the interaction that lives or dies on tactile confirmation, and the web's haptics module is a no-op on iOS.
- **Share sheet on a flyer.** A callout image is the one thing family members actually want to forward. `ShareLink` on the flyer (image + title + link) beats "long-press the image in Safari."
- **Add to Calendar / Reminders from `deadline_at`.** One tap to put "order t-shirts by Friday" in the OS, via `EKEventStore` — the web can only show "Due Fri, Jul 15".
- **A `WidgetKit` widget for the front callout**, refreshed in the background — the flyer on the home screen, not one tab-hop away.
- **`AsyncImage` + a real disk cache** for flyer art, so the stack never pops in. (Callout art lives in Supabase Storage `site-assets`, not on the mini, so it does **not** need the media-token signing — but implement the `mediaSrc()` equivalent anyway and make it a no-op for non-mini URLs, exactly as web does — note web's version matches on **host**, not prefix, and also exempts `/assets/` — so a mini-hosted image can never slip through unsigned.)

### 3h. v1 cut for the callout stack

Ship: fetch active in-window rows ordered by `position`, render the card (image / title / body / links / signup / drop-box / due line), the permanent base card, swipe + ✕ with **in-memory** session dismissal, "I did this" writing `home_callout_completions`, and client-side event targeting. Defer: reminder scheduling, the peeking-plate depth polish, and the admin authoring UI (`can_edit_fest()`-gated — web has it at Admin → Alerts & Notifications and it is genuinely rarely used). For the record, that deferred UI is also where callout *notifications* come from: `AdminCallouts`' `CalloutSheet` carries two **one-time side actions** — **"🔔 Also send a notification"** (a short input that *is* the notification title; no separate body) and **"✉️ Also email everyone who opted in"** (a textarea pre-filled from the callout's own body until edited) — both default **off** on every sheet open (so re-editing a callout never silently resends), both fire right after `saveCallout()` succeeds via `lib/broadcast.ts` (`postAnnouncement` / `sendActivityNotification`) reusing the callout's own event target, and a failure there blocks the sheet from closing without undoing the already-saved row.

---

## 4. The self-hiding garnish cards

Home carries a run of light cards, each of which **renders nothing when it has nothing to say** — guest, no data, table not migrated. That contract is the whole design: Home never grows an empty box, and no card ever shows a spinner, error state, or "no data yet" shell. Port the contract, not just the cards.

⚠️ **Placement, from `app/page.tsx`:** `WeatherCard` is **first on the page**, directly under the app header (it is the one quick-glance thing everyone wants without scrolling; it self-hides on failure so it never leaves a gap up top). The run *below* the quick-actions grid is `WhosUpNorthCard` → `ActivePollCard` → `BirthdaysCard` → `OnThisDayCard`. `HouseHubCard` (grouped with these in CLAUDE.md, but a Houses-section feature — single tap to your house's calendar / chat / to-do list, self-hides for guests and anyone with no `house_id`) sits higher up, between `UpcomingEvents` and `AdminDashboardCard`/`WorkChecklist`. Keep the ordering when porting; it is deliberate.

| Card | Source | Gate / notes |
|---|---|---|
| `WeatherCard` | **Open-Meteo**, no API key, fixed lat/long `45.53492,-89.69830` (Tomahawk, WI), `forecast_days=6`, `temperature_unit=fahrenheit`, `timezone=America/Chicago` | **Public** — no sign-in. Cache `weather`, 30-min TTL. `fetchWeather` **throws** on any bad/malformed response so the cache keeps the last good snapshot rather than overwriting it with nothing. Collapsed to one row; tap reveals a 5-day strip. WMO code → one of 7 emoji buckets. |
| `WhosUpNorthCard` | `lib/presence.ts`, §2 above | Members-only. Cache `whosUpNorth.<uid>.<today>`, 30 min. |
| `ActivePollCard` | `fetchPolls()` → first `!isClosed` | Self-hides for guests, no open poll, missing `0084` table — `fetchPolls` already degrades to `[]` for all three, so "no open poll" covers everything with no extra checks. Cache `activePoll.<uid>`, 6 h (an admin preview uses a separate, non-persisted `activePoll.preview.<id>` key). |
| `BirthdaysCard` | `profiles.birthday` (migration `0020`), `.not("birthday","is",null)` | Members-only. **Year-agnostic month/day compare**, 14-day window, today sorts first and reads "today! 🎉". ⚠️ Feb-29 falls back to Feb-28 in a non-leap target year so it's never silently skipped — mirrors `media-server/birthday-notifier.js`; keep them consistent. Cache `birthdays.<uid>.<localDay>`, 6 h. Names deep-link `?member=<id>`. |
| `OnThisDayCard` | `posts` + first non-video `post_media` row per post | Members-only (posts are members-only under `0081`/`0183`). A photo post from a **prior** year (`d.getFullYear() < currentYear`) within **±3 days** of today's month-day, with a **circular** day-of-year distance so Dec 30 and Jan 2 read as 3 days apart, not 363. ⚠️ **The pick is DETERMINISTIC — `dayOfYear % candidates.count` after sorting by id — not random**, so everyone in the family sees the same memory on the same day, and it rotates naturally year to year. Skips `status != 'visible'`. Cache `onThisDay.<uid>.<localDay>`, 24 h. |

⚠️ **Every day-derived cache key embeds the local date.** That is not decoration: it is what makes "in 3 days" or "on this day" structurally incapable of painting a day late from a stale cache. Do the same in iOS — a date in the key beats any TTL.

⚠️ **User-scoped caches must embed the real uid**, and must be cleared on sign-out. The web ate a real security bug here: a private-chat cache keyed on a shared `"self"` string leaked one member's cached content to the next user on the same device, because sign-out doesn't reload the app. Key on the actual user id, wipe on sign-out.

### Where iOS can beat the web app — the garnish cards

- **`WidgetKit`**: "Up North today," today's weather for the lake, and next birthday are three of the best small-widget candidates in the app. All three are already cheap, day-scoped reads.
- **On this day** is a natural **`PhotosPicker`-free memory surface** with a real `Live Photo`-aware viewer and `ShareLink`; and `AsyncImage` + disk cache makes the thumbnail instant. (⚠️ Post media served from the mini requires the media token — see the media section; `site-assets` and Supabase Storage URLs do not.)
- **Weather**: a `WeatherKit` swap is tempting and should be **declined for v1** — Open-Meteo needs no key, no entitlement, and no attribution UI, and the web/iOS numbers agreeing matters more than provider polish. Note it as an option, not a plan.
- **Birthdays**: offer "add to Contacts / Calendar" for a family birthday — a one-tap native affordance with no web equivalent.

---

## 5. What to verify in the `mlr-app-ios` repo (it is not on this machine — none of these are assertions)

- Does an **Ask for Help** screen exist at all, or only the `HELP_REQUEST` notification category `apns-sender.js` claims is registered in `NotificationActions.swift`? If the category exists but its actions don't call `respond_to_help`, a tap does nothing — worse than no button.
- Is a **`WORK_FOLLOWUP`** category registered with a "Yes, done" action wired to `mark_work_item_done(p_id)`? This push is **iOS-only** and has no web fallback; unhandled, it's a dead notification.
- Does the app send **all 14 `request_help` keys**, or a subset that could resolve to the stale 13-arg overload (§1b)?
- Is `p_today` computed in **`America/Chicago`** or device-local, and does it agree with whatever the callout show-window comparison uses? One shared "today" provider, or they will drift.
- Does the Ask button's presence gate include the **approved-cabin-stay** half (`amIPresent`'s `bookingCoversToday`, §1c), or only event RSVPs?
- Is `willing_to_help` in the profile select and writable from a settings screen?
- Are the **two callout dismissals** distinguished — in-memory-per-launch for swipe keyed on `dismiss_id`, `home_callout_completions` keyed on `id` for "I did this" — or has the swipe been persisted to `UserDefaults` (which silently merges them)?
- Does the app render **`help_urgent`** without offering a mute toggle, and does it treat it as at least time-sensitive?
- Does anything reimplement `addDays`/date math by parsing `"YYYY-MM-DD"` through a formatter? (§1c.)
- Do the embed selects **name the FK** on `help_requests` (two FKs to `profiles`)? An unqualified embed returns an empty list with no error.
- Are the garnish cards **truly self-hiding**, or do they render empty shells / spinners / "no data" text — and does the log include the **"Recently handled"** tail?
