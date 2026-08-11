<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **9 correction(s)** were applied.

### Meetings (when2meet) and quick polls in chat

Two independent features that share one idiom: a **room-scoped** table set, members-only reads through RLS that reuses the chat's own access gate, and **every write through a `SECURITY DEFINER` RPC**. Nothing here is a table you write directly.

Migrations: **0116** (meetings core), **0117** (proposal email + `p_email`), **0118** (confirmation email), **0119** (`create_scheduled_meeting`), **0121** (area-rename cascade), **0122** (family scope, date-range slots, finalize-as-Event), **0132/0133** (email recipients), **0149** (chat polls), **0183** (verified-member read tightening).

Everything below was checked against `pg_proc` / `pg_policies` / `information_schema` on the live project (`vrksrpzlslrcjvbzchfg`) on 2026-08-10, not just against the migration files — and the three query shapes this doc tells you to send (the `meetings` embed, `create_meeting`, `set_event_attendance`) were additionally **probed against live PostgREST** with the anon key, because two of them turn out to fail.

> **Live-data reality check, so you calibrate risk correctly:** `select count(*) from meetings` is **0**. Nobody has ever created a meeting in production. The web UI is fully built but effectively untested against real rows — which is how **three** separate defects survived: the `create_meeting` overload bug (§A.6), the `set_event_attendance` overload bug (§A.8), and the fact that web's `meetings` read **always errors and is swallowed into `[]`** (§A.9). All three are invisible when there are no rows: a read that can never succeed looks exactly like "no meetings yet". `chat_polls` has **1 poll, 3 options, 3 votes**, so polls have been exercised at least once — and polls are the part that actually works.

---

## A. Meetings

### A.1 What it is, and where it appears

An organizer proposes up to **10 candidate slots**; every member of the room marks **Yes / If-need-be / No** per slot; the organizer sees live tallies + a "best so far" slot and finalizes — either capturing a **Google Meet link** or **creating a real `events` row** whose RSVPs are pre-seeded from the votes.

Three web surfaces, worth mirroring because the split is deliberate:

| Surface | Web component | Role |
|---|---|---|
| Room ⋯ menu ("📅 Schedule a meeting") | `FeedView.tsx` → `MeetingComposer` | **Creation only.** Organizer-gated. Rare action, kept out of the composer bar. |
| Top of the chat body | `CommitteeChat.tsx:850` / `HouseChat.tsx:733` → `MeetingSection` | **Response bar.** Renders *nothing* unless a meeting is live. Owns the fetch + realtime + `?meeting=` deep link. |
| `/events` + committee page | `app/events/page.tsx:122` (`surface="card"`), `CommitteeDetail.tsx:301` | Same bar as a rounded card. |

