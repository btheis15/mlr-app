<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **9 correction(s)** were applied.

### Event sign-up slots

**Migrations:** `0135` (interval slots) → `0136` (explicit slots + instructions + custom fields + "anyone can add anyone") → `0137` (Home-callout deep link) → `0138` (the *parallel* activity implementation) → `0139`/`0141` (anytime events; activities merged into events) → `0140` (automatic reminder cron) → `0143` (headcount mode + teams) → `0158` (manual "notify this slot") → `0159` (reminder email queue + push category) → `0165`/`0166`/`0168` (reminders state the slot's REAL day+time) → `0167` (hide names + counts RPC).

*(`0142` is sometimes lumped in with the anytime work — it isn't: it's `schedule_item_multi_link`, which adds `fest_schedule_items.links jsonb` and drops `link_url`/`link_label`. Unrelated to sign-ups.)*

**All of this schema already exists in production. There is no backend work in this section** — with one loud exception flagged under "iOS reads the wrong table" below, which is still a *client* decision, not a migration.

---

#### 1. What the feature is

A Family Fest schedule event can take **limited sign-ups**. Three shapes, chosen by the organizer via `fest_schedule_items.signup_mode`:

| `signup_mode` | Slots come from | Has a time? | Notes |
|---|---|---|---|
| `'interval'` (default) | **DERIVED** — computed from 4 config columns, never stored | yes, on the event's own `day` | e.g. 12:00/16:00/60min → 12:00, 13:00, 14:00, 15:00 |
| `'slots'` | **STORED** — rows in `fest_schedule_slots` | yes, each slot carries its **own** `day` + `start_time` | arbitrary, independent slots ("Mon 10:50am, Wed 1:48pm") |
| `'headcount'` | **one synthetic bucket**, nothing stored, no time at all | no | just a running count of who's coming |

A sign-up is **one person per row** in `fest_schedule_signups`: either a linked member (`user_id` set, `name` snapshotted from `profiles.display_name` server-side) **or** a typed-in name (`user_id` null). **Any signed-in member may add anyone, and several people** (0136 deliberately dropped the organizer gate). Removal is limited to the row's `user_id`, its `added_by`, or an organizer.

`signup_enabled boolean not null default false` gates the whole card — don't render anything when it's false.

---

#### 2. Tables, columns and the RLS read rule (one sentence each)

**`fest_schedule_items`** (the parent event; `day date not null`, `anytime boolean not null default false`, `lead_user_id uuid`, `crew_user_ids uuid[] not null default '{}'`). Sign-up config columns:

```
signup_enabled           boolean not null default false
signup_capacity          int        -- people per slot; DEFAULT for slots mode; nullable ⇒ "no cap" ONLY in headcount mode
signup_slot_minutes      int        -- interval mode only
signup_start_time        text       -- "HH:MM", interval mode, first slot's start
signup_end_time          text       -- "HH:MM", interval mode, boundary the last slot must END by
signup_mode              text not null default 'interval'  -- check in ('interval','slots','headcount')
signup_instructions      text       -- free text shown above the slots
signup_fields            jsonb not null default '[]'  -- [{ "id": "...", "label": "..." }, …]
signup_reminder_minutes  int[] not null default '{}'  -- e.g. {1440,60,15}
signup_reminder_email    boolean not null default false
signup_team_size         int        -- null/1 = individual; e.g. 2 = sign up in pairs
signup_hide_names        boolean not null default false
tournament_enabled       boolean    -- separate feature (0147), not covered here
source_activity_id       uuid       -- provenance from the 0141 activity merge
```
> **RLS read:** public — anyone, signed in or not, reads every row (`for select using (true)`, migration 0053). An empty result really means no data.

**`fest_schedule_slots`** (only used when `signup_mode = 'slots'`):
```
id uuid pk, schedule_item_id uuid not null (FK, on delete cascade),
day text,            -- ISO "YYYY-MM-DD"; NULL ⇒ fall back to the event's own day
start_time text not null,  -- "HH:MM"
end_time  text,      -- "HH:MM", optional
label     text,      -- optional override for the auto "day · time" label
capacity  int,       -- NULL ⇒ fall back to the event's signup_capacity
position  int not null default 0,
created_at timestamptz, source_activity_slot_id uuid
```
> **RLS read:** public (`using (true)`). **Writes** are three separate RLS policies, all gated to `_can_manage_item_signups(schedule_item_id)` — a plain table write from the client, no RPC. Note the two failure shapes: an **insert** you're not allowed to make **raises** an error (Postgres `42501`, "new row violates row-level security policy"), while an **update/delete** you're not allowed to make is **silent** — the row is filtered out and zero rows change. Either way it means "you're not the organizer/lead/crew", so check the affected-row count, don't just check for an error.

**`fest_schedule_signups`**:
```
id uuid pk, schedule_item_id uuid not null (FK cascade),
slot_start text,     -- NULLABLE (0143 fixed this) — "HH:MM" for interval mode, NULL otherwise
slot_id    uuid,     -- FK → fest_schedule_slots, NULL unless slots mode
user_id    uuid,     -- FK → profiles, NULL for a typed-in name; on delete SET NULL
name       text not null,   -- display-name snapshot (always present)
added_by   uuid,     -- FK → profiles, who created the row
fields     jsonb not null default '{}',  -- { "<field id>": "<value>" }
team_id    uuid,     -- shared by every row of one team sign-up; NULL for an individual
team_name  text,     -- optional label the signer gave the team
created_at timestamptz not null default now(),
source_activity_signup_id uuid
```
> **RLS read (migration 0167 — read this carefully):** a row comes back if `user_id = auth.uid()` **OR** `added_by = auth.uid()` **OR** the parent event has `signup_hide_names = false` **OR** you can manage the event's sign-ups. So on a `signup_hide_names = true` event, a plain member's `select` returns **only their own rows** — a short list is *not* a short slot, it's RLS filtering. No insert/update/delete policy exists at all: **every write goes through the SECURITY DEFINER RPCs below.**

**`fest_signup_reminders_sent`** (`signup_id`, `minutes`, `kind`, `sent_at`; pk `(signup_id, minutes)`) and **`fest_reminder_emails`** (`kind`, `item_id`, `slot_id`, `slot_start`, `lead_minutes`, `created_at`, `sent_at`) both have **RLS enabled with zero policies** — deliberately unreadable and unwritable from any client. iOS never touches them.

**`home_callouts.signup_item_id text`** (0137) — a `fest_schedule_items` id (text, not an FK). If iOS renders Home callouts, this is the "📝 Sign up" deep link to the event's sign-up card. ⚠️ A non-null id is **not** enough on its own: the picker was later widened past 0137's signup-only list (a callout can link any fest item just to borrow its photo/details), so the web resolves the linked item's `signup_enabled` and only shows the button when it's true (`showSignup = signupItemId && signupEnabled` in `CalloutCard`). Match that or you'll render a Sign up button onto a card with no sign-up.

---

#### 3. Deriving the slot list (the part with real logic)

The web app normalizes all three modes into one `SlotView` list before rendering (`resolveSlotViews` in `lib/scheduleSignups.ts`). Port this shape — it's the single thing that keeps the UI and the RPCs agreeing.

```swift
struct SlotView {
    let key: String          // "headcount" | slot uuid | "HH:MM"
    let slotId: UUID?        // send as p_slot_id
    let slotStart: String?   // "HH:MM" — send as p_slot ONLY when slotId == nil
    let label: String        // "" for the headcount bucket
    let capacity: Int?       // nil ⇒ NO cap (headcount only) — never "full"
}
```

**headcount** → exactly one view: `slotId = nil`, `slotStart = nil`, `label = ""`, `capacity = signupCapacity` (**may be nil ⇒ uncapped**). Matching rule for signups: `slotId == nil && slotStart == nil`.

**slots** → one view per `fest_schedule_slots` row, ordered `day` (nulls first) then `start_time` (that's exactly what the web query does; `position` exists but isn't used for ordering). `capacity = slot.capacity ?? (event.signupCapacity ?? 0)`. Matching rule: `signup.slotId == slot.id`. ⚠️ The web keeps `slotStart = slot.startTime` on these views (it is *not* nil) and nils it at the RPC boundary instead — every call site sends `slotStart: view.slotId != nil ? nil : view.slotStart`. Do the same: `p_slot` and `p_slot_id` must never both be non-null.

**interval** → derived. This mirrors the Postgres function `fest_schedule_slot_starts()` exactly and **must not drift**, because the RPC validates `p_slot` against the SQL version and raises *"That time slot isn't available"* on a mismatch:

```swift
// "HH:MM" starts from signupStartTime up to (not reaching) signupEndTime, signupSlotMinutes apart.
func computeSlots(_ e: ScheduleEvent) -> [String] {
    guard e.signupEnabled,
          let mins = e.signupSlotMinutes, mins > 0,
          let s = e.signupStartTime, let f = e.signupEndTime else { return [] }
    func minutes(_ t: String) -> Int {           // "HH:MM" → minutes, no Date involved
        let p = t.split(separator: ":").map { Int($0) ?? 0 }
        return p[0] * 60 + (p.count > 1 ? p[1] : 0)
    }
    var out: [String] = []
    var t = minutes(s)
    let end = minutes(f)
    while t <= end - mins {                       // NOTE: <=, and the last slot must END by signupEndTime
        out.append(String(format: "%02d:%02d", t / 60, t % 60))
        t += mins
    }
    return out
}
```
`capacity = event.signupCapacity ?? 0`. Matching rule: `signup.slotId == nil && signup.slotStart == slotStart`.

⚠️ **`capacity == 0` means "immediately full", and that is a real state users hit.** `signup_capacity` defaults to NULL, and in interval/slots mode NULL coalesces to **0** — so an event where the organizer enabled sign-ups but never typed a per-slot number renders every slot as full. Show it as full (matching web) rather than inventing an unlimited fallback. Only headcount mode treats NULL as uncapped.

Also mirror the web's guard: if the resolved slot list is **empty**, render nothing at all (an interval event with no times configured yet).

---

#### 4. The RPCs — exact names, exact parameter order

Supabase RPC args are keyed **by name**; a wrong key is a runtime failure, not a compile error. All of these are `SECURITY DEFINER`, `revoke`d from `anon`, and `grant execute … to authenticated` — **a guest gets a permission error, so prompt sign-in before calling any of them.** Reads (section 2) are public, so a guest can still *see* the card.

**Sign up (schedule events) — 8 params:**
```
sign_up_for_schedule_slot(
  p_item         uuid,
  p_slot         text  default null,   -- "HH:MM", interval mode only
  p_for_user     uuid  default null,   -- link a member; their display_name is snapshotted server-side
  p_name         text  default null,   -- a typed-in, account-less name
  p_slot_id      uuid  default null,   -- explicit slot, slots mode only
  p_fields       jsonb default '{}',   -- { "<field id>": "<value>" }
  p_team_members jsonb default null,   -- see below
  p_team_name    text  default null
) returns uuid    -- the FIRST inserted row's id
```
Rules the function enforces (all raise user-facing strings — surface them verbatim):
- Exactly one of `p_slot` / `p_slot_id` / neither. **Neither ⇒ headcount bucket**, and it raises `'This event needs a time slot'` if the event isn't actually in headcount mode.
- `p_for_user` and `p_name` both null/empty ⇒ the row is for the **caller**.
- Every entry in the event's `signup_fields` must be non-empty → `'Please fill in "<label>"'`.
- One linked member per slot → `'Already signed up'`.
- Capacity → `'Not enough spots left'` (checked once for the whole team, atomically).

**`p_team_members`** is a jsonb **array of objects whose keys are snake_case and are NOT the `p_` params**:
```json
[{ "for_user": "<uuid|null>", "name": "<string|null>", "fields": { "<id>": "<value>" } }, …]
```
When it's non-empty the function generates one `team_id` and inserts every member sharing it (plus `p_team_name`, trimmed, nulled if blank). When it's null/empty you get the original single-row path from `p_for_user`/`p_name`/`p_fields`. **Send `null`, not `[]`, for an individual sign-up** — the check is `is not null and jsonb_array_length(...) > 0`, so `[]` also works, but null is what the web sends.

**Remove:** `remove_schedule_signup(p_signup uuid) returns void`. Raises `'You can only remove a sign-up you added'` unless you are the row's `user_id`, its `added_by`, or a manager.

**Headcount for a hidden roster:** `fest_schedule_signup_counts(p_item uuid) returns table(slot_start text, slot_id uuid, cnt bigint)`. See §6.

**Manual reminder:** `send_signup_slot_reminder_now(p_kind text, p_item uuid, p_slot_id uuid, p_slot_start text, p_minutes int default null, p_email boolean default false) returns int` (the notification count). See §7.

**Activities (the parallel implementation) — 6 params, no team support:**
```
sign_up_for_activity_slot(p_item uuid, p_slot text, p_for_user uuid, p_name text, p_slot_id uuid, p_fields jsonb) returns uuid
remove_activity_signup(p_signup uuid) returns void
```
⚠️ **Do not send `p_team_members`/`p_team_name` to the activity RPC** — that overload does not exist and PostgREST answers `PGRST202 function not found`, which reads like a missing migration. (The web guards this by only spreading the team params when `kind === "schedule"`.)

**Not callable from a client, don't try:** `fest_schedule_slot_starts(...)`, `fest_activity_slot_starts(...)`, `_can_manage_schedule_signups(...)`, `_can_manage_activity_signups(...)`, `run_signup_reminders()`, `signup_reminder_email_recipients(...)` — all `revoke`d from `anon`/`authenticated` (some also from `public`). `_can_manage_item_signups(p_item_id uuid)` and `_can_manage_activity_item_signups(p_activity_id uuid)` *are* granted to `authenticated`, but the web never calls them — it computes `canManage` client-side (§5).

---

#### 5. `canManage` — who is "the organizer"

The predicate used everywhere in this feature is `can_edit_fest()` **OR** the item's own `lead_user_id`/`crew_user_ids` (the 0110 self-edit shape). Compute it client-side exactly the way the web does:

```swift
let canManage = canEditFest
    || (uid != nil && (event.leadUserId == uid || (event.crewUserIds ?? []).contains(uid!)))
```
`canEditFest` comes from the RPC **`can_edit_fest()`** (no params, returns boolean) — it's `profiles.is_admin` OR a `committee_roster` row with `committee_slug = 'family-fest'` linked to you. Cache it; the web keys a persisted cache on the uid (`canEditFest.<uid>`) so the Edit affordances don't flicker in. ⚠️ It's revoked from `anon`, so a signed-out call comes back as a **permission error, not `false`** — treat any error as false, which is exactly what the web's wrapper does.

This is UI-only. Every server-side check re-runs the same predicate, so a wrong client answer grants nothing.

---

#### 6. `signup_hide_names` — why you must use the counts RPC

`signup_hide_names = true` means the roster is a surprise (a variety-show lineup). Two consequences:

1. **A non-manager's plain `select` is missing everybody else's rows** (the 0167 policy). So `signups.count` is *not* the headcount. Call **`fest_schedule_signup_counts(p_item:)`** instead — a `SECURITY DEFINER` RPC that counts every row regardless of RLS. It returns one row per `(slot_start, slot_id)` group; aggregate it into the same key space your `SlotView.key` uses:
   ```swift
   // key = slot_id?.uuidString ?? slot_start ?? "headcount", summing cnt
   ```
   Only fetch it when names are hidden **and** the viewer can't manage (that's the web's condition, `namesHidden`). ⚠️ It's granted to `authenticated` only, so a signed-out viewer of a hidden event gets no count — web falls back to 0 there; match that rather than showing an error.
2. **The organizer defaults to hiding it from THEMSELVES too.** RLS lets a manager's fetch through in full, but the UI must not render those names until the manager taps a deliberate **"👀 Show participants"** (which flips to "🙈 Hide again"). The reveal is **per-mount only, never persisted** — navigating away and back starts hidden again, on purpose. The "📋 View all" roster sheet is governed by the same flag.
   - **Your own entry always renders**, hidden or not — for a manager that means client-side filtering their otherwise-full fetch down to groups where some member has `user_id == uid` **or `added_by == uid`** (so a typed-in name the manager personally entered for someone without an account also shows), with a `"+N more hidden…"` note for the rest. Seeing what *you* entered was never the spoiler.

---

#### 7. Reminders

**Automatic (0140 + 0168, `pg_cron`, every minute — nothing for iOS to build).** The organizer picks lead times in `signup_reminder_minutes`; `run_signup_reminders()` resolves each slot's absolute instant as `(day || ' ' || start_time)::timestamp at time zone 'America/Chicago'`, fires a `signup_reminder` notification per (signup, lead-time), and dedupes via `fest_signup_reminders_sent`. Recipient is `coalesce(user_id, added_by)` — so a coordinator who wrote in a guest gets the nudge, worded *"{guest}'s … slot starts …"*. Only fires for slots with a real day+time; an activity interval slot has no calendar day and is skipped. The body now states the resolved instant too: *"…starts in 30 minutes — Fri, Jul 31 at 9:00 AM."*

`signup_reminder` is a normal, **default-ON** notification and push category (0159), so it reaches iOS through the existing APNs relay with **no new wiring** — it's already in the mini senders' pushable sets (`push-sender.js` and `apns-sender.js` both list it). Its deep link is `/family-fest/schedule/<item id>`; make sure your notification router handles that path (or maps it to the native screen).

**Manual send (0158 → 0165 → 0168).** A `canManage` viewer gets a **"🔔 Notify this slot"** button (or "🔔 Notify everyone" in headcount mode), shown **only once at least one person is signed up**:
```swift
// minutes is ALWAYS nil from the client now; email is the "Also email anyone signed up with an account" checkbox
send_signup_slot_reminder_now(
  p_kind: "schedule", p_item: item.id,
  p_slot_id: view.slotId,
  p_slot_start: view.slotId != nil ? nil : view.slotStart,   // note: mutually exclusive
  p_minutes: nil, p_email: emailToo
) -> Int   // notifications sent, shown as "✓ Sent to N people"
```
The returned int counts one per signed-up **row** that has someone to notify (`coalesce(user_id, added_by)`), not per distinct human — a coordinator who wrote in three account-less guests is the recipient of three of those sends, so N can exceed the number of people. The web still labels it "people"; do what you like, but don't treat N as a distinct-person count.

⚠️ **Do not build a lead-time picker.** It used to offer chips ("starts in 30 minutes") whose label became the notification body **verbatim, with zero connection to the slot's stored time** — so a coordinator clicking the wrong chip or the wrong slot's button told members a lead time that was a full day off, undetectable from the message. 0165/0168 made the RPC resolve and state the slot's real day+time via the shared `_format_slot_when(timestamptz)`. There is nothing left to pick: one "Send reminder" button. Passing a non-null `p_minutes` only reintroduces the wrong wording as a fallback (it's used only when no real instant resolves) and changes the email dedup key.

