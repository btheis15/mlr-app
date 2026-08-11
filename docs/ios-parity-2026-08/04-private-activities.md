<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **9 correction(s)** were applied.

### Private activities

A **member-created, invite-only get-together** that lives on the Events screen and is visible ONLY to the people it's shared with. The use case: someone wants to run a quick ping-pong / baggo tournament with a few family members over a random weekend — no resort-wide event, no announcement, and nobody notified unless the organizer explicitly asks for it. Optionally it hosts a full tournament (the same bracket/round-robin/pools machinery as a Family Fest activity).

**iOS has none of this today.** Everything below already exists in Supabase — this is a pure Swift build with **no backend change required** (one possible exception flagged under *Verify this* at the end).

Migrations: `0150_private_activities.sql` (everything core), `0151_one_tournament_per_activity.sql`, `0152_activity_tournament_autoseed.sql`, `0153_activity_individual_entrants.sql`, `0154_set_tournament_format.sql`. Migration `0183_verified_member_reads.sql` later re-gated the four tournament read policies (see *RLS* below). Web client seam to read alongside this: `lib/privateActivities.ts`, `components/PrivateActivityComposer.tsx`, `components/PrivateActivitySheet.tsx`, `app/events/page.tsx`, `usePrivateActivities()` in `lib/hooks.ts`.

---

#### 1. The two tables