The scheduler itself is `MeetingSchedulerSheet.tsx` (availability grid, tallies, who's-free expander, guided finalize).

### A.2 The three tables (exact columns, verified live)

```
meetings
  id uuid pk                       scope_type text NOT NULL  -- 'committee' | 'house' | 'family'
  committee_id uuid?               committee_slug text?      -- denormalised, never changes (0112)
  area text?                       -- NULL = the committee-wide "General" channel
  house_id uuid?
  title text NOT NULL              description text?
  created_by uuid?                 created_at timestamptz NOT NULL
  respond_by date?                 -- INFORMATIONAL ONLY. Nothing enforces it.
  status text NOT NULL default 'open'   -- 'open' | 'scheduled' | 'cancelled'
  chosen_slot_id uuid?             meet_url text?
      -- ⚠️ chosen_slot_id is an FK to meeting_slots(id) on delete set null
      --    (constraint `meetings_chosen_slot_fk`). That is a SECOND relationship
      --    between these two tables and it BREAKS the naive embed — see A.9.
  finalized_at timestamptz?        finalized_by uuid?
  notify_email boolean NOT NULL default false
  proposal_email_sent_at timestamptz?   confirm_email_sent_at timestamptz?
  created_event_id uuid?           -- set only by finalize_meeting_as_event

meeting_slots
  id uuid pk    meeting_id uuid NOT NULL   -- FK `meeting_slots_meeting_id_fkey`
  starts_at timestamptz NOT NULL
  duration_min int NOT NULL default 60
  position int NOT NULL default 0
  ends_at timestamptz?   -- SET ⇒ this slot is a DATE RANGE; duration_min is meaningless

meeting_availability
  meeting_id uuid NOT NULL   slot_id uuid NOT NULL   user_id uuid NOT NULL
  status text NOT NULL       -- 'yes' | 'if_need_be' | 'no'
  updated_at timestamptz NOT NULL
  PRIMARY KEY (slot_id, user_id)
```

Scope is enforced by a CHECK: committee ⇒ `committee_id` set / `house_id` null; house ⇒ the reverse; **family ⇒ BOTH null**. So in Swift, `committeeId` and `houseId` are both `String?` and you branch on `scopeType`, never on nil-ness of one field.

### A.3 RLS read rules — one sentence each

- **`meetings`**: you can read a row iff — committee scope: `can_access_committee_area(committee_id, area)`; house scope: `is_house_member(house_id)`; family scope: `is_approved_member()`.
- **`meeting_slots`**: readable iff its parent meeting is (an `exists` subquery over the same CASE).
- **`meeting_availability`**: readable iff its parent meeting is — i.e. **everyone in the room sees everyone's answers**, that's the whole point.

Plain-English versions of the helpers (live definitions, not guesses):
- `can_access_committee_area(cid, p_area)` → **app admin OR** you have a `committee_roster` row for that committee linked to your uid, **and** (`p_area is null` OR your `roles[]` contains `p_area` or `p_area || ' · Lead'`). Special case: `lower(p_area) = 'leads'` (and no real area literally named "Leads") → `is_committee_lead(cid)` with **no admin override**.
- `is_house_member(hid)` → `profiles.house_id = hid` **OR** app admin.
- `is_approved_member()` → `profiles.approved is true OR is_admin is true` (migration 0183).

⚠️ **An empty result means "not permitted", not "no meetings".** RLS filters; it never raises. An unapproved brand-new signup or a non-member who **is signed in** gets `[]` with HTTP 200 for every one of these tables. Don't render "No meetings yet" without knowing which case you're in — web's `fetchMeetingsForRoom` returns `[]` for *both*, and that ambiguity is exactly what hid the `committee_areas` outage documented in CLAUDE.md.

⚠️ **Signed OUT is different, and it is loud.** `anon` has no EXECUTE on `is_house_member` (0064 grants it to `authenticated` only), so an unauthenticated read of any of these four tables comes back **HTTP 401 `{"code":"42501","message":"permission denied for function is_house_member"}`** — verified live. Treat that specific 42501 as "no session", not as a broken policy, and make sure your client never fires these reads before the session is restored.

### A.4 The can-organize predicate

```sql
can_organize_meeting(p_scope text, p_committee_id uuid, p_area text, p_house_id uuid) -> boolean
```

App admin (any scope, unconditionally) **OR** — committee scope only — you have a roster row linked to your uid on that committee where:
- `p_area IS NULL` → any role matching `like '%· Lead'`, or
- `p_area` given → the exact string `p_area || ' · Lead'` is in `roles[]`.

Consequences: **houses and family scope are admin-only** (that falls out of "no branch matches" — there is no house-lead concept). And because the check is literal string concatenation, organizing in the pseudo-area `'Leads'` would require a role literally named `"Leads · Lead"` — so the Leads channel is admin-only in practice. Note the `·` is U+00B7 MIDDLE DOT surrounded by spaces (verified: bytes `c2 b7 20 4c 65 61 64`); get that character wrong anywhere and lead detection silently fails.

**Ask the server, don't infer.** Web calls the RPC (`fetchCanOrganize`) purely so the button can't drift from the gate. Do the same — one cheap round-trip, `false` on any error.

### A.5 RPC signatures — real parameter names, in order

```swift
// Propose slots and open voting.
create_meeting(p_scope, p_committee_id, p_area, p_house_id,
               p_title, p_description, p_slots, p_respond_by, p_email) -> uuid
//   p_slots is a jsonb ARRAY of objects: { "starts_at": ISO8601, "duration_min": Int, "ends_at": ISO8601|null }
//   1..10 elements or it raises. p_email true ⇒ stamps meetings.notify_email (the mini mails the room).
//   ⚠️ SEE A.6 BEFORE CALLING THIS.

// One known time, no voting — inserts the meeting + one slot and immediately
// calls finalize_meeting internally (posts the room message, notifies, emails).
create_scheduled_meeting(p_scope, p_committee_id, p_area, p_house_id,
                         p_title, p_description, p_starts_at,
                         p_duration_min, p_meet_url, p_ends_at) -> uuid

// My answers only, bulk upsert. p_answers is a jsonb OBJECT: { "<slot uuid>": "yes" | "if_need_be" | "no" }
set_my_availability(p_meeting, p_answers) -> void

// Outcome 1: a Google Meet link. Organizer (creator) or admin.
finalize_meeting(p_meeting, p_slot, p_meet_url) -> void

// Outcome 2: a real calendar Event. Same auth.
finalize_meeting_as_event(p_meeting, p_slot, p_kind, p_title, p_description, p_location) -> uuid
//   p_kind defaults 'work_weekend'; the others default null (title falls back to the meeting's).

cancel_meeting(p_meeting) -> void      // keeps the record, status='cancelled'
delete_meeting(p_meeting) -> void      // slots + availability cascade
can_organize_meeting(p_scope, p_committee_id, p_area, p_house_id) -> boolean
```

All are `grant execute ... to authenticated` and revoked from `anon` (confirmed via `has_function_privilege` on all nine).

⚠️ **`cancel`/`delete`/`finalize` are creator-or-admin — NOT lead-or-admin.** A committee lead who did not create the meeting can propose new ones but cannot finalize or cancel that one. Web's gate is literally `canManage = isAdmin || meeting.createdByMe`.

### A.6 ⚠️⚠️ STOP — `create_meeting` has TWO live overloads, and the one your call binds to is the broken one. THIS NEEDS A BACKEND FIX.

Verified in production `pg_proc`, both present:

| Overload | Origin | `'family'` scope | `ends_at` | `notify_email` |
|---|---|---|---|---|
| 9 args, ends `p_respond_by date, p_email boolean` | 0117 | **rejected — `raise exception 'Invalid scope'`** | **silently dropped** (its slot INSERT has no `ends_at` column) | yes |
| 8 args, ends `p_respond_by date` | 0122 | allowed | honoured | no |

0117 deliberately dropped 0116's 8-arg version "so there is only ONE overload — avoids the dual-overload trap from cabins 0092/0108". Then 0122 `create or replace`d an 8-arg signature — which **created a second overload instead of replacing anything**, re-opening the exact trap 0117 called out. Same story one function over: `create_scheduled_meeting` exists as both the 9-arg (0119) and the 10-arg (0122, with `p_ends_at`). **And a third time, in the Events half of this feature: `set_event_attendance` — see A.8.**

What this means concretely:

- A body carrying `p_email` (9 keys) can only bind the 0117 overload. So **web's own family-wide "📅 Propose dates" on `/events` raises `Invalid scope`**, and **every date-range slot loses its `ends_at`** and renders as a point-in-time call. Web has shipped this bug since 0122; zero meetings in prod is why nobody noticed.
- Omitting `p_email` does **not** silently mis-bind — it fails loudly and deterministically. Probed live: an 8-key body returns **HTTP 300 `PGRST203`, "Could not choose the best candidate function between: …(p_respond_by => date), …(p_respond_by => date, p_email => boolean)"**. Same for a 9-key `create_scheduled_meeting` body. Don't build on it either way.

**Hand this SQL to Brian to run** (repo convention: DB changes are handed over as SQL, never applied by an agent). It collapses to one function per name and is a no-op for existing rows:

```sql
-- Keep ONE create_meeting: the 9-arg (p_email) signature, with 0122's family +
-- ends_at body merged in.
drop function if exists public.create_meeting(text, uuid, text, uuid, text, text, jsonb, date);

create or replace function public.create_meeting(
  p_scope text, p_committee_id uuid, p_area text, p_house_id uuid,
  p_title text, p_description text, p_slots jsonb,
  p_respond_by date default null, p_email boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_slug text; v_title text; v_count int; v_actor text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_scope not in ('committee','house','family') then raise exception 'Invalid scope'; end if;
  if not public.can_organize_meeting(p_scope, p_committee_id, p_area, p_house_id) then
    raise exception 'Not authorized'; end if;
  v_title := btrim(coalesce(p_title,''));
  if v_title = '' then raise exception 'A title is required'; end if;
  if length(v_title) > 200 then raise exception 'Keep the title under 200 characters'; end if;
  v_count := coalesce(jsonb_array_length(p_slots),0);
  if v_count < 1 then raise exception 'Add at least one time option'; end if;
  if v_count > 10 then raise exception 'A meeting can have at most 10 time options'; end if;
  if p_scope = 'committee' then
    select slug into v_slug from public.committees where id = p_committee_id;
    if v_slug is null then raise exception 'Committee not found'; end if;
  end if;
  insert into public.meetings
    (scope_type, committee_id, committee_slug, area, house_id, title, description,
     created_by, respond_by, notify_email)
  values (p_scope, p_committee_id, v_slug, p_area, p_house_id, v_title,
          nullif(btrim(coalesce(p_description,'')),''), auth.uid(), p_respond_by,
          coalesce(p_email,false))
  returning id into v_id;
  insert into public.meeting_slots (meeting_id, starts_at, duration_min, position, ends_at)
  select v_id, (elem->>'starts_at')::timestamptz,
         coalesce((elem->>'duration_min')::int, 60), (ord-1)::int,
         (elem->>'ends_at')::timestamptz
  from jsonb_array_elements(p_slots) with ordinality as t(elem, ord);
  select coalesce(display_name,'Someone') into v_actor from public.profiles where id = auth.uid();
  perform public._notify_meeting_room(
    v_id, 'meeting_proposed', auth.uid(),
    v_actor || ' wants to schedule: ' || v_title, 'Tap to mark when you''re free',
    (select public._meeting_url(m) from public.meetings m where m.id = v_id));
  return v_id;
end; $$;
revoke all on function public.create_meeting(text, uuid, text, uuid, text, text, jsonb, date, boolean) from public, anon;
grant execute on function public.create_meeting(text, uuid, text, uuid, text, text, jsonb, date, boolean) to authenticated;

-- Same trap, one function over: drop the stale 9-arg version so only 0122's
-- 10-arg (p_ends_at) create_scheduled_meeting remains.
drop function if exists public.create_scheduled_meeting(text, uuid, text, uuid, text, text, timestamptz, int, text);

-- Same trap a THIRD time, and this one is why "reconfirm by tapping your RSVP"
-- does not work today (see A.8). 0036 dropped the 3-arg set_event_attendance and
-- created a 4-arg (…, p_title) that fans out event_rsvp; 0122 then `create or
-- replace`d the 3-ARG to add `confirmed = true` — a new overload, not a fix.
-- Every client sends p_title, so the 4-arg (no `confirmed`) is what runs, and a
-- 3-key call is ambiguous (PGRST203). Keep the 4-arg, add the confirm to it.
drop function if exists public.set_event_attendance(text, text, jsonb);

create or replace function public.set_event_attendance(
  p_event text, p_status text, p_days jsonb default null, p_title text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_event text := btrim(p_event);
  v_prev text; v_actor_name text; v_title text;
begin
  if v_actor is null then raise exception 'Sign in required'; end if;
  if coalesce(v_event,'') = '' then raise exception 'An event is required'; end if;
  if p_status not in ('going','maybe','not_going') then raise exception 'Invalid status'; end if;

  select status into v_prev from public.event_attendance
   where event_id = v_event and user_id = v_actor;

  insert into public.event_attendance (event_id, user_id, status, days)
  values (v_event, v_actor, p_status, p_days)
  on conflict (event_id, user_id)
  do update set status = excluded.status, days = excluded.days,
                confirmed = true, updated_at = now();

  if p_status = 'going' and v_prev is distinct from 'going' then
    select coalesce(display_name,'Someone') into v_actor_name
      from public.profiles where id = v_actor;
    v_title := coalesce(nullif(btrim(coalesce(p_title,'')),''),
                        (select title from public.events where id::text = v_event),
                        'an event');
    perform public._notify(p.id, 'event_rsvp', v_actor,
      v_actor_name || ' is going to ' || v_title, null, '/events', 'event', null, null)
    from public.profiles p
    where p.id <> v_actor and 'event_rsvp' = any(p.notif_types);
  end if;
end; $$;
revoke all on function public.set_event_attendance(text, text, jsonb, text) from public, anon;
grant execute on function public.set_event_attendance(text, text, jsonb, text) to authenticated;
```

**Until that runs**, ship iOS v1 as committee/house + point-in-time slots only (always send `p_email`), and skip family scope and date ranges. **After it runs**, always send all 9 / all 10 keys explicitly (see the Swift nil-omission trap in A.9).

### A.7 Date-RANGE slots (`ends_at`)

`meeting_slots.ends_at` non-null means the slot is a span ("Fri Jul 25 – Sun Jul 27"), not an hour, and `duration_min` is meaningless. Web stores local midnight for both ends (`new Date("2026-07-25T00:00").toISOString()`) and formats a range as two weekday/month/day labels with no clock. The composer offers a **Times vs Dates** toggle, defaulting to **Dates** for family scope and **Times** otherwise.

⚠️ Never derive the display day by parsing a bare `YYYY-MM-DD` (or a UTC-midnight instant) and formatting it in the device's zone — that's the off-by-one-day bug that mislabeled the whole fest sign-up UI (migration 0168 in CLAUDE.md), and it also silently corrupted the data the picker wrote. Here `starts_at`/`ends_at` are full `timestamptz`, so they're safe as long as you format them in a fixed calendar; `respond_by` is a bare `date` and must be treated as a calendar day string, never an instant.

### A.8 The TWO finalize outcomes

**1. `finalize_meeting(p_meeting, p_slot, p_meet_url)` — a Google Meet call.**
- Sets `status='scheduled'`, `chosen_slot_id`, `meet_url` (null if blank), `finalized_at/by`.
- **Posts a message into the room's chat as the finalizer**, straight into `committee_messages` (with `area = m.area`) or `house_messages`. Body: `📅 Meeting set — {title} · {Dy Mon DD, HH12:MI AM}` rendered `at time zone 'America/Chicago'` plus `\nJoin: {url}`. iOS does nothing here — the message arrives through your existing chat realtime. Because the RPC is SECURITY DEFINER, this insert bypasses RLS.
- Fans out `meeting_scheduled` to the room, with the `_meeting_url` web path.
- The **confirmation email** is not sent by this function: the mac-mini `alert-mailer.js` watches for a `meetings` UPDATE to `status='scheduled'` and is **gated on `meet_url` being non-null** (`if (!row || row.status !== "scheduled" || !row.meet_url || row.confirm_email_sent_at) return;`), so a linkless finalize waits and fires later when the link is added.
- **There is no status guard.** Calling it again on a scheduled meeting is the supported "Change time or link" path.
- Google Meet is **guided, not OAuth**: build a prefilled `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=<start>/<end>&details=…` link (compact UTC stamps, `20260720T143000Z`), the organizer taps it, adds Meet, saves, and pastes the link back into a field in your sheet. Web validates loosely: `^https?://` **and** host contains `meet.google.com` / `calendar.google.com` / `goo.gl`. A blank link is explicitly allowed.

**2. `finalize_meeting_as_event(p_meeting, p_slot, p_kind, p_title, p_description, p_location)` — a real calendar Event.**
- Inserts into `events` with `source='meeting'`, `source_meeting_id = p_meeting`, `start_date` = the slot's start **in America/Chicago**, `end_date` = the slot's `ends_at` date or null. Sets `meetings.created_event_id` for the reverse link and marks the meeting scheduled.
- **Carries RSVPs over as UNCONFIRMED.** Every `meeting_availability` row on the winning slot with `yes` → `going`, `if_need_be` → `maybe`, inserted into `event_attendance` with **`confirmed = false`**. `'no'` voters get no row at all. Note `event_attendance.event_id` is **TEXT** (`v_event_id::text`), not a uuid FK — that table also holds seed slugs like `family-fest-2026`.
- ⚠️⚠️ **Re-confirming is BROKEN today — `set_event_attendance` has two live overloads too.** `pg_proc` holds both `set_event_attendance(text, text, jsonb)` (created by 0122; its upsert ends `… confirmed = true, updated_at = now()`) and `set_event_attendance(text, text, jsonb, text)` (0036; its upsert never mentions `confirmed`, and it is the one that fans out `event_rsvp`). Every client sends `p_title`, so the **4-arg** runs and `confirmed` stays `false` forever; a 3-key call returns **HTTP 300 `PGRST203`** (probed live), so the confirming body is unreachable over REST. Web papers over it optimistically (`confirmed: true` in local state, comment: "mirrors set_event_attendance's upsert") and the next refetch reverts it. Net effect until the §A.6 SQL runs: the "(hasn't confirmed)" tag never clears and the `onlyUnconfirmed` reminder re-nudges people who already re-answered. **Don't build the reconfirm loop on top of this.** Once fixed, the verb stays the same — tapping your existing Going/Maybe/Can't control *is* the confirmation, and your Events UI should show a quiet "(hasn't confirmed)" tag next to unconfirmed names, like web's `EventSheet`.
- Auto-queues one `scheduled_broadcasts` reminder 14 days before the event at 09:00 Central (skipped if already past) with `payload.onlyUnconfirmed = true`; `run_scheduled_broadcasts()` (pg_cron) narrows that send to people with no row or `confirmed = false`. Nothing for iOS to build — but know its shape: that reminder is written **directly into `notifications` by `run_scheduled_broadcasts`, not through `_notify`**, as `type='broadcast'`, `entity_type='broadcast'`, **no `entity_id`**, url `/events?open=<event id>`. Its push is therefore gated on the **`alerts`** push category, not on `meeting_scheduled`, and it carries no `target_id` to route on.
- Its own `meeting_scheduled` fan-out does **not** use `_meeting_url`: title `Event created: {title}`, body `Dy Mon DD` (with ` – Dy Mon DD` for a range), url `/events?open=<event id>` — while the notification's entity stays `('meeting', p_meeting)`, so `target_id` is the **meeting** id and the url points at the **event**. Handle that mismatch deliberately.
- ⚠️ **Also has no status guard, and no uniqueness protection.** Calling it twice creates **two** `events` rows and leaves `created_event_id` pointing at the second. Disable the button once `createdEventId != nil` (web hides the finalize affordance in that state: `canManage && !meeting.createdEventId`).
- Available in **every** scope, not just family — a committee meeting can become an Event too. Web defaults the outcome toggle to "event" for family scope and "call" otherwise.

### A.9 Writing this in Swift

**Reads.** One query for meetings with slots embedded, one for availability, then compute everything client-side:

```swift
struct MeetingRow: Decodable {
  let id: String
  let scope_type: String              // "committee" | "house" | "family"
  let committee_slug: String?
  let area: String?
  let house_id: String?
  let title: String
  let description: String?
  let created_by: String?
  let created_at: Date
  let respond_by: String?             // bare "YYYY-MM-DD" — keep it a String
  let status: String                  // "open" | "scheduled" | "cancelled"
  let chosen_slot_id: String?
  let meet_url: String?
  let created_event_id: String?
  let meeting_slots: [SlotRow]?       // decode optional, default []
}
struct SlotRow: Decodable {
  let id: String; let starts_at: Date; let ends_at: Date?
  let duration_min: Int; let position: Int
}
struct AvailabilityRow: Decodable {
  let meeting_id: String; let slot_id: String; let user_id: String; let status: String
}
```

⚠️⚠️ **The embed MUST name the foreign key. Do not copy web's select string — it is broken.** There are **two** relationships between `meetings` and `meeting_slots`: `meeting_slots.meeting_id → meetings.id` (`meeting_slots_meeting_id_fkey`, one-to-many) **and** `meetings.chosen_slot_id → meeting_slots.id` (`meetings_chosen_slot_fk`, many-to-one, added at the bottom of 0116). An unqualified `meeting_slots(...)` embed therefore returns **HTTP 300 `PGRST201` "Could not embed because more than one relationship was found for 'meetings' and 'meeting_slots'"** — probed live 2026-08-10. This is the *same* trap as the tournaments↔entrants case in MEMORY, not a contrast to it. Web's `fetchMeetingsForRoom` ships the unqualified form and swallows the error into `return []`, so **the entire meetings read path on web is dead right now** and nobody can see it, because there are no meetings to miss.

Select string (this is the CORRECTED one — the FK hint is load-bearing):

```
id, scope_type, committee_slug, area, house_id, title, description, created_by,
created_at, respond_by, status, chosen_slot_id, meet_url, created_event_id,
meeting_slots!meeting_slots_meeting_id_fkey(id, starts_at, ends_at, duration_min, position)
```

The JSON key stays `meeting_slots` (the hint after `!` is not part of the key), so `MeetingRow` above decodes unchanged. If you'd rather be explicit, alias it: `slots:meeting_slots!meeting_slots_meeting_id_fkey(...)` and rename the property to `slots`.

Filters: committee → `.eq("scope_type","committee").eq("committee_slug", slug)` then **`.is("area", value: nil)` for the General channel** or `.eq("area", area)`; house → `.eq("scope_type","house").eq("house_id", houseId)`; family → `.eq("scope_type","family")`. Order `created_at` descending. Then one `meeting_availability` select with `.in("meeting_id", values: ids)` (that one is a plain table read — no embed, no ambiguity).

- **Never swallow a read error into `[]`.** That single habit is what hid this bug on web for months. Log `PGRST201` / `PGRST203` / `42501` distinctly and surface them in debug builds — RLS emptiness and a malformed query are different states.
- **Derived values, computed client-side — there are no columns for these.** Per slot: bucket `user_id`s into yes / ifNeedBe / no; `score = yes.count + ifNeedBe.count * 0.5`; `bestSlotId` = highest score with ties going to the first slot in (position, starts_at) order; `respondentCount` = distinct `user_id`s across the whole meeting; `myAnswers[slotId]` = your own rows. Resolve `user_id` → name against the room roster you already have, falling back to `"A member"`, and print `"You"` for yourself.
- ⚠️ Resolve "is this mine" from the **effective** user id, and make every write a no-op while previewing as another member — the web app's hard rule after admin Edit/Delete affordances leaked onto a previewed member's screen. Also key any on-device cache by the **real uid**: a shared cache key once leaked one member's private chat to the next user on the same device (CLAUDE.md, PR #244).

**Writes — the nil-omission trap.** Swift's synthesized `Encodable` uses `encodeIfPresent`, so a `nil` optional **omits the key entirely**. For overloaded functions (§A.6) an omitted key changes which function you bind to — or, more precisely, makes the call fail with `PGRST203`; for `p_answers`-style payloads it changes semantics. Encode nulls explicitly — a custom `encode(to:)` using `container.encode(...)`, or build the params as `[String: AnyJSON]` with `AnyJSON.null`.

**Enum raw values must be exact.** `set_my_availability` filters with `where (value #>> '{}') in ('yes','if_need_be','no')` and only upserts slot ids that belong to the meeting — anything else is **silently skipped and the call returns success**. So `"if-need-be"` (hyphens) writes nothing, reports nothing, and looks like a UI bug. Same shape of trap in `create_meeting`'s `p_slots`: a misspelled `starts_at` key becomes NULL and hits a not-null violation (that one at least fails loudly).

**`set_my_availability` is upsert-only.** Omitted slots keep their previous answer, and there is **no delete path** — a member can change an answer but can never un-answer. Don't build a "clear" affordance. It also raises `This meeting is closed` for any `status <> 'open'`. Web sends the full draft map (seeded from `myAnswers`) every time; do the same.

**Dates.** `timestamptz` arrives as `2026-07-31T09:00:00.123456+00:00` (up to 6 fractional digits) and sometimes with none at all; a single `ISO8601DateFormatter` config will throw on one of those. Use a lenient `JSONDecoder.dateDecodingStrategy = .custom` that tries with and without fractional seconds. `date` columns (`respond_by`, and `closes_on` in part B) are `"2026-07-31"` — decode as `String`.

**Realtime.** Web opens one channel per room, `meetings-<roomKey>` where roomKey is `c:<slug>|<area>` / `h:<houseId>` / `family`, subscribing to `postgres_changes` `event: "*"` on **all three** tables with **no filter**, then **debounces ~250ms and refetches everything**. Copy that: the useful values (buckets, score, best slot, respondent count) are all derived, so applying row deltas by hand is not worth it. All three tables are in the `supabase_realtime` publication with `replica identity full` (verified). Tear the channel down when the room closes. Realtime honours RLS, so you only receive rows you could read anyway.

**What does NOT transfer from web:** the `localStorage` SWR snapshot (`meetings.<uid>.<roomKey>`), the `?meeting=<id>` URL-param deep link, and `window.confirm` for the cancel/delete confirmations. Use your own store, your own route, and a native alert.

### A.10 Notifications, push, email

- Two kinds, both fanned out by `_notify_meeting_room`: **`meeting_proposed`** ("{name} wants to schedule: {title}" / "Tap to mark when you're free") and **`meeting_scheduled`**. `_notify` skips the actor and honours the recipient's `profiles.notif_types` (only `help_urgent` is exempt from that gate).
- The fan-out predicate is *close to* but not identical to the read gate: committee → `committee_roster` rows for that slug with `linked_user_id is not null` and (`area is null` OR the area / `'<area> · Lead'` in `roles[]`); house → `profiles` in that house. Both read gates additionally return true for an app admin, so **an admin who isn't roster-linked (or isn't in the house) can read a meeting and is never told about it.** For an area-null General meeting, every roster-linked member of the committee is notified.
- ⚠️ For **family** scope the fan-out is `from public.profiles p` with **no filter at all** — every profile row, including brand-new unapproved signups who cannot read the meeting they were just told about. Not yours to fix, but don't be surprised.
- In-app is **ON by default** (both are in the live `notif_types` column default). **Phone push is OFF by default** — neither is in `DEFAULT_PUSH_TYPES`, though both are in `apns-sender.js`'s `PUSHABLE` set, gated on `push_types.includes(n.type)`. So a member must opt in per category. (`push_types` defaults to `'{}'`: no push at all until the first-run prompt is accepted.)
- Deep links live in the notification's `url`, built by `_meeting_url` as **web paths**: `/posts?c=<slug>[&area=<area>]&meeting=<id>`, `/posts?house=<slug>&meeting=<id>`, or `/events?meeting=<id>` for family. The one exception is `finalize_meeting_as_event`, which sends `/events?open=<event id>` instead (see A.8). APNs payload is `{ title, body, url: APP_URL + n.url, type, target_type: n.entity_type, target_id: n.entity_id }` — `'meeting'` / the meeting id here, `'chat_poll'` / the poll id in part B — so **prefer `target_type`/`target_id`** over parsing the URL.
- Emails are entirely mac-mini side effects; iOS only surfaces the **"Also email everyone a link to vote"** checkbox (→ `p_email`, default **off**). Recipient RPCs are `service_role`-only, so there is nothing for the app to call. Principle from 0132/0133: `profiles.email_alerts` gates **only** broadcast alerts — transactional meeting emails **override** it and reach verified members, invited-but-unverified accounts, and account-less roster people with an email (`committee_roster` for committee meetings, `family_roster` for house meetings).