The email half is **queued, not sent inline** — the RPC inserts into `fest_reminder_emails` and the mac mini's `alert-mailer.js` claims it. Nothing for iOS beyond passing `p_email`.

---

#### 8. ⚠️⚠️ THE DATE BUG — read this before writing a single date line

**Incident, verbatim:** every sign-up slot was **LABELED A DAY EARLY across the whole fest UI — the reminders were right, the labels were wrong** (fixed by migration `0168` + a one-line `lib/format.ts` fix). Members reported "our slot was yesterday but the reminder came this morning" and "I got the notification the day after." The cron was never at fault — every automatic send in the live data landed at exactly slot−30min. The bug was **`formatDate()`**, which did a bare `new Date(input)`: for a `"YYYY-MM-DD"` string that parses as **UTC midnight**, which renders as the **previous day** in any negative-offset zone (Central). So a slot stored `2026-07-31 09:00` displayed as "Thu, Jul 30 · 9:00 AM" everywhere — including the Planner's own day dropdown, so the organizer *built* the slots against shifted labels and every surface agreed with itself. Nothing revealed the truth until the reminder fired off the real stored date, server-side.

**And the stored DATA was shifted too, needing a separate one-off correction (no migration).** Fixing the label was necessary but not sufficient: the slots had been *created* through the same broken dropdown, whose `<option>` label came from `formatDate` while its `value` was the true ISO day — so picking the option that read "Thu, Jul 30" persisted `2026-07-31`. The label was **self-consistent** (weekday *and* date both named Thursday the 30th), so nothing on any screen could reveal the mismatch, and every slot ended up stored one day LATER than the family actually ran it. Confirmed by two independent member reports. Corrected in place with `update fest_schedule_slots set day = (day::date - 1)::text where day is not null` — **10 rows hand-corrected**, the only day-bearing slot rows in the database at the time (`fest_activity_slots` had none, and there were no interval-mode sign-ups). Sign-ups, slot ids and capacities were untouched.
**Takeaways: never hand a bare `YYYY-MM-DD` to a UTC parser. And a display bug in a PICKER silently corrupts the data it writes** — when fixing a date-formatting bug, always check whether the bad label was also feeding a form.