**`private_activities`**

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `default gen_random_uuid()` |
| `title` | text **NOT NULL** | |
| `emoji` | text NULL | one or two chars, stored as text |
| `description` | text NULL | |
| `location` | text NULL | free text ("Garage / dock / rec room") |
| `starts_at` | timestamptz NULL | **null = "sometime" / TBD** — this is the normal case, not an error |
| `ends_at` | timestamptz NULL | nothing in the web UI ever sets this; expect null |
| `tournament_enabled` | boolean NOT NULL | `default false` — but the web composer's "🏆 Make it a tournament" toggle defaults **ON**, so most existing rows are `true` |
| `archived_at` | timestamptz NULL | set = a finished game, tucked away (still deletable) |
| `created_by` | uuid NOT NULL | → `profiles(id) on delete cascade` |
| `created_at` | timestamptz NOT NULL | `default now()` |
| `updated_at` | timestamptz NOT NULL | maintained by the trigger `private_activities_set_updated_at`, which calls the shared `set_updated_at()` — defined in **`0001_profiles.sql`**, not 0035 (0150's own comment misattributes it) |

**`private_activity_members`** — the roster, i.e. who it's shared with.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | this is what the remove/role RPCs take, **not** the user id |
| `activity_id` | uuid NOT NULL | → `private_activities(id) on delete cascade` |
| `user_id` | uuid NULL | → `profiles(id) **on delete set null**` — null = a typed-in name |
| `name` | text **NOT NULL** | snapshot; for a linked member it's their `display_name` at add time |
| `role` | text NOT NULL | `default 'player'`, `check (role in ('host','player'))` |
| `rsvp` | text NULL | `check (rsvp in ('going','maybe','out'))` — null = no answer yet |
| `created_at` | timestamptz NOT NULL | the **tournament seeder's** order key (`_seed_activity_tournament` … `order by created_at`) and the roster **tiebreak** — see the display-order note below |
| `added_by` | uuid NULL | → `profiles(id) on delete set null` |

⚠️ **Roster display order is not plain `created_at`.** The web fetch sorts **hosts first**, `created_at` only within a role (`lib/privateActivities.ts`), and then `PrivateActivitySheet` renders `[...going, ...other]` — everyone whose `rsvp == "going"` first. If you want the web's look, copy both steps; `created_at` alone will order it differently.

Unique index `private_activity_members_uniq` on `(activity_id, user_id) where user_id is not null` — one row per app member per activity, **and no uniqueness at all on typed names** (two "Uncle Rick"s are legal; dedupe in your UI if you care — the web composer de-dupes case-insensitively *as each chip is added*, not at submit time, and the detail sheet's typed-name add doesn't dedupe at all).

**Swift shapes.** One fetch gets both tables; the web selects `"*, private_activity_members(*)"` (single FK between these two, so no PostgREST embed-ambiguity trap here — that trap applies to the tournament fetch, see §6).

```swift
struct PrivateActivity: Decodable, Identifiable {
    let id: UUID
    let title: String
    let emoji: String?
    let description: String?
    let location: String?
    let startsAt: Date?          // starts_at
    let endsAt: Date?            // ends_at
    let tournamentEnabled: Bool  // tournament_enabled
    let archivedAt: Date?        // archived_at
    let createdBy: UUID          // created_by
    let createdAt: Date          // created_at
    let members: [PrivateActivityMember]   // CodingKey "private_activity_members"
}

struct PrivateActivityMember: Decodable, Identifiable {
    let id: UUID
    let userId: UUID?            // user_id — nil ⇒ typed-in name, no account
    let name: String
    let role: String             // "host" | "player"
    let rsvp: String?            // "going" | "maybe" | "out" | nil
    let addedBy: UUID?           // added_by
    let createdAt: Date
}
```

⚠️ **Decode `role`/`rsvp` defensively.** Model them as enums with a fallback case rather than a bare `enum: String, Decodable` — a strict enum turns a future value (or a hand-edited row) into a whole-list decode failure, which reads as "private activities are broken", not "one row is odd".

⚠️ **Timestamps are `timestamptz` and Postgres returns 6-digit fractional seconds** (`2026-08-09T14:03:22.481293+00:00`). Swift's stock `.iso8601` date strategy rejects fractional seconds outright. Use whatever custom decoding the rest of mlr-app-ios already uses for `posts.created_at` / `house_stays` — do not introduce a second, stricter one here.

⚠️ **`canManage` does not exist in the database.** `lib/privateActivities.ts` computes it client-side as `isAdmin || row.created_by == myUserId || (my roster row has role == "host")`. Mirror that for affordance gating, and let the server's own host check be the real gate — every mutating RPC re-checks `is_private_activity_host` and raises `Not authorized`.

---

#### 2. RLS — one sentence per table, and the write rule

- **`private_activities`** — policy `"private_activities: member read"`, `for select using (public.is_private_activity_member(id))`: you can read an activity only if you created it, you're an app admin, or you're on its roster.
- **`private_activity_members`** — policy `"private_activity_members: member read"`, `for select using (public.is_private_activity_member(activity_id))`: you can read a roster only if you can read its activity.

So **an empty list means "you weren't invited to anything", and an empty roster on an activity you can see should never happen** (the creator is always inserted as a member, and `remove_private_activity_member` refuses to delete their row). A zero-row read is never "no data yet" in the sense of a missing feature.

⚠️⚠️ **There are NO insert / update / delete policies on either table.** RLS denies by default, so every direct table write from the app is refused. Do not write a `.from("private_activities").insert(...)` or `.update(...)` anywhere — it will fail, and (for an update) it will fail as *zero rows affected with no error*, which is the worst possible failure shape. Every write goes through the SECURITY DEFINER RPCs in §4.

**The two predicates** (both `security definer stable set search_path = ''`, `grant execute … to authenticated`):

- `public.is_private_activity_member(p_activity uuid) → boolean` — activity's `created_by = auth.uid()`, OR caller has `profiles.is_admin`, OR caller has a roster row on it.
- `public.is_private_activity_host(p_activity uuid) → boolean` — activity's `created_by = auth.uid()`, OR caller is an app admin, OR caller has a roster row with `role = 'host'`.

They're callable as RPCs if you ever want a server-truth check, but the web never calls them; it derives `canManage` locally. Note both grant **admins** full read + host powers, for moderation — an admin sees every private activity in the app.

⚠️ **Privacy is deliberately absolute: there is no "all members" or public visibility mode.** Don't add a "share with everyone" affordance; that's what `events` is for.

---

#### 3. Who can create: any signed-in member

`create_private_activity` gates on nothing but `auth.uid() is not null`. This follows the polls / work-items / cabin-request doctrine, **not** the admin-only `events` model. On the web the entry point is a "🎉 Create an activity" button on `/events` shown to everyone, which calls `promptSignIn()` for a guest instead of opening the composer. Mirror that: the button is always visible, sign-in is the gate.

**The typed-name roster idiom** (inherited from migration 0143's linked-or-typed pattern): a roster entry is either a **linked app member** (`user_id` set, `name` snapshotted from `profiles.display_name`) or an **account-less typed name** (`user_id` null, `name` whatever was typed). Consequences you must handle in Swift:

- A typed-name person **can play in a tournament** but **can never receive a notification** (no `user_id` for `_notify` to target).
- A typed-name person **can't RSVP** — `set_private_activity_rsvp` keys on `auth.uid()`, so there's no row to write.
- A typed-name person **shouldn't be made an organizer**. `set_private_activity_member_role` will happily set `role='host'` on a `user_id`-null row, but `is_private_activity_host` matches on `m.user_id = auth.uid()`, so the standing is inert. The web hides the "Make organizer" button unless `m.userId != nil` — copy that rule; the server won't stop you.
- Render them distinctly. The web appends a quiet `(not on app)` after the name.

---

#### 4. Every RPC, with real parameter names in order

All are `security definer`, all `revoke … from public, anon` + `grant execute … to authenticated`. Supabase RPC calls are keyed by name, so **a wrong key is a runtime 404 from the schema cache** (`Could not find the function public.x(...)`), not a compile error. Params with a default may be omitted; `p_title` on create has no default and must be sent.

**Lifecycle**

```
create_private_activity(
  p_title              text,
  p_emoji              text        default null,
  p_description        text        default null,
  p_location           text        default null,
  p_starts_at          timestamptz default null,
  p_ends_at            timestamptz default null,
  p_tournament_enabled boolean     default false,
  p_members            jsonb       default null,   -- [{user_id?, name?}, …]
  p_notify             boolean     default false
) returns uuid
```
- Raises `Sign in required` / `A title is required` (title is `btrim`-ed and must be non-empty).
- **Inserts the creator as the first roster row automatically**: `role='host'`, `rsvp='going'`, `name = display_name` (or `'Me'`). Don't include yourself in `p_members` — the loop skips your own id anyway.
- `p_members` must be a JSON **array**; the web sends one object per invitee, always with both keys present: `{"user_id": "<uuid>"|null, "name": "<string>"|null}`. For an entry with a `user_id` the supplied `name` is **ignored** and re-resolved from `profiles.display_name`; an entry with neither a `user_id` nor a non-blank name is skipped. An empty array is fine.
- ⚠️ **A `user_id` here that matches no profile is NOT an error** (unlike `add_private_activity_member`): the name lookup comes back null and the row is inserted, linked to that id, named `'Guest'`. Validate ids client-side if you ever build them from anything but a live directory fetch.
- Note the create path `btrim`s + `nullif`s emoji / description / location, so a blank string lands as **NULL** on create (the empty-string trick below applies only to *update*).
- Duplicate linked invitees collapse via `on conflict … do nothing`.
- Fires the invite notification to everyone added (except you) **only if `p_notify` is true**.
- Returns the new activity's uuid → decode as `UUID`.

```
update_private_activity(
  p_activity           uuid,
  p_title              text        default null,
  p_emoji              text        default null,
  p_description        text        default null,
  p_location           text        default null,
  p_starts_at          timestamptz default null,
  p_ends_at            timestamptz default null,
  p_tournament_enabled boolean     default null,
  p_clear_start        boolean     default false
) returns void
```
- Host gate. Semantics are `coalesce(p_x, x)` per field: **null means "leave unchanged"**, which is how partial updates work here.
- ⚠️ **You therefore CANNOT null out `emoji` / `description` / `location` through this RPC.** The web has this exact bug live: `PrivateActivitySheet`'s `saveEdit` sends `location: location.trim() || null`, so clearing the Where field and tapping Save silently keeps the old value. **Don't copy it.** With no backend change, send an **empty string** `""` instead of null — that's non-null so `coalesce` takes it, and the column ends up `''`. Which means: **treat `""` as "no value" everywhere on read** (`location?.isEmpty == false` before rendering), because `''` and `NULL` both now mean absent.
- `p_title` can't be blanked (`coalesce(nullif(btrim(...),''), title)`) — an empty title is a no-op, not an error. Validate client-side.
- The **only** clearable fields are the times: `p_clear_start = true` sets **both `starts_at` and `ends_at` to null** (it's the "make it TBD" switch), and when true it ignores whatever you passed for `p_starts_at`/`p_ends_at`.
- The web's edit sheet only exposes title + location even though the RPC takes everything. A richer iOS edit form (emoji, description, time, TBD toggle) needs no backend work.

```
delete_private_activity(p_activity uuid) returns void
set_private_activity_archived(p_activity uuid, p_archived boolean) returns void
```
Both host-gated. See §7 for the archive-vs-delete semantics.

**Roster**

```
add_private_activity_member(
  p_activity uuid,
  p_user_id  uuid    default null,
  p_name     text    default null,
  p_role     text    default 'player',
  p_notify   boolean default false
) returns uuid
```
- Host gate. Pass **either** `p_user_id` (a linked member; name is resolved from `profiles`, raises `Member not found` if that profile doesn't exist) **or** `p_name` (a typed name; raises `A name is required` if blank). If both are sent, `p_user_id` wins and `p_name` is ignored.
- `p_role` is coerced: anything other than the literal `'host'` becomes `'player'`.
- ⚠️⚠️ **Returns `NULL`, not an error, when that member is already on the roster** (`on conflict (activity_id, user_id) … do nothing` leaves the `returning` empty). Decode this as **`UUID?`** — a non-optional `UUID` decode will throw on a duplicate add and surface as a spurious error to the user. Nothing is notified in that case either (the notify branch requires a real inserted id).
- `p_notify = true` pings **only that one person**, and only when `p_user_id` is non-null.

```
remove_private_activity_member(p_member uuid) returns void
```
- Takes the **roster row id**, not a user id. Allowed for a host **or** for the member removing their own row (i.e. "leave"). Raises `Not found` for an unknown row id, `Not authorized` otherwise.
- ⚠️ Refuses the creator's own row with `The organizer can't leave — delete the activity instead` — and that check runs **before** the authorization check, so it's the message you get for the creator's row even without host rights. Surface it as a real message; the organizer's ✕ should just not be rendered (the web hides controls for `m.userId == activity.createdBy`).

```
set_private_activity_member_role(p_member uuid, p_role text) returns void
```
- Host gate; `p_role` must be `'host'` or `'player'` (else `Unknown role`). Roster row id again — an unknown id raises `Not found`.

```
set_private_activity_rsvp(p_activity uuid, p_rsvp text) returns void
```
- **Member** gate (not host) — anyone who can see the activity may call it. `p_rsvp` ∈ `going|maybe|out`, or **null to clear** (the web toggles: tapping your current choice again sends null). Anything else raises `Unknown RSVP` (validated before the membership gate).
- ⚠️ The UPDATE is `where activity_id = p_activity and user_id = auth.uid()`. An **admin who isn't on the roster passes the permission gate but updates zero rows — a silent no-op with no error.** Only show RSVP controls when the viewer actually has their own roster row (the web computes `myRow` and renders the control only if it exists).

**Tournament (see §6 before wiring any of these)**

```
create_activity_tournament(
  p_activity     uuid,
  p_title        text,
  p_format       text default 'single_elim',
  p_entrant_type text default 'individual',
  p_team_size    int  default null,
  p_bye_strategy text default 'byes'
) returns uuid

import_entrants_from_activity_members(p_tournament uuid) returns int
set_tournament_format(p_tournament uuid, p_format text) returns void
```

**Not callable from the client** (execute revoked from `authenticated` too) — listed so you don't try: `_notify_private_activity_invite(p_activity, p_only_user)`, `_seed_activity_tournament(p_tournament, p_activity, p_entrant_type)`, `_tournament_deep_link(p_t)`, `_notify_tournament_all(...)`, `_notify_tournament_match(...)`.

---

#### 5. Notify-on-create is opt-in and participant-scoped only

There is exactly **one** notification kind for this feature: **`private_activity_invite`**.

- It fires **only** from `create_private_activity` when `p_notify = true` (to every roster member with an account, except the actor) or from `add_private_activity_member` when `p_notify = true` (to that one person). There is **no** notification on RSVP, edit, archive, delete, or role change. Do not add one client-side.
- The web surfaces it as a "**🔔 Let them know**" toggle on the composer that **defaults OFF**, with the copy "Send a notification to the people you added (only them). Off = no one is pinged." Keep the default off — that's the product promise.
- Fan-out runs through the shared `_notify(...)` (defined in 0030, **last recreated by 0047** — which only adds a `help_urgent` bypass, so this kind still respects prefs), which **drops the row** if the recipient is the actor, or if the recipient doesn't have `'private_activity_invite'` in `profiles.notif_types`.
- **In-app is ON by default** (0150 changed the `profiles.notif_types` column default and appended the value to every existing row; no later migration touches that default). **Phone push is OPT-IN** — `private_activity_invite` is deliberately absent from `DEFAULT_PUSH_TYPES`, and both mini senders (`media-server/apns-sender.js`, `push-sender.js`) include it in their pushable set but require it in the member's `push_types`. So a member who has push on but never opted into this category correctly gets nothing.
- **Typed-name roster entries are never notified** (no `user_id`). If the organizer expects "everyone got told", they didn't.

**The APNs payload your app already receives** (from `apns-sender.js`'s `handleFeed`, mirroring the `notifications` row):

```
title      = notification title  ("🏓 Ping-pong tournament")
body       = "<organizer> invited you to join"
url        = "<APP_URL>/events?activity=<activity-uuid>"
type       = "private_activity_invite"
target_type = "private_activity"
target_id   = "<activity-uuid>"
```

⚠️ **Route off `target_type` + `target_id`, not by parsing `url`.** The url is a *web* path that only exists because the notification row is shared with the PWA; `target_id` is the activity uuid directly. (Same for the tournament kinds — see below.)

The tournament pings that a private activity can produce (`tournament_published`, `tournament_match_ready`, `tournament_champion`) were **already participant-scoped** before this feature, so they stay private too; migration 0150 only changed where they point — `_tournament_deep_link` now returns `/events?activity=<id>` for a private-activity tournament instead of a fest schedule path.

---

#### 6. The tournament half: polymorphic, auto-seeded, and big

Migration 0150 made `tournaments` **polymorphic** rather than forking the whole bracket engine:

- `tournaments.schedule_item_id` was made **nullable** and `tournaments.private_activity_id uuid references private_activities(id) on delete cascade` was added, with `check (num_nonnulls(schedule_item_id, private_activity_id) = 1)` (constraint `tournaments_one_host`) — exactly one host.
- `is_tournament_manager(p_tournament)` branches: a fest tournament defers to `_can_manage_item_signups(item)`, a private-activity tournament to `is_private_activity_host(activity)`. **No new organizer role.**
- 0151 added partial unique index `tournaments_one_per_activity on tournaments(private_activity_id) where private_activity_id is not null`, and made `create_activity_tournament` **idempotent** — if the activity already has a tournament it returns that id and ignores the other params (the early return happens *before* the title/format validation and before `tournament_enabled` is re-set, so a re-tap with garbage params is a silent no-op).
  - ⚠️ That guard exists because of a real incident: a client display hiccup meant nothing rendered after creation, so the "Set up a tournament" button kept reappearing and **each tap inserted another tournament row**. The DB now refuses duplicates, but still disable your button while the call is in flight and render off the refetched state.
- 0152 → 0153: creating a tournament **auto-seeds the players from the activity roster**, so there is no separate "import" step for a v1. For `p_entrant_type = 'individual'` each roster member becomes a real `tournament_entrants` row (`position` 0..n-1, `seed` still null until generate) plus a linked `tournament_participants` row — i.e. they land already listed and reorderable. For `'team'` they all land in the pre-team **pool** (`tournament_participants.entrant_id = null`) and the host taps "auto-make teams" first.
- `import_entrants_from_activity_members(p_tournament)` is the "↻ Re-sync players from activity" action: manager gate, requires `private_activity_id is not null` (else `Not a private-activity tournament`) and `status = 'setup'` (else `Reset the bracket before re-importing`), wipes participants + entrants, re-seeds via the same `_seed_activity_tournament`, returns the roster **count** as an `int`.
- 0154's `set_tournament_format(p_tournament, p_format)` lets a manager switch `single_elim` / `round_robin` / `pools_bracket` **while still in `setup`** (else `Reset the bracket before changing the format`).

**Read rules for the tournament tables** (as re-stated by migration 0183): `tournaments` itself is `using (is_approved_member() and (private_activity_id is null or is_private_activity_member(private_activity_id)))`. The three child tables have **no host column of their own**, so each resolves through its parent: `using (is_approved_member() and exists (select 1 from tournaments t where t.id = <table>.tournament_id and (t.private_activity_id is null or is_private_activity_member(t.private_activity_id))))` — i.e. a verified member, and for a private-activity tournament, one of that activity's people. A private bracket and its scores are not readable by the rest of the family.

⚠️ **The `tournaments` fetch MUST name the entrants FK.** `tournaments` has two relationships to `tournament_entrants` (the child's `tournament_id` FK plus `tournaments.winner_entrant_id`), so a plain `tournament_entrants(*)` embed returns **HTTP 300 / PGRST201 and an empty result**. The web's select is:
`"*, tournament_entrants!tournament_entrants_tournament_id_fkey(*), tournament_matches(*), tournament_participants(*)"`. Copy it verbatim. (`matches`/`participants` have one relationship each and are fine.)

**Honest sizing.** The private-activity feature itself is **small**: two tables, eight RPCs, and on web roughly one composer + one detail sheet + one list row (~600 lines of TSX total). The tournament half is **large and independent** — `lib/tournaments.ts` is ~31 KB, plus `TournamentView` / `TournamentBracket` / `TournamentStandings` / `MatchResultSheet` / `TournamentSetupSheet`, covering three formats, byes/play-ins, rearrange mode, pools→knockout promotion, and an optimistic `record_match_result` with a per-match in-flight lock.

**Suggested v1: ship the activity, skip the bracket.** Create / list / open / roster (add linked + typed, remove, promote to organizer) / RSVP / archive / delete. Store and display `tournament_enabled` (the list row reads "Private · 🏆 Tournament · 4 people"), but render a "manage the bracket in the web app" line instead of the bracket UI — and expect that flag to be **true on most existing rows**, since the web composer defaults it on. If you do want a tournament v1, the cheapest real one is **`single_elim` only**: `create_activity_tournament` already seeds the entrants, so you need only `generate_bracket` + `record_match_result` + a round pager — you can skip entrant management entirely.

---

#### 7. Archive vs delete

Two genuinely different host-only actions; don't collapse them into one:

- **Archive** — `set_private_activity_archived(p_activity, p_archived)` stamps `archived_at = now()` (or clears it back to null when `p_archived = false`). Nothing is destroyed and the row **still comes back in the normal fetch**; the client partitions on `archived_at`. The web shows live ones under "Your activities" and archived ones behind a collapsed **"Finished & archived (n)"** disclosure, dimmed, still openable and still deletable. Label it as the web does — "🗄️ Archive (game's over)" / "♻︎ Unarchive".
- **Delete** — `delete_private_activity(p_activity)` is a **hard delete**. The FK cascade takes out `private_activity_members`, the `tournaments` row, and (via that row's own cascades from migration 0144) `tournament_entrants` / `tournament_participants` / `tournament_matches`. Irreversible. The web puts it behind an inline confirm ("Delete this activity for everyone? This can't be undone.").

---

#### 8. The deep-link parameter

The activity deep-link is a **query parameter, not a route segment**: **`/events?activity=<activity-uuid>`**. It's produced in two places server-side — `_notify_private_activity_invite` builds `'/events?activity=' || p_activity::text`, and `_tournament_deep_link` returns the same for any tournament whose `private_activity_id` is set. On web, `app/events/page.tsx` reads `params.get("activity")` on mount and sets `openActivityId`, which opens the detail sheet over the calendar.

For iOS: register a deep-link case that carries the activity uuid, reached from (a) an APNs tap where `target_type == "private_activity"` (use `target_id`), (b) an in-app Activity-feed row whose `notifications.url` matches `/events?activity=…`, and (c) any universal link on the web path. It should push/present the activity detail on top of your Events screen, same as the web.

⚠️ **The uuid may not resolve.** The activity can have been deleted, or you may have been removed from its roster, since the notification was written — RLS then returns nothing. Handle "not found or no longer shared with you" as a real, calm state rather than a spinner or a crash on a force-unwrap.

---

#### 9. Realtime, caching, and web idioms that don't transfer

**Realtime is enabled on both tables** (`replica identity full`, both added to the `supabase_realtime` publication). The web hook subscribes to `event: "*"` on `private_activities` **and** `private_activity_members` with **no filter**, and on any event just debounce-reloads (250 ms) the RLS-scoped fetch.

⚠️ **Do the same: treat a realtime event as "something changed, refetch", and never render from the payload.** Two reasons — an unfiltered subscription is the only practical shape (you don't know your activity ids up front, and roster changes are what add you to one), and a `private_activity_members` insert is precisely the event that *grants* you read access, so only a refetch can materialize the activity you just gained.

Web idioms that **do not** carry over:

- **The SWR/localStorage cache.** `usePrivateActivities()` keys a `sessionStorage`-persisted cache at `privateActivities.<uid>` because Next remounts screens on tab navigation. iOS has no such remount problem — use your existing observable store; there's nothing to port. (If you *do* cache, keep the uid in the key: a shared device that switches accounts must not paint the previous member's private activities. That rule was learned the hard way here — a shared cache key once leaked one member's private chat to the next user.)
- **`isMissingTable` / 42P01 degradation.** Every web read swallows a missing-relation error and returns `[]` so the PWA works pre-migration (in fact `fetchPrivateActivities` returns `[]` on *any* error, warning only for non-missing-table ones). All five migrations are live in production, so this is belt-and-braces on iOS; still, don't let a decode or network error throw into the view — an empty list plus a retry beats a crash.
- **`<input type="datetime-local">` → `DatePicker`.** The composer defaults to a "No set time — we'll just play" checkbox (checked), and only when unchecked does it read the local datetime, convert with `new Date(value).toISOString()`, and send that. Send **`p_starts_at` as an ISO-8601 UTC string** the same way; the column is `timestamptz`, so a local-time string without an offset will be interpreted in the server's timezone.
- **jsonb from Swift.** `p_members` needs a real JSON array. Build it as an `Encodable` array of a two-field struct (`user_id: UUID?`, `name: String?`) inside your params struct — supabase-swift will encode it as jsonb. The SQL checks `jsonb_typeof(p_members) = 'array'`, so a dictionary or a stringified array is silently ignored, not an error.
- **Emoji field.** It's a plain `text` column; the web clamps input to the last two characters, pre-fills `🏓`, and offers a quick-pick row (`🏓 🎯 🎲 🏆 🃏 ⛳️ 🏀 🎱 🥏 🎳`). Nothing enforces it's actually an emoji, and it can be null/empty — the list row falls back to `🎉`.

---

#### 10. Verify this

- ⚠️ **Asymmetric approval gate.** Migration 0183 re-gated the four tournament read policies onto `is_approved_member()` (verified member per 0181/0182) but **left `private_activities` / `private_activity_members` on the original `is_private_activity_member(...)` predicate, which does not check `approved`**. So an unverified/unapproved signup who is added to a roster **can** read the activity and its roster but gets **zero rows** for its tournament — the tournament section would render silently empty for them. This is what the SQL says today; confirm with Brian whether that's intended before designing around it, and either way make the iOS tournament view distinguish "no tournament yet" from "couldn't read it".
- The `location`-can't-be-cleared behavior in `update_private_activity` is verified from the SQL (`coalesce(p_location, location)`) and the web's call site. The empty-string workaround follows directly from that expression, but **has not been exercised against production** — try it once in a scratch activity before shipping the edit form.