### A.11 Honest sizing, and a v1 cut

Meetings is the **largest** thing in this handoff — plan on multiple days, not one. The pieces: a two-mode composer (Find a time / Set a time now) with a Times/Dates toggle and up to 10 slot rows; a scheduler sheet with per-slot tri-state controls, live tallies, an expandable who's-free list, and a two-outcome guided finalize; the conditional response bar; the organizer gate; three mount points; realtime; and the Events-side unconfirmed-RSVP surfacing.

**A defensible v1:** committee + house scope, point-in-time slots only, propose → vote → `finalize_meeting` with a Meet link, the response bar in both chat views, plus the two notification kinds. **You will be the first person to ever see a real meeting row render** — the named-FK embed in A.9 is the difference between that working and another silent `[]`.
**Defer:** family scope and date ranges (both blocked on the §A.6 SQL anyway), `finalize_meeting_as_event` and the whole unconfirmed-RSVP surface (also blocked on the §A.6 SQL — the `set_event_attendance` half), "Set a time now", the proposal-email checkbox, and the committee-page/Events card mounts.

---

## B. Quick polls in chat (migration 0149)

An iMessage-style poll any **room member** can drop into a committee or house chat (never the Main Feed — it isn't a room): a question, 2–10 options, single- or multi-select, an optional write-in "Other", and anonymous-vs-attributed results. Note the doctrine difference from meetings: **no organizer gate** — anyone who can read the room can start a poll.

### B.1 ⚠️⚠️ Anonymity is enforced in SQL. Do NOT read `chat_poll_votes`.

Verified live: `chat_poll_votes` has **RLS enabled and ZERO policies**.

That is not a missing-policy bug, it's the design (same deny-all doctrine as `content_embeddings`). And here is the part that will waste your afternoon if you don't internalise it: **the table grants still exist** — `anon` and `authenticated` both hold SELECT on it (the migration's header says it gets "NO select grant at all"; that never happened, and Supabase's default privileges granted it anyway). So a `from("chat_poll_votes").select()` does **not** 403 and does **not** error. Probed live: it returns **`[]`, HTTP 200, no error** — always, for everyone, including for your own votes. RLS filters, it doesn't raise. If you build a tally off that query you will ship a poll UI that permanently reads "0 votes" and looks like a data problem. (This is the same failure mode as the `committee_areas` incident that made every subcommittee invisible for weeks — see CLAUDE.md. When a list reads empty but writes clearly work, check `pg_policies` first.)

Consequences, all deliberate:
- **Tallies come from denormalised columns**, not from counting votes: `chat_poll_options.vote_count` and `chat_polls.respondent_count` (distinct voters), both maintained by the `AFTER INSERT OR DELETE` row trigger `chat_poll_votes_recount` (function `_chat_poll_votes_recount`) on `chat_poll_votes`. These are the only numbers you should ever display.
- **Realtime publishes `chat_polls` + `chat_poll_options` only** — `chat_poll_votes` is deliberately not in the publication ("there is nothing safe to broadcast from it"), confirmed against `pg_publication_tables`. This still works: someone else voting fires the trigger, which UPDATEs `chat_poll_options`, which arrives on your channel. So tallies move live without any vote row ever crossing the wire.
- **Identity is revealed in exactly one place**, `chat_poll_voters(p_poll)`, and it `return '[]'::jsonb` when `chat_polls.anonymous` is true (it raises `Not authorized` for a non-member). The server refuses; your client never has to be trusted with the check. Web's `ChatPollCard` still short-circuits on `poll.anonymous` as an optimisation, but the guarantee is server-side.

### B.2 The tables

```
chat_polls
  id uuid pk   scope_type text NOT NULL      -- 'committee' | 'house' ONLY (no 'family')
  committee_id uuid?  committee_slug text?  area text?  house_id uuid?
  question text NOT NULL                     -- ≤300 chars, enforced
  allow_multiple boolean NOT NULL default false
  anonymous boolean NOT NULL default false
  allow_other boolean NOT NULL default false
  created_by uuid?   created_at timestamptz NOT NULL
  closes_on date?                            -- null ⇒ open until closed by hand
  is_closed boolean NOT NULL default false
  respondent_count int NOT NULL default 0    -- distinct voters, trigger-maintained

chat_poll_options
  id uuid pk  poll_id uuid NOT NULL  label text NOT NULL
  position int NOT NULL  is_other boolean NOT NULL  vote_count int NOT NULL  -- trigger-maintained

chat_poll_votes  -- ⚠️ UNREADABLE BY DESIGN (see B.1)
  poll_id, option_id, user_id, other_text text?, created_at
  PRIMARY KEY (poll_id, option_id, user_id)   -- multi-select ⇒ several rows per voter
```

RLS reads: **`chat_polls`** — readable iff you can access its room (`can_access_committee_area(committee_id, area)` for committee, `is_house_member(house_id)` for house). **`chat_poll_options`** — readable iff its parent poll is. **`chat_poll_votes`** — readable by nobody, ever. Migration 0183 deliberately left these alone: they're already gated on real membership, which is stricter than the approved-member check.

⚠️ And if you're tempted to skip the RPC and read the two readable tables directly: `chat_polls?select=id,chat_poll_options(...)` **also** returns HTTP 300 `PGRST201` (probed live), because `chat_poll_votes` forms a second, many-to-many relationship between them. You'd have to write `chat_poll_options!chat_poll_options_poll_id_fkey(...)`. Don't — you'd still be missing `my_option_ids` and every count would need the unreadable votes table. Use `fetch_chat_polls_for_room`.

### B.3 What to call instead

```swift
// The whole room's polls + counts + YOUR OWN selections. Returns jsonb (a JSON array).
fetch_chat_polls_for_room(p_scope, p_committee_id, p_area, p_house_id) -> jsonb

// Per-voter identity. Returns [] when the poll is anonymous. Call once per card.
chat_poll_voters(p_poll) -> jsonb

// Full-REPLACE of my own votes in one call — handles single/multi/"Other".
set_chat_poll_votes(p_poll, p_option_ids, p_other_text) -> void

// Any room member creates; refuses in an archived committee area.
create_chat_poll(p_scope, p_committee_id, p_area, p_house_id, p_question, p_options,
                 p_allow_multiple, p_anonymous, p_allow_other, p_closes_on) -> uuid

close_chat_poll(p_poll) -> void    // creator or admin
delete_chat_poll(p_poll) -> void   // creator or admin; options + votes cascade
```

`fetch_chat_polls_for_room` **re-checks membership itself** (a SECURITY DEFINER function bypasses your RLS), so passing someone else's committee/house id returns `[]` rather than leaking. Which means: **empty is still ambiguous** between "not a member" and "no polls". Note it matches on `p.committee_id = p_committee_id` (the committee **uuid**, not the slug) and `p.area is not distinct from p_area`, so `null` really does mean the General channel; results come back newest-first (`order by t.created_at desc`).

Each element of the returned array:

```swift
struct ChatPollRow: Decodable {
  let id: String
  let question: String
  let allow_multiple: Bool
  let anonymous: Bool
  let allow_other: Bool
  let created_by: String?
  let created_by_me: Bool          // server-computed (created_by = auth.uid())
  let created_at: Date
  let closes_on: String?           // bare "YYYY-MM-DD"
  let is_closed: Bool
  let respondent_count: Int
  let options: [OptionRow]         // always present, sorted by position server-side
  let my_option_ids: [String]      // coalesced to [], never null
  let my_other_text: String?
}
struct OptionRow: Decodable {
  let id: String; let label: String; let position: Int
  let is_other: Bool; let vote_count: Int
}
struct VoterRow: Decodable {       // from chat_poll_voters
  let option_id: String; let user_id: String
  let name: String; let avatar_url: String?; let other_text: String?
}
```

Swift specifics:
- Both RPCs return **`jsonb`, not a table** — PostgREST puts the array in the response body directly. Decode `[ChatPollRow].self` straight off `.execute()`; don't wrap it.
- `p_option_ids` is `uuid[]` → send `[String]` of uuid strings; an empty array is the valid "clear my vote" payload.
- `p_options` is `text[]` → `[String]`. Blank entries are dropped server-side; what's left must be 2–10 or it raises. An "Other" slot is appended automatically when `p_allow_other` is true (label `'Other'`, `is_other = true`) and does **not** count against the 10.
- ⚠️ `set_chat_poll_votes` is a **full replace of your own rows** — it deletes any of your votes not in `p_option_ids`. For a single-select poll always send exactly one id; for multi-select send the complete new set, never a delta. It raises on: closed poll, an option id not in the poll, more than one id when `allow_multiple` is false, and **`Other` selected with blank text ("Say what \"Other\" means")** — so validate the write-in before sending.

### B.4 The closed rule — and a small web bug not to copy

The server rejects a vote when `is_closed OR (closes_on is not null AND closes_on < current_date)`. Web's `ChatPollCard` only checks `poll.isClosed` (every `disabled=` on the card is `poll.isClosed`), so a poll past its `closes_on` still renders as votable and the tap fails server-side with "This poll is closed". **Derive it properly on iOS:** `closed = is_closed || (closes_on != nil && closes_on! < todayYMD)`, comparing the strings as calendar days. (The database session timezone is `UTC` — verified — so `current_date` flips in the early evening Central; the boundary is fuzzy by a few hours either way. Don't try to be cleverer than a day comparison.)