**The Swift equivalents, which are worse than the JS one:**

- `JSONDecoder` with `.dateDecodingStrategy = .iso8601` **throws** on `"2026-07-31"` (it wants a full date-time). A `Date`-typed `day` property doesn't mislabel — it fails the whole decode, taking the event down. **Keep `day` as `String`** in your Codable models (both `fest_schedule_items.day`, a `date` column PostgREST serializes as `"2026-07-31"`, and `fest_schedule_slots.day`, plain text).
- `ISO8601DateFormatter()` defaults to `timeZone = GMT`. With `formatOptions = [.withFullDate]` it happily parses `"2026-07-31"` → UTC midnight; render that `Date` with any `DateFormatter` in `.current` and a Central device prints **"Thu, Jul 30"**. This is the exact JS bug, reproduced.
- Fix: **parse and format in the SAME time zone**, and do it in one helper — never inline `Date(...)` at a call site:
  ```swift
  enum FestDay {
      static let central = TimeZone(identifier: "America/Chicago")!
      private static let parser: DateFormatter = {
          let f = DateFormatter()
          f.calendar = Calendar(identifier: .gregorian)
          f.locale = Locale(identifier: "en_US_POSIX")
          f.timeZone = central          // parse at CENTRAL midnight, not UTC
          f.dateFormat = "yyyy-MM-dd"
          return f
      }()
      static func date(_ iso: String) -> Date? { parser.date(from: iso) }
      static func label(_ iso: String) -> String {   // "Fri, Jul 31"
          guard let d = date(iso) else { return iso }
          let out = DateFormatter()
          out.timeZone = central        // format in the SAME zone you parsed in
          out.setLocalizedDateFormatFromTemplate("EEE, MMM d")
          return out.string(from: d)
      }
  }
  ```
  (The web's own fix parses at *device-local* midnight rather than Central — same-zone-in/same-zone-out is what actually matters. Pinning to Central additionally makes labels match the server's reminder wording for a member travelling out of zone.)