### B.5 Rendering: INLINE in the timeline, not a pinned bar

The first cut pinned open polls in a top bar mirroring `MeetingSection`, and it was **too easy to miss** because that isn't where anyone is looking. Both chat views now merge polls into the message list client-side:

```swift
enum TimelineItem { case message(Msg), poll(ChatPoll) }   // sorted ascending by ts / createdAt
```

`ts` for a message, `createdAt` for a poll, ascending, then run through the same day-grouping you already use for date separators. A poll renders as a **full-width, room-wide card** — not attached to any sender's bubble, no avatar gutter — and is interactive in place: tapping an option votes immediately, no sheet.

Card details worth copying: per-option bar fill at `vote_count / respondent_count` (yes, respondents, not total votes — multi-select can therefore sum past 100%), a `✓` on your own picks, `vote_count · pct` on the right, a row of ≤8 small avatars under each option when the poll isn't anonymous (`+N` beyond that), the write-in rendered as `name: text` lines instead of avatars, and for an anonymous poll with write-ins a bare "N write-in answers (anonymous)". Close/Delete sit on the card for `isAdmin || created_by_me`.

⚠️ **Web's vote path is not optimistic** — it awaits the RPC then refetches the whole room (`if (!error) await reloadPolls()`), so a tap visibly lags. Worth doing better natively, but if you paint optimistically remember `respondent_count` is **distinct voters**: adding your second pick in a multi-select must not increment it.

Realtime: one channel `chat-polls-<roomKey>` on `chat_polls` and `chat_poll_options` (never votes), debounced ~250ms → refetch. Web caches under `chatPolls.<uid>.<roomKey>`; same uid-scoping rule as A.9.

⚠️ The notification's deep link is `/posts?c=<slug>[&area=]&poll=<id>` (or `?house=<slug>&poll=<id>`), but **no web client code reads `?poll=` at all** (grep-confirmed) — the link opens the room and drops you wherever the room happens to scroll. Either wire `target_id` to scroll-and-flash the poll (nicer than web) or at least know that the id in the URL is currently decorative. Notification kind: **`chat_poll_created`** (`entity_type = 'chat_poll'`), in-app on by default, push opt-in, relayed by `apns-sender.js`. No notification on vote or close.

### B.6 ⚠️⚠️ The file-picker-in-a-popup incident — and what it means for a native photo picker

This is a chat-composer story, and it's here because it's the reason the poll button lives where it does.

Attaching a photo in a committee/house chat was **silently, completely dead in the installed iOS PWA** for as long as the `+` popup menu existed. The `+` opened a small `framer-motion` spring-in menu (Photo Library / Take Photo / Document / Poll) and `.click()`ed one of three hidden file `<input>`s from **inside** it. On a standalone iOS home-screen app the native picker opened, you could select a photo and tap the checkmark — and **nothing arrived in the composer, with no error of any kind**. It read as "sending photos just doesn't work". Non-standalone Safari was fine. The Main Feed's post composer was fine, and its only structural difference was a plain, always-mounted trigger.