- **`start_time` / `end_time` / `slot_start` are wall-clock `"HH:MM"` strings with NO date and NO zone.** Do not build a `Date` to display them — parse the two integers and format 12-hour (`"09:00"` → `"9:00 AM"`), the way `formatTime()` does. Constructing a `Date` from them is how a second off-by-one gets in.
- If you ever compute a slot's absolute instant (e.g. to sort or to show "starts in…"), build it from `DateComponents` with `timeZone = America/Chicago` so you match `run_signup_reminders()`'s `at time zone 'America/Chicago'` exactly. Don't use the device zone.
- **If you build any day picker** (a slot editor), derive the option's label from the *same* helper that produces the value you write, and write the raw ISO string — not a re-formatted round-trip of the label. That's the corruption path above.

---

#### 9. ⚠️ Schedule events and activities are PARALLEL, ISOLATED implementations

Two complete copies of this feature exist. Nothing is shared — separate config columns, separate child tables, separate RPCs, separate manage predicates:

| | schedule events | activities |
|---|---|---|
| parent | `fest_schedule_items` | `fest_activities` |
| slots | `fest_schedule_slots` (`schedule_item_id`) | `fest_activity_slots` (`activity_id`) |
| signups | `fest_schedule_signups` (`schedule_item_id`) | `fest_activity_signups` (`activity_id`) |
| sign up | `sign_up_for_schedule_slot` (8 args) | `sign_up_for_activity_slot` (6 args) |
| remove | `remove_schedule_signup` | `remove_activity_signup` |
| manage gate | `_can_manage_schedule_signups` / `_can_manage_item_signups` | `_can_manage_activity_signups` / `_can_manage_activity_item_signups` |
| headcount mode | ✅ (0143) | ❌ — check constraint allows only `('interval','slots')` |
| teams (`signup_team_size`, `team_id`, `team_name`) | ✅ (0143) | ❌ — columns don't exist |
| hide names + counts RPC | ✅ (0167) | ❌ |
| capacity error string | `'Not enough spots left'` | `'That time slot is full'` |
| duplicate error string | `'Already signed up'` | `'Already signed up for that slot'` |