**Three fixes were attempted and all failed on-device** — recorded so nobody retries them:
1. mounting the inputs unconditionally at the composer root, outside the menu, so nothing unmounted them mid-pick;
2. not closing the menu on tap, so it only dismissed after the picker resolved;
3. `sr-only` instead of `hidden`, on the theory a laid-out input receives the selection more reliably.

What actually fixed it was **deleting the popup, not the `+`**. The glyph was never the problem. Today `CommitteeChat.tsx:1040–1046` is exactly:

```tsx
<button onClick={() => fileRef.current?.click()} aria-label="Attach a photo, video, or file">+</button>
<input ref={fileRef} type="file" multiple onChange={pickFiles} className="hidden" />
```

— trigger and input as plain always-mounted siblings, no overlay, nothing conditionally rendered anywhere in the path, and deliberately **no `accept` filter** so iOS's own action sheet still offers Photo Library / Take Photo or Video / Choose File from one button. The accepted regression was losing the one-tap `capture="environment"` camera shortcut. **Poll (and "Schedule a meeting", and "Email members") moved into the room's ⋯ menu precisely because they are not file pickers** — the rule that came out of it was: *if an action needs to live behind a menu, it must not be a file picker; move the other actions there instead.* (The one leftover: the standalone, non-embedded chat route has no ⋯ menu, so it still keeps a poll button in the composer next to `+`.)