The web abstracts over the pair with a single `kind: "schedule" | "activity"` and a lookup table of names (`SOURCES` in `lib/scheduleSignups.ts`). Do the same in Swift (an enum with computed table/RPC names) rather than two copies of the UI — but note the activity branch must **omit** the team params, can never receive `"headcount"`, and words two of its errors differently.

⚠️⚠️ **iOS is currently reading the retired table.** Migration `0141` converted every `fest_activities` row into an **anytime `fest_schedule_items`** row (carrying its sign-up config, slots and signups; provenance in `source_activity_id` / `source_activity_slot_id` / `source_activity_signup_id`) and the **web stopped rendering and creating activities**. (Precisely: `fetchFestContent` still *selects* the `fest_activities` rows, and `fetchActivityDrafts` / `updateActivityDetails` / the Planner's `ActivityEditor`+`ActivitySheet` still exist in the source — but nothing mounts them, so it's unreachable dead code and no web surface shows that data.) The table and rows were left in place *only* because the native app still reads them for its "Anytime" section. **The two have been free to drift ever since** — a web edit to a converted event does not touch the untouched activity row. So:
- **Build sign-ups against `fest_schedule_items` only.** You then get all three modes, teams, and hide-names for free, and you're reading the rows the family actually edits.
- That means also moving the iOS "Anytime" section off `fest_activities` onto `fest_schedule_items` where **`anytime = true`** (migration `0139` — a boolean flag, deliberately *not* a nullable `day`, so `day` stays NOT NULL and every date formatter stays safe; anytime rows park a meaningless date in `day` — **ignore it and render "Anytime all week"**). That's a client change, not a migration; the rows are already there.
- If you ship activity-backed sign-ups instead, you inherit a dead-end: no headcount, no teams, no hide-names, and a roster nobody on web can see.