**What transfers to native, and what doesn't:**
- The bug itself is a **WebKit/PWA** bug. `PhotosPicker` and `UIImagePickerController` are not affected by it, and you get real camera + Files + library APIs instead of one unfiltered `<input>`. So do **not** port the "one unfiltered button" compromise — offer Photo Library / Take Photo / Choose File as three explicit destinations, which is what the web menu was trying to be.
- The transferable lesson is about **presenter lifetime**. Attach `.photosPicker(isPresented:)` / `.sheet` / `.fullScreenCover` to a **stable parent** (the composer root), and never let the action that opens the picker also dismiss the thing that owns it. A `Menu` item, a popover, or a context menu that tears itself down while presenting is the same class of mistake, and in SwiftUI it presents as the same symptom: the picker appears, the user picks, and your `onChange`/completion never fires. Keep the selection binding on the composer's own state, not on the menu's.
- **Verify on a real device in the real installed app.** Every server-side check on the web bug came back healthy — HTTP 200, clean console, valid manifest — so curl and a headless browser both said "fine" while the feature was 100% broken for the family. The native analogue: the simulator's photo library and a canned asset will happily pass a flow that fails against a real camera roll, a HEIC original, or an iCloud-optimised photo that has to download first. (Related, from CLAUDE.md: `<canvas>`/re-encode strips EXIF — read capture metadata off the **original** asset before any resize. Natively, take `PHAsset.creationDate`, which is strictly better than what the web has.)

### B.7 Sizing and a v1 cut

Polls are **small-to-medium** — roughly a composer sheet, one card view, a service with six calls, and a timeline merge. Everything hard (anonymity, counts, validation) is already server-side, and unlike meetings this half is **known-working in production**.

**v1:** create (question + 2–10 options + single/multi + anonymous), inline card with counts and your own picks, vote via `set_chat_poll_votes`, close/delete for creator-or-admin, realtime tallies, and the `chat_poll_created` notification.
**Defer cheaply:** the "Other" write-in (an extra option kind plus an inline text field and its "Say what Other means" error), the attributed-results avatar rows (`chat_poll_voters` — one extra call per card), and `closes_on`.

---

## C. One-page recap of the traps

| ⚠️ | Where | What bites you |
|---|---|---|
| ⚠️⚠️ | `meetings` → `meeting_slots` embed | **TWO** relationships exist (`meeting_slots_meeting_id_fkey` + `meetings_chosen_slot_fk` from `chosen_slot_id`). An unqualified `meeting_slots(...)` embed returns **HTTP 300 `PGRST201`** — web ships exactly that and swallows it into `[]`, so the meetings read path is dead today. Use `meeting_slots!meeting_slots_meeting_id_fkey(...)`. |
| ⚠️⚠️ | `create_meeting` | Two live overloads. A body with `p_email` binds the 0117 one: **`'family'` raises "Invalid scope"** and **`ends_at` is silently dropped**. Omitting `p_email` → `PGRST203`, HTTP 300. Needs the §A.6 SQL. |
| ⚠️⚠️ | `create_scheduled_meeting` | Same duplication (9-arg 0119 vs 10-arg 0122). Always send `p_ends_at`, even as explicit null. |
| ⚠️⚠️ | `set_event_attendance` | The trap a **third** time: 3-arg (0122) sets `confirmed = true`, 4-arg (0036, `p_title`) does not — and 4-arg is what every client binds, while a 3-key call is `PGRST203`. So **nothing can clear `confirmed = false`** today. Don't build the reconfirm loop until the §A.6 SQL runs. |
| ⚠️⚠️ | `chat_poll_votes` | RLS on, **zero policies**, grants still present → SELECT returns `[]` with **no error, forever** (probed). Never query it. Counts come from `vote_count` / `respondent_count`. |
| ⚠️ | Every table here | Empty result = "not permitted" at least as often as "no data" — for a **signed-in** caller. Unapproved signups (0183) read nothing. **Signed OUT** is a hard `401 / 42501 permission denied for function is_house_member`. Never collapse an error into `[]`. |
| ⚠️ | `set_my_availability` | Bad status strings and foreign slot ids are **silently skipped, call succeeds**. Exactly `yes` / `if_need_be` / `no`. Upsert-only — no way to un-answer. Raises on any non-`open` meeting. |
| ⚠️ | Swift `Encodable` | `nil` optionals **omit the key**, which changes overload resolution (and here means a 300, not a wrong answer). Encode nulls explicitly. |
| ⚠️ | `finalize_meeting_as_event` | No status guard, no uniqueness — a second call creates a second `events` row. Gate on `created_event_id != nil`. Its notification points at `/events?open=<event id>` while `target_id` is still the **meeting** id. |
| ⚠️ | `finalize_meeting` | Also unguarded — that's the supported "Change time or link". It writes a chat message itself; don't double-post. |
| ⚠️ | Cancel/delete/finalize | **Creator-or-admin**, not lead-or-admin. `canManage = isAdmin || createdByMe`. |
| ⚠️ | Notification fan-out | `_notify_meeting_room` keys on roster/house membership, so a **non-roster admin can read a meeting and never hear about it**. The 14-day "still coming?" nudge is a `broadcast` notification written directly by `run_scheduled_broadcasts` (no `entity_id`, gated on the `alerts` push category). |
| ⚠️ | `closes_on` / `respond_by` | Bare `YYYY-MM-DD`. Never parse as a UTC instant then format locally (the 0168 day-shift). `respond_by` enforces nothing. |
| ⚠️ | Chat poll cards | Web ignores `closes_on` when disabling the card — derive `closed` yourself or the tap dead-ends. |
| ⚠️ | Notification URLs | Web paths (`/posts?c=…&meeting=…`, `/events?meeting=…`, `…&poll=…`). Prefer APNs `target_type`/`target_id`; nothing reads `?poll=` today. |
| ⚠️ | Photo picker | Keep trigger and presenter plain and stably mounted; never dismiss the owner in the same action. Test on a real device, in the real installed app. |
| ⚠️ | Caches | Key by the real uid and clear on sign-out — a shared key once leaked one member's private chat to the next user. |