---

#### 10. Swift shapes, nil handling, and web idioms that do NOT transfer

```swift
struct SignupField: Codable, Identifiable { let id: String; let label: String }

struct ScheduleSlot: Codable, Identifiable {          // fest_schedule_slots
    let id: UUID
    let day: String?            // ISO string, NOT Date — see §8
    let startTime: String       // "HH:MM"  (start_time)
    let endTime: String?        // end_time
    let label: String?
    let capacity: Int?          // nil ⇒ fall back to event.signupCapacity
    let position: Int
}

struct ScheduleSignup: Codable, Identifiable {        // fest_schedule_signups
    let id: UUID
    let slotStart: String?      // slot_start — nullable since 0143
    let slotId: UUID?           // slot_id
    let userId: UUID?           // user_id — nil for a typed-in name
    let name: String            // never nil
    let addedBy: UUID?          // added_by
    let fields: [String: String]?   // decode nil → [:]
    let teamId: UUID?           // team_id
    let teamName: String?       // team_name
}
```
- **Almost everything is optional.** `capacity`, `day`, `end_time`, `label`, `slot_start`, `slot_id`, `user_id`, `added_by`, `team_id`, `team_name`, `signup_capacity`, `signup_slot_minutes`, `signup_start_time`, `signup_end_time`, `signup_team_size`, `signup_instructions`. The only non-null-by-contract fields on a signup row are `id`, `schedule_item_id`, `name`, `fields`, `created_at`. Use `Int?`/`String?`/`UUID?` and the coalescing rules in §3 — don't force-unwrap.
- Use `.convertFromSnakeCase` (or explicit `CodingKeys`) — every column is snake_case, and so are the keys **inside** the `p_team_members` jsonb (`for_user`, not `p_for_user`).
- `signup_fields` decodes to `[SignupField]`; treat missing/`[]` as "no custom columns" and skip the extra form inputs. `fields` on a signup decodes to `[String: String]`; a missing key renders as "—".
- Selecting columns: the web deliberately selects a **narrower column list for activities** (`team_id`/`team_name` don't exist there) — asking for a nonexistent column fails the whole request, so keep two column lists if you support both kinds.
- **RPC errors are user-facing prose.** Surface `PostgrestError.message` directly in an inline error row — do not map to a generic "Something went wrong". The **schedule** RPCs raise: `'Not enough spots left'` (capacity), `'Already signed up'` (duplicate linked member), `'Please fill in "Character"'`, `'That time slot isn't available'`, `'This event needs a time slot'`, `'This event isn't taking sign-ups'`, `'You can only remove a sign-up you added'`, `'Sign in required'`. ⚠️ The **activity** RPCs word two of them differently — `'That time slot is full'` and `'Already signed up for that slot'` (0138 predates 0143's rewording and was never updated) — so **never branch on the message text**; just display it.
- **No `localStorage`/SWR-cache idiom transfers.** The web wraps most reads in a stale-while-revalidate cache, but `ScheduleSignupSlots` deliberately does **not**: it fetches on mount and **re-fetches after every mutation** (`reload()`), because capacity is contested and a stale count shows a full slot as open. Do the same — refetch after sign-up/remove rather than mutating a local array. Don't persist signup rows to disk: on a hide-names event the cached copy is exactly the spoiler you're supposed to be suppressing.
- **Realtime is available but unused.** `fest_schedule_signups`, `fest_schedule_slots`, `fest_activity_signups`, `fest_activity_slots` are all in the `supabase_realtime` publication, so you *can* subscribe — but the web doesn't, and refetch-on-action is simpler and sufficient. Skip it in v1.
- Dedup for headcount mode has **no unique index backing it** (the 0135 index keys on `slot_start`, and NULLs are distinct in Postgres) — only the RPC's explicit check. So don't infer "already signed up" from a constraint violation; read the raised message.
- **"Is this mine?" is the plain session uid — no preview indirection.** `IdentityProvider` does expose an `effectiveUserId` (admins can preview-as a member) but this feature's component deliberately uses plain `userId`, so a plain session uid is correct on iOS too. Keep the *comparison sites* in one place: `s.userId == uid || s.addedBy == uid || canManage` is the remove-affordance rule, and the comparison appears three times — the row ✕, the manager self-hiding filter (`userId` **or** `addedBy`, no `canManage`), and the `mine` check that hides "+ Join this slot" (`userId` only). The roster sheet has no per-row check at all; it's gated wholesale by `canManage && !managerHiding`.

---

#### 11. Honest size, and a suggested v1

This is genuinely large — roughly seven separable pieces:
1. read + render the slot list for all three modes (`resolveSlotViews` + `computeSlots`);
2. self-join / add-someone form (name or linked-member picker over `profiles`, plus custom-field inputs);
3. team form (`teamSize` repeated pickers + team name, one RPC call);
4. remove, with the three-way permission rule;
5. hide-names (counts RPC + the reveal toggle + own-entry passthrough);
6. the organizer roster sheet ("📋 View all" — every slot × person × custom column as a table);
7. the manual "🔔 Notify this slot" send with the email checkbox.

Plus, out of scope for a first pass: the whole **organizer config editor** (mode, capacity, interval, instructions, custom fields, reminder lead times, team size, hide-names) and **slot CRUD** (`fest_schedule_slots` direct inserts/updates/deletes, incl. `updateScheduleSlotCapacity`'s edit-in-place — the web notes that deleting and re-adding a slot **cascade-deletes everyone already signed up for it**, which is exactly the kind of footgun you don't want to ship on day one). Leave all of that on web; organizers already use the Planner there.

**A defensible v1:** read-only slot list + capacity badges + self-join + "add someone" (with custom fields) + remove-your-own, against `fest_schedule_items` only. Omit teams (render "sign up on the web" when `signup_team_size > 1`, rather than silently signing up one person into a team slot), omit hide-names (or, safer: if `signup_hide_names` is true, render only the counts RPC total and no names at all — that's correct behavior, just less featureful), omit the roster sheet, omit the manual notify, omit all config/slot editing. The automatic reminder pushes already work with zero iOS code, so the highest-value slice is simply *letting people take a slot from the phone*.

**Verify this on device before shipping:** whether `fest_schedule_items.day` comes back as `"2026-07-31"` (a `date` column) versus `"2026-07-31T00:00:00"` from your client library's serializer — the §8 helper handles the bare form; a full timestamp would need the other branch. It's one print statement, and it's the difference between correct labels and the incident above.
