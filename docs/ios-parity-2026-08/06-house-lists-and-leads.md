<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **26 correction(s)** were applied.

### House lists, Leads chat, and lead-run rosters

**Backend status: all three are LIVE in production.** Verified against the live database on 2026-08-10 (`information_schema` + `pg_proc` + `pg_policies` introspection, read-only): `house_lists`, `house_list_items`, all nine list RPCs, `committee_roster.is_lead`, `is_committee_lead`, the three `committee_roster lead *` policies, and the `'leads'` branch inside `can_access_committee_area` all exist. **You are writing Swift against schema that already exists. No migration, no RPC, no policy needs to be written for any of this.**

> ⚠️ **Two migrations share the number `0172`** in this repo — `0172_committee_leads_chat_and_lead_roster.sql` (this feature) and `0172_callout_drop_box_and_fest_album.sql` (unrelated). Search by full filename, not by number.

Three things ship here. They are independent — do them in any order — but they share one hazard (the `" · Lead"` suffix, below) that has already caused silent data loss on web.

Live data as of 2026-08-10, so you know what an empty screen means when you test:

| | count |
|---|---|
| `house_lists` rows | **0** — you must create the first list to see anything |
| `house_list_items` rows | 0 |
| roster rows with a `" · Lead"` role | **5, all on `committee_slug = 'family-fest'`** (4 of them linked to a real account) |
| roster rows with `is_lead = true` (committee-level) | **0** |
| `committee_messages` with `area = 'Leads'` | 0 — the room has never been used |
| committees with a real role literally named "Leads" | 0 |

So: **`family-fest` is the only committee with a reachable Leads room today**, and the only accounts that can enter it are those 4 linked leads. If you test with any other account you will correctly see nothing.

---

## Part A — House lists (migration `0169_house_lists.sql`)

Shared lists for a house: the grocery run, the cabin close-up checklist, what to pack, "stuff to fix". Deliberately **ONE flexible shape** — a list is a title + items, and every item can be checked off — so a shopping list and a checklist are the same thing and there is no "kind" to pick at creation time. This is the *shared scratchpad*; the house's **tracked, author-owned** work stays in work items (`work_items`, migration 0066, which iOS already has). Do not merge the two.

### The two tables (exact columns, exact nullability)

```
public.house_lists
  id          uuid        NOT NULL  default gen_random_uuid()
  house_id    uuid        NOT NULL  -> houses(id) on delete cascade
  created_by  uuid        NOT NULL  -> profiles(id) on delete cascade
  title       text        NOT NULL
  emoji       text        NOT NULL  default '📝'
  note        text        NULL
  position    integer     NOT NULL  default 0
  created_at  timestamptz NOT NULL  default now()
  updated_at  timestamptz NOT NULL  default now()

public.house_list_items
  id          uuid        NOT NULL  default gen_random_uuid()
  list_id     uuid        NOT NULL  -> house_lists(id) on delete cascade
  house_id    uuid        NOT NULL  -> houses(id) on delete cascade   ← DENORMALIZED, see below
  created_by  uuid        NOT NULL  -> profiles(id) on delete cascade
  text        text        NOT NULL
  checked_at  timestamptz NULL      ← null means OPEN
  checked_by  uuid        NULL      -> profiles(id) on delete set null
  position    integer     NOT NULL  default 0
  created_at  timestamptz NOT NULL  default now()
  updated_at  timestamptz NOT NULL  default now()
```

`updated_at` is maintained server-side on **both** tables by their own before-update triggers (`house_lists_set_updated_at` / `house_list_items_set_updated_at`, both executing `public.set_updated_at()`). Never send it.

There is **no media on lists** — no `*_media` child table, nothing to upload, no moderation path. That is a real simplification versus work items.

### RLS read rules — one sentence each

- **`house_lists`**: you can read a list only if `is_house_member(house_id)` is true — i.e. your `profiles.house_id` equals that house, **or** you are an app admin. Nothing else.
- **`house_list_items`**: identical rule, evaluated on the item's own `house_id` column.

Those are the **only** policies on either table. Verified in `pg_policies`: one `SELECT` policy each, and **zero INSERT / UPDATE / DELETE policies at all**. Note that neither table was touched by migration 0183 — `is_house_member` is the whole gate, and it already implies an approved account in practice (an unapproved signup has no house assigned).

⚠️ **Therefore an empty result is "not permitted," not "no data."**

⚠️⚠️ **And a direct table write from iOS fails in the WORST possible way: silently.** Get this right or you will lose an afternoon:

- a direct **INSERT** raises `42501` *(new row violates row-level security policy)* — a real, visible error;
- a direct **UPDATE** or **DELETE** raises **nothing at all**. With RLS on and no policy for that command, Postgres *filters* the rows instead of erroring, so the statement matches **0 rows** and PostgREST returns success (204 / empty array). Your checkbox will appear to save and change nothing in the database, forever.

Every mutation must go through an RPC. Don't waste an hour on a `.from("house_list_items").update(...)` that can never work and will never complain.

### The denormalised `house_id` on items — why it's there, and why you must not fight it

An item's house is derivable via `list_id → house_lists.house_id`, but it is copied onto the item row on purpose, for two reasons:

1. **RLS with no join.** The item's read policy is a flat `is_house_member(house_id)` instead of an `EXISTS` subquery against the parent list — cheaper and simpler to reason about.
2. **A Realtime filter with no join.** Supabase Realtime `postgres_changes` filters are single-column predicates on the changed row. Without the local `house_id` you could not subscribe to "items in my house" at all; you would have to subscribe to every item change in the database and filter client-side.

It cannot drift: every RPC copies it from the parent list, **and** a `BEFORE INSERT OR UPDATE OF list_id` trigger `trg_house_list_item_sync_house` re-derives it from `house_lists` (function `house_list_item_sync_house()`), raising `'List not found'` if the parent is missing.

⚠️ **Never send `house_id` yourself and never try to call `house_list_item_sync_house()`.** It is a trigger function and `EXECUTE` is revoked from `public`, `anon` and `authenticated` specifically so it isn't reachable as an RPC. The trigger still fires (it runs as the table owner).

### Writes: gated on MEMBERSHIP, not authorship

This is the single most important behavioural fact. Every one of the nine RPCs checks `is_house_member(...)` and **nothing about who created the row**. Any member of the house may rename, re-emoji, delete, add to, edit, check, uncheck or clear **any** list and **any** item, including ones someone else made.

That is the design, not an oversight — the comment in the migration says it plainly: *"the person who got the milk is rarely the person who wrote it down."*

⚠️ **Do not add an author check in the iOS UI.** If you hide the delete/edit affordance unless `item.createdBy == effectiveUserId`, you have built a different feature from the web app and the two will disagree on screen for the same house. Contrast with `house_stays` (0071), where edits *are* author-or-admin (`update_house_stay` raises `'Not authorized'` unless you're the creator or an admin) — the two house features deliberately differ and it's easy to copy the wrong one.

### The nine RPCs — real parameter names, in order

Supabase RPC calls are keyed by parameter **name**, so a typo fails at runtime with `PGRST202 function ... does not exist`. These are read straight off `pg_get_function_arguments` in the live database:

| RPC | Parameters (in order) | Returns |
|---|---|---|
| `create_house_list` | `p_house uuid`, `p_title text`, `p_emoji text DEFAULT '📝'`, `p_note text DEFAULT NULL` | `uuid` (new list id) |
| `update_house_list` | `p_id uuid`, `p_title text`, `p_emoji text DEFAULT NULL`, `p_note text DEFAULT NULL` | `void` |
| `delete_house_list` | `p_id uuid` | `void` |
| `add_house_list_item` | `p_list uuid`, `p_text text` | `uuid` (new item id) |
| `update_house_list_item` | `p_id uuid`, `p_text text` | `void` |
| `set_house_list_item_checked` | `p_id uuid`, `p_checked boolean` | `void` |
| `delete_house_list_item` | `p_id uuid` | `void` |
| `clear_checked_house_list_items` | `p_list uuid` | `integer` (how many were deleted) |
| `uncheck_house_list_items` | `p_list uuid` | `integer` (how many were reset) |

All nine are `SECURITY DEFINER`, `set search_path = ''`, revoked from `public`/`anon` and granted to `authenticated`.

Behaviour details that will bite you if you guess:

- **`create_house_list` sorts a new list to the TOP**: `position = coalesce(min(position), 0) - 1` over that house. So position ascending = newest first. There is no reorder RPC — see the warning below.
- **`add_house_list_item` appends**: `position = coalesce(max(position), 0) + 1` within the list.
- ⚠️ **`update_house_list` is asymmetric about nil.** `p_emoji = nil` **keeps** the existing emoji (`coalesce(nullif(btrim(coalesce(p_emoji,'')),''), emoji)`), but `p_note = nil` **clears the note to NULL** (`note = nullif(btrim(coalesce(p_note,'')),'')`, applied unconditionally). A Swift "partial update" struct that omits `note` will silently wipe it. Always send the current note. Also, `p_title` must be non-empty on **every** call — you cannot update just the note.
- **Server-side truncation, silently:** `title` is `left(…, 120)`, item `text` is `left(…, 300)`. Cap your text fields at 120 / 300 so the user isn't surprised.
- **Empty input raises**, and the message is user-facing copy you can show directly: `'A list needs a name'`, `'An item needs some text'`, `'Not a member of this house'`, `'Sign in required'`.
- **Deletes are idempotent** — `delete_house_list` / `delete_house_list_item` return quietly if the row is already gone. But `update_house_list`, `add_house_list_item` and both sweeps raise `'List not found'`, and `update_house_list_item` / `set_house_list_item_checked` raise `'Item not found'`.
- The two sweeps are the recurring-list story and are worth shipping in v1: **`clear_checked_house_list_items`** is "we're home from the store" (deletes the checked ones so a shopping list doesn't get rebuilt by hand), **`uncheck_house_list_items`** is "reuse the close-up checklist next trip". One RPC each.

⚠️ **`position` exists on items but there is no reorder RPC and no UPDATE policy — do NOT build drag-to-reorder.** There is no server-side write path for it. The column only records insertion order.

### "Checked" is a STAMP, not a boolean — so the list also answers *who*

`checked_at` + `checked_by`, not `is_checked`. `checked_at IS NULL` means open. The stamp exists because what a house actually wants to know is *"who got the milk / who closed the windows, and when."* Web renders `Got by {name}` under a checked row.

`set_house_list_item_checked(p_id, p_checked: false)` **clears both columns** — `checked_at = null, checked_by = null` — deliberately, "so the stamp never lies." Don't preserve `checked_by` on uncheck.

To render the name you need the profile behind `checked_by`. See the embed warning below.

### No notifications, by design

There is no trigger, no `_notify` call, no `notif_types` entry, no `PushType` for house lists. Checked every other migration and the whole `media-server/` tree: **nothing outside `0169_house_lists.sql` references `house_lists` or `house_list_items` at all.** This is deliberate — *"a grocery run would spam the whole house."*

⚠️ **Do not add a local notification, a badge, or an APNs category for lists on iOS.** Lists are a quiet pull-only surface kept live by Realtime while the screen is open. Adding a ping is a product change, not parity. (Contrast: `work_item_created` **does** notify + push — it's in the `notif_types` default array as of 0070. Again, easy to copy the wrong neighbour.)

### Realtime

Both tables are in the `supabase_realtime` publication and both are set to `REPLICA IDENTITY FULL` (verified: `relreplident = 'f'`). Full replica identity is what makes the DELETE payload carry the whole old row — which is what lets the `house_id` filter apply to deletes at all.

Web subscribes one channel with two `postgres_changes` listeners, both filtered `house_id=eq.<houseId>`, and debounces a full refetch by 250 ms rather than patching rows:

```
schema: public, table: house_lists,      filter: house_id=eq.<uuid>
schema: public, table: house_list_items, filter: house_id=eq.<uuid>
```

Debounce-then-refetch is the right call here too: `clear_checked_house_list_items` can fire a dozen DELETEs in one statement, and the payloads are small enough that a refetch is cheaper than reconciling.

### Swift shapes

Straight Codable structs; nothing exotic. Non-optional where the column is `NOT NULL`:

```swift
struct HouseList: Codable, Identifiable {
    let id: UUID
    let houseId: UUID
    let title: String
    let emoji: String          // NOT NULL, defaults to 📝 server-side — never nil
    let note: String?          // nullable
    let position: Int
    let createdBy: UUID
    let createdAt: Date
    let updatedAt: Date
    var items: [HouseListItem] = []   // filled from the nested embed or a 2nd query
}

struct HouseListItem: Codable, Identifiable {
    let id: UUID
    let listId: UUID
    let text: String
    let checkedAt: Date?       // nil == open. This IS the boolean.
    let checkedBy: UUID?
    let createdBy: UUID
    let createdAt: Date
    let position: Int
}

var isChecked: Bool { checkedAt != nil }
```

- ⚠️ **Timestamps.** These are `timestamptz`; PostgREST serialises them with **microsecond** fractional seconds (`2026-08-09T18:22:41.123456+00:00`). `JSONDecoder.DateDecodingStrategy.iso8601` rejects fractional seconds and you get a decode failure that looks like a schema mismatch. Use whatever decoder your existing `HouseStay` model already uses (it decodes `house_stays.created_at`, same `timestamptz`) rather than introducing a second one.
- **Good news:** there is no bare `date` column anywhere in house lists — everything is `timestamptz`. (`house_stays`, by contrast, really does have `start_date date` / `end_date date`.) The web app's `YYYY-MM-DD`-parsed-as-UTC-midnight bug (which mislabelled every fest sign-up slot by a day) **cannot occur here.**
- **Scalar RPC returns**: `create_house_list` / `add_house_list_item` return a bare JSON string — decode as `UUID` or `String`, not an object or array. The two sweeps return a bare number → `Int`. The `void` ones return an empty body — **don't try to decode a response**, or you'll get a "data is empty" error on a call that actually succeeded.
- **No `localStorage` idiom to port.** Web caches lists under a `houseLists.<houseId>` stale-while-revalidate key (`useCachedResource`, `persist: "local"`). If you mirror it, key it on the **house id** (as web does) — but note the web-wide rule that user-specific caches must embed the real auth uid: a shared cache key once leaked one member's private chat to the next user on the same device. A list cache keyed on house id is fine because the house *is* the audience, but wipe it on sign-out.

### The one PostgREST trap in this feature

Web fetches a list and its items and both display names in **one** round-trip:

```
id, house_id, title, emoji, note, position, created_by, created_at, updated_at,
author:created_by(display_name),
house_list_items(id, list_id, text, checked_at, checked_by, created_by, created_at, position,
                 checker:checked_by(display_name))
```

⚠️⚠️ **`house_list_items` has TWO foreign keys to `profiles` (`created_by` and `checked_by`), so a bare `profiles(display_name)` embed is ambiguous and PostgREST answers HTTP 300 / `PGRST201` — which the client sees as an EMPTY ARRAY, not an error.** You must name the FK column, exactly as above: `checker:checked_by(display_name)` and `author:created_by(display_name)`. This exact class of bug has already bitten this codebase elsewhere (a `tournaments ↔ tournament_entrants` embed silently returned `[]` because two FKs linked the tables). If your list screen renders empty while the RPCs clearly work, check the embed spelling before anything else. **The same trap applies to `committee_roster` in Part C** — it also has two FKs to `profiles`.

If you'd rather not fight it: do two flat queries (`house_lists` filtered by house, `house_list_items` filtered by house — the denormalised column is exactly what makes that possible without a join) plus one `profiles` fetch for the `checked_by` ids, and stitch client-side. Perfectly acceptable; slightly more code, zero embed risk.

**A joined profile embed decodes as an object OR a 1-element array depending on the FK shape** — the web helper (`embeddedName`) handles both. In Swift, prefer the flat-queries route or write a small `@propertyWrapper`/custom `init(from:)` that tolerates both.

### UI notes worth copying

- **Sorting.** Query `.order("position", ascending: true).order("created_at", ascending: false)` for lists (newest first, because create assigns `min - 1`). Items are sorted **client-side**, not by the server: open items first in insertion order (web sorts by `checked_at` presence, then `created_at` ascending), checked ones settling to the bottom. Doing it client-side is deliberate — it keeps the fetch to one round-trip and lets an optimistic check re-sort instantly without a refetch.
- **Optimistic checkbox.** Web keeps a local `[itemID: Bool]` override so the box flips instantly and drops the entry once the write settles. Without this the checkbox waits on an RPC round-trip and feels broken. Do the same.
- **Progress string.** `"\(done) of \(total) done"`, or `"All N done"`, or `"Empty — add the first item"` for a list with no items. Used both on the list card and as the House Hub row subtitle.
- **Surface.** On web this is a **Lists** section on the House Hub whose subtitle is the top list plus its progress (`"{emoji} {title} · {progress} · +N more"`), linking to `/house/lists?house=<slug>`. iOS already has `HouseHubView` (per the web repo's iOS-parity note), so a row there → a new lists screen is the natural placement.

### Size

**Small — one sitting.** One service file wrapping nine RPCs and one fetch, one list screen, one composer sheet. A v1 could ship read + add item + check/uncheck + create list, and defer: rename/re-emoji a list, the `note` field, the two sweep buttons, and item text editing. I'd keep both sweeps — they're a single RPC each and they're the reason a recurring list works at all.

---

## Part B — The Leads chat (migration `0172_committee_leads_chat_and_lead_roster.sql`, **superseded in part by `0177_committee_level_leads.sql`**)

A private chat room per committee, for the people who lead it. **No new tables.** It is a reserved channel value on the existing committee chat, which iOS already has.

### ⚠️⚠️ READ THIS FIRST: 0177 changed the lead predicate. Don't implement 0172's version.

0172 defined "lead" as an **area** lead only: a `committee_roster.roles[]` entry ending in `" · Lead"`. That left a committee with **no subcommittees at all** (e.g. Resort Maintenance) with no possible leads and a permanently unreachable Leads room. 0177 added a committee-**level** lead flag and repointed the gate at a unified check.

Confirmed in the live database: `can_access_committee_area`'s `'leads'` branch now calls **`is_committee_lead(cid)`**, not `is_committee_area_lead(cid)`. (0177 is the newest of the three definitions of `can_access_committee_area`; 0063 → 0172 → 0177.)

The 0172 functions `is_committee_area_lead(cid)` and `is_committee_area_lead_slug(p_slug)` **still exist** but are no longer wired into anything — grep confirms zero live callers outside 0172 itself. ⚠️ **If you call `is_committee_area_lead` for a client-side check, a committee-level lead of a role-less committee will be told they aren't a lead — while the database happily lets them into the room.** Use the 0177 pair.

### The lead predicate

```
is_committee_lead(cid uuid)          -> boolean   -- keyed on committees.id
is_committee_lead_slug(p_slug text)  -> boolean   -- keyed on committee_roster.committee_slug
```

Both are `SECURITY DEFINER`, `STABLE`, granted to `authenticated`, and both mean exactly:

> There is a `committee_roster` row for this committee whose `linked_user_id = auth.uid()`, **and** that row either has `is_lead = true` **or** holds at least one `roles[]` entry matching `LIKE '% · Lead'`.

⚠️⚠️ **`is_committee_lead` is an OLD name that 0177 REDEFINED — do not read "0177" as "new function".** It has existed since `0015_roles_and_alerts.sql`, where it meant something entirely different: `committee_members.role = 'Lead'` **OR** `profiles.is_admin`. 0177 issued `create or replace` on the same name and signature, so the roster-based body above is what's live — but that replacement also silently repointed every *other* caller of the old function: `review_join_request`, `set_committee_areas`, `set_committee_lead`, `reject_committee_admin`, the `committee_join_requests` read/delete policies, and the email-recipient helper. **All of those now exclude plain app admins**, because the 0177 body has no `is_admin` clause. Consequence for you: don't assume "admin" gets through any RPC whose gate is `is_committee_lead`, and don't reuse the name for a Swift helper that means the 0015 thing.

Three consequences of the predicate itself:

- ⚠️ **`linked_user_id` is the key, not name or email.** An account-less roster person (one of the 5 current lead rows — Lauren Zerfas, seeded in 0056 with a null email) is a lead on paper and can never enter the room — there's no `auth.uid()` to match. That is correct behaviour, not a bug to work around.
- **`is_lead` is committee-wide** and needs no subcommittee. `is_lead boolean NOT NULL DEFAULT false` on `committee_roster` (added by 0177). Currently 0 rows have it set.
- ⚠️ **There is NO admin override, deliberately.** Both functions exclude `profiles.is_admin` entirely — an explicit product decision recorded in both migration headers: *"the Leads chat is for actual leads only — an admin who isn't a lead of the committee is not in its Leads room."* So: **compute the Leads channel from the viewer's own roster rows, never from `isAdmin`.** An admin who isn't a lead sees no Leads room and gets zero rows if they force the query — that is the feature working. (Note this is the *opposite* of every other branch of `can_access_committee_area`, which does grant admins access. It's the one asymmetry in the whole chat gate.)

### The sentinel channel value

Messages live in `committee_messages` with `area = 'Leads'`. There is no `leads` table, no `leads_messages`, no flag column.

The read gate is the existing policy `"cmsg: member read"` → `can_access_committee_area(committee_id, area)`, whose new first branch is:

```sql
when lower(p_area) = 'leads'
     and not exists (select 1 from committee_areas ca join committees c on c.slug = ca.committee_slug
                     where c.id = cid and lower(ca.area) = 'leads')
  then is_committee_lead(cid)
else  … the ordinary 0063 behaviour (admin OR roster-linked AND holds the area) …
```

⚠️ **The read policy is NOT just that function.** Its live definition (last rewritten by `0128_chat_moderation.sql`) is:

```sql
using (
  can_access_committee_area(committee_id, area)
  and (status = 'visible' or author_id = auth.uid()
       or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
)
```

`committee_messages.status` is `text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','pending','hidden'))`. A message the moderation triggers hold is invisible to everyone but its author and admins — including in the Leads room. So a message you just posted from a test account can legitimately be missing on a second device. Web doesn't even select `status`; it just lets RLS filter.

The INSERT policy is likewise longer than the section title suggests — its live form is from `0112_admin_committee_taxonomy.sql`:

```sql
with check (author_id = auth.uid()
            and can_access_committee_area(committee_id, area)
            and not is_committee_area_archived(committee_id, area))
```

For `area = 'Leads'` the archived check can only trip when the whole **committee** is archived (there is no real `'Leads'` row in `committee_areas` to archive) — so an archived committee's Leads room is readable history but rejects new posts. Mirror that: don't offer a composer there.

⚠️ **Write the area string as exactly `"Leads"` — capital L, no other casing.** The RLS branch is case-insensitive (`lower(p_area) = 'leads'`), so a lowercase `"leads"` would still *read*. But two other things compare it **exactly**:

1. `committee_area_reads`'s primary key is `(committee_id, user_id, area)` on the **raw** string — so `"leads"` and `"Leads"` become two separate unread/mute rows and your badge will never clear.
2. The mini's push senders (`media-server/apns-sender.js`, `push-sender.js`) both branch on `msg.area === "Leads"` to resolve recipients, and the mute lookup does `.eq("area", msg.area || "")`. A message stored with any other casing falls into the ordinary-area branch, matches nobody's `roles[]`, and **silently pushes to no one.**

So: one constant, `let leadsArea = "Leads"`, used for the message insert, the message query, `mark_area_read`, and `set_area_mute`.

### The guard for someone naming a real role "Leads"

That `not exists (… a real 'Leads' area …)` clause is the whole reason the sentinel is safe. If an admin ever creates a genuine role literally named "Leads" on a committee, the branch **backs off** and `'Leads'` behaves as an ordinary area for that committee — so the sentinel can never hijack a real role, and the word did **not** have to be reserved in `add_committee_area` / `rename_committee_area`.

Two related facts:

- `valid_committee_areas(cid, areas)` (migration 0073) rejects `'general'` and any area not present in `committee_areas` for that committee, so nobody can be *assigned* the role "Leads" **through the RPCs that call it** (`request_to_join`, `review_join_request`, `set_committee_areas`, `set_my_committee_areas`). ⚠️ **It is NOT a table constraint.** Part C's roster writes are direct table writes gated only by RLS, so an admin or a lead can put any string — including `'Leads'` — into `committee_roster.roles`. The sentinel survives that anyway, because a plain `'Leads'` entry never matches `LIKE '% · Lead'` and so grants nothing; just don't lean on validation that isn't in the write path you're using.
- Currently **0 committees have a real "Leads" area**, so the branch is live everywhere.

⚠️ **Mirror the guard client-side, and mirror the SQL version, not the web version.** Web checks `iAmLead && !committeeArchived && !myAreas.includes("Leads")` — i.e. *do I personally hold an area named Leads* — which is **narrower than the SQL check**. Walk the case where a committee has a real "Leads" role and you are a lead of some *other* role but not on "Leads": web still renders the Leads channel, but SQL takes the `else` branch, finds `'Leads'` is not in your `roles[]`, and denies — you get a room that reads empty and refuses your messages. The SQL-faithful check is: *does `committee_areas` contain a row for this committee with `lower(area) = 'leads'`? If yes, don't synthesise a Leads channel at all.* You're already fetching `committee_areas` to build the area channels (web fetches it for the archived flags), so this costs nothing. Do keep web's other two conditions — you must lead something there, and skip archived committees. (Nobody can hit the "Leads" collision today — 0 real "Leads" areas exist — but it's a two-line difference and the web version is the one with the latent bug.)

### What you reuse verbatim (nothing new to build)

| Concern | Existing object | Note |
|---|---|---|
| Messages | `committee_messages` (`area text` nullable, `status text` from 0128) | `area IS NULL` = the committee-wide channel; `'Leads'` = this room |
| Media / reactions / mentions | `committee_message_media`, `committee_message_reactions`, `committee_message_mentions` | Their read policies all follow the parent message's **channel** via `can_access_committee_area(m.committee_id, m.area)` — nothing to change |
| Unread + mute | `committee_area_reads` — PK `(committee_id, user_id, area)`, cols `last_read_at`, `muted boolean NOT NULL DEFAULT false`, `muted_until timestamptz NULL`. **`area = ''` stands in for the committee-wide channel**, since the PK column is `NOT NULL DEFAULT ''` | own-row RLS (select/insert/update on `user_id = auth.uid()`; no delete policy) |
| Mark read | `mark_area_read(cid uuid, p_area text)` | pass `'Leads'`; `nil` coalesces to `''` |
| Mute | `set_area_mute(cid uuid, p_area text, p_muted boolean, p_muted_until timestamptz DEFAULT NULL)` | ⚠️ see the overload warning |

⚠️ **`set_area_mute` has TWO live overloads** — the 3-arg `(cid, p_area, p_muted)` from 0063 (never dropped) and the 4-arg one from 0155 with `p_muted_until`. PostgREST resolves an RPC by the set of keys you send, so sending only three keys makes both candidates viable and risks `PGRST203 could not choose the best candidate function`. **Always send all four keys** (`p_muted_until: nil` is fine — an explicitly-sent null still pins the 4-arg overload). Web does exactly this. This project has already been burned by coexisting overloads once: two 7-arg `request_cabin_stay` variants silently coexisted from 0108 until 0115, and every call resolved to 0092's overload, so a `notify = false` intent never took effect (fixed by migration 0115, which merged them into one 8-arg function and dropped both).

### RLS read rules — one sentence each

- **`committee_messages`**: you see a message only if `can_access_committee_area(committee_id, area)` **and** it isn't held from you (`status = 'visible'`, or you wrote it, or you're an admin) — for `area = 'Leads'` the first half means "you hold a `· Lead` role or `is_lead` on this committee", with **no admin override**; for any other area it's "admin, or roster-linked and you hold that area"; for `area IS NULL` it's "admin, or roster-linked at all".
- **`committee_message_media` / `_reactions` / `_mentions`**: readable if you can access the parent message's **channel**. (Note the child policies have no `status` clause, so a held message's media stays readable to the channel even though the message row is filtered — don't build UI that assumes the two agree.)
- **`committee_area_reads`**: your own rows only (`user_id = auth.uid()`).
- **`committee_roster`**: readable by any **approved** member — see Part C's warning.

Empty in the Leads room therefore means one of: you aren't a lead, your roster row isn't linked to your account, or a real "Leads" role exists on that committee. It almost never means "no messages" (though right now it also genuinely does — 0 messages exist).

### Push already works — and this is the part iOS will get wrong

`media-server/apns-sender.js` **already** handles the Leads room. It resolves recipients server-side from `committee_roster` (selecting `linked_user_id, roles, is_lead`, with a graceful `42703` fallback for pre-0177), keeps only rows where `is_lead === true || roles.some(r => r.endsWith(" · Lead"))`, drops the author, skips muted members, and gates on the recipient having `'chat'` in `profiles.push_types`. So **an iOS lead will start receiving Leads-room pushes the moment anyone posts there, whether or not the native app has a Leads screen.**

The payload's deep link is:

```
<APP_URL>/posts?c=<committee-slug>&area=Leads&m=<message-id>
```

⚠️ **If your APNs deep-link router doesn't handle `area=Leads`, the tap dead-ends** — most likely dumping the user in the committee-wide channel or nowhere, for a message they can see nothing of. Handle it before or with the screen itself. The push title is `"<emoji> <Committee name> — Leads"` (the sender formats it as `${committee.name} — ${msg.area || "General"}`), so the notification promises a room the app must be able to open.

⚠️ **And note what the payload does NOT contain.** Committee chat sends `{ title, body, url, type: "chat" }` — **no `target_type` / `target_id`**, unlike the house-chat payload, which carries them so the phone can resolve the room natively. For a Leads push the `url` query string is your *only* routing input, so parse `c=`, `area=` and `m=` out of it.

Also note: on the **web** side, opening a committee room must go through the Feed route (`/posts?c=<slug>&area=<area>`) and never the standalone `/committees/<slug>/chat` route, which fails inside an installed PWA. That's a web-only constraint — irrelevant to native navigation, but it's why the deep link has that shape.

### Mentions and the members sheet

- ⚠️ **@mention candidates come from `committee_roster`, not `committee_members`.** `CommitteeChat.tsx` loads them as `from("committee_roster").select("linked_user_id").eq("committee_slug", slug).not("linked_user_id", "is", null)`, with the comment *"the source of truth since 0057 — reading `committee_members` here missed anyone added the modern way, so they couldn't be tagged."* (`CLAUDE.md` still says `committee_members`; it is stale — `committee_members` has not driven access since 0057.) The candidate list is **not** area-filtered, which is why the Leads room needed **zero** mention-scoping changes — but if you port this to Swift, port it off the roster or your @-picker will be missing people.
- **"Who's in this room"** for the Leads channel = every lead of the committee, computed as `is_lead == true || roles.contains { $0.hasSuffix(" · Lead") }` over the committee's roster rows. (Web uses the same predicate for the room's "Email members" sheet.) Note web does **not** require `linked_user_id` here, so an account-less lead is *listed* in the sheet even though they can never enter the room — match that, or your sheet will disagree with the web app.

### Size

**Small, given iOS already has committee area chat.** It's one synthetic channel row in your channel list, one predicate, one constant, and the deep-link case. The only real work is deciding where the row appears — web splits its chat list into three ordered sections: **Lead chats** (only shown where you lead something), **Full helping crew** (the `area IS NULL` channel, retitled from "General"), then **Roles & subcommittees**.

---

## Part C — Lead-run rosters (`0172` §3, repointed by `0177` §4)

Leads get full control of **their own** committee's roster: add/remove people, edit their details, assign areas, and set/unset other leads — never cross-committee.

### Three additive RLS policies — no RPC

Read live from `pg_policies` on `public.committee_roster`:

| Policy | Command | Predicate |
|---|---|---|
| `committee_roster write` (0056) | `ALL` | `EXISTS (select 1 from profiles p where p.id = auth.uid() and p.is_admin)` |
| `committee_roster lead insert` | `INSERT` | `WITH CHECK is_committee_lead_slug(committee_slug)` |
| `committee_roster lead update` | `UPDATE` | `USING` **and** `WITH CHECK` `is_committee_lead_slug(committee_slug)` |
| `committee_roster lead delete` | `DELETE` | `USING is_committee_lead_slug(committee_slug)` |
| `committee_roster member read` (0183) | `SELECT` | `is_approved_member()` |

Postgres **ORs** permissive policies per command, which is the whole trick: the three lead policies *add* a second writer alongside the admin `FOR ALL` policy without touching it. Admins keep full control everywhere; leads get the same power scoped to committees they lead.

**So roster writes are plain table writes, not RPCs.** Insert / update / delete `committee_roster` directly and let RLS decide. A cross-committee **insert** fails with `42501`; a cross-committee **update/delete** simply matches 0 rows (RLS filters rather than raising — the same silent-failure shape as Part A, so check the affected-row count, don't just check for an error).

⚠️ **`committee_roster` reads require an APPROVED member, not merely a signed-in one.** Migration 0183 swapped the old `auth.uid() is not null` for `is_approved_member()` (= `profiles.approved is true OR profiles.is_admin is true`). A brand-new signup awaiting admin verification gets **zero roster rows** — hence no committees, no channels, no lead status, no Leads room — with **no error**. If your channel list is mysteriously empty for a new test account, check `profiles.approved` before debugging anything else. (Note the DB column is `approved`; the UI calls it "Verified". Don't unify the names — Supabase owns "verified" for email OTP.)

⚠️⚠️ **Reading the roster hits the two-FKs-to-`profiles` embed trap too.** `committee_roster` references `profiles(id)` from **both** `linked_user_id` and `updated_by`, so a bare `profiles(display_name)` embed answers HTTP 300 / `PGRST201` and your client sees `[]`. Web always names the FK:

```
id, name, email, phone, roles, position, linked_user_id, is_lead,
profiles:linked_user_id(display_name, avatar_url)
```

Same failure signature as the house-lists embed in Part A: the roster renders empty while writes work fine.

### The exact write shape

Web's `saveRosterEntry` writes these columns (insert, or update by `id`):

```
committee_slug  text        -- required; RLS keys on it
name            text        -- part of UNIQUE (committee_slug, name) — see below
email           text?       -- ALSO the auto-link key: a DB trigger stamps
                            --   linked_user_id when a profile's contact_email matches
phone           text?
roles           text[]      -- NOT NULL default '{}'; e.g. ["Meals · Lead", "Logistics"]
linked_user_id  uuid?       -- null == an account-less "Pending" person
is_lead         boolean     -- committee-level lead (0177); web omits the key entirely
                            --   when it has no opinion, and retries without it on 42703
updated_at      timestamptz -- ISO8601 now
updated_by      uuid        -- your own uid
```

Two columns the web writer deliberately never sends, which you should know about anyway:

- `position int NOT NULL DEFAULT 0` — new rows land at 0, so a fresh person sorts to the top of an `.order("position")` read. There is no reorder path for the roster either.
- and the table carries **`UNIQUE (committee_slug, name)`** — adding a second person with the same display name on one committee fails with `23505` unique-violation, not `42501`. Surface that as "someone with this name is already on this committee", not as a permissions error.

`deleteRosterEntry` is `DELETE … WHERE id = <id>` — which *is* "remove them from the committee", because `committee_roster.linked_user_id` has been the real chat-access gate since migration 0057.

**Account-less roster people are first-class.** `linked_user_id = nil` + a name (+ optional email) is a valid row, shown as "Pending", and can be put on subcommittees like anyone else. Their email is the auto-link key: two SECURITY DEFINER triggers (one on `profiles.contact_email` from 0056, one on `committee_roster.email` from 0060, both trimmed + case-insensitive) bind the slot to a real account automatically. The roster-side trigger only *fills* an empty link, so it never clobbers an explicit "pick a member" link.

### Self-service, and the two write paths that must not be mixed up

On the committee page web pins a "my membership" card (`MyCommitteeCard`) offering: see your roles, **step down** from a lead role (you stay on the role as a volunteer), edit your areas, or leave.

⚠️ **Which write path you use decides whether lead standing survives — and one of them costs more than the lead badge.**

- A **lead or admin** edits by writing the roster row directly (`committee_roster` update via `saveRosterEntry`), reconstructing `roles` so any area they still hold and still lead keeps its `" · Lead"` suffix.
- A **plain member** uses `set_my_committee_areas(cid uuid, areas text[])`. ⚠️⚠️ **It does not "strip the suffix" — it DROPS the whole entry.** The filter is `where trim(a) <> '' and lower(trim(a)) <> 'general' and a not like '% · Lead'`, so `"Meals · Lead"` isn't rewritten to `"Meals"`, it disappears: the person is no longer on Meals **at all**, loses the Meals area chat, and loses the Leads room. Harmless for a plain member (they hold no `· Lead` entries); **doubly destructive if you route a lead through it.** It also requires existing `committee_members` membership (`is_committee_member(cid)`, else it raises *"Join the committee first — ask an admin to approve your request"*) and it overwrites **both** `committee_members.areas` and `committee_roster.roles`.
- **Step down from one area** = rewrite `roles`, mapping `"Meals · Lead"` → `"Meals"`, then write the row. There is no dedicated RPC.
- **Leave the committee** = `leave_committee(cid uuid)`, which sets your `committee_roster` row's `linked_user_id = null` **and** `roles = '{}'`, and deletes your rows from `committee_members` and `committee_join_requests`. Before migration 0073 it only cleared `committee_members`, so leaving silently didn't revoke chat access — that's fixed, just don't hand-roll a replacement. (It leaves `is_lead` set, which is harmless: every lead check also requires `linked_user_id = auth.uid()`.)

### ⚠️⚠️ THE TRAILING LEAD-SUFFIX TRAP — the highest-value warning in this section

A person's role entry is **either** the plain role name **or** the name plus a trailing `" · Lead"`. Both forms mean "on this role" — `can_access_committee_area` accepts either (`p_area = any(r.roles) or (p_area || ' · Lead') = any(r.roles)`).

**Comparing raw role strings silently stripped a person's lead standing.** The real incident, on web: the per-member area chip editor compared raw strings, so for someone holding `"Meals · Lead"` the **Meals chip rendered unlit** — it didn't match `"Meals"`. An admin who then edited *any* of that person's areas saved a role list with the lead standing **deleted**. No error, no warning; the person just quietly stopped being a lead, which under 0172/0177 also silently evicts them from the Leads chat and revokes their scoped roster control. It was found only by reading the code.

**The helpers that exist to prevent it** all live in one place, `lib/committeeAdmin.ts`, and are the *only* sanctioned way to compare or edit a role entry:

| Helper | Meaning |
|---|---|
| `LEAD_SUFFIX` | the literal `" · Lead"` |
| `baseArea(entry)` | the entry with any `" · Lead"` stripped |
| `isOnArea(areas, area)` | on it **at all**, as member or lead — `areas.some { baseArea($0) == area }` |
| `isAreaLead(areas, area)` | lead of that area specifically — `areas.contains(area + LEAD_SUFFIX)` |
| `withArea(areas, area, lead)` | set the area (as lead or plain), **replacing** any existing entry for it |
| `withoutArea(areas, area)` | remove it in **either** form |
| `rolesIncludeAreaLead(roles)` | holds any `· Lead` entry at all |
| `isCommitteeLead(entry)` | the unified check — `entry.isLead \|\| rolesIncludeAreaLead(entry.roles)` |

Port these as a Swift extension **before** you write any roster UI, and never compare a role string with `==` again:

```swift
let leadSuffix = " · Lead"                    // U+00B7 MIDDLE DOT, one ASCII space each side

func baseArea(_ e: String) -> String {
    e.hasSuffix(leadSuffix) ? String(e.dropLast(leadSuffix.count)) : e
}
func isOnArea(_ areas: [String], _ area: String) -> Bool {
    areas.contains { baseArea($0) == area }        // ← the bug was using areas.contains(area)
}
func isAreaLead(_ areas: [String], _ area: String) -> Bool {
    areas.contains(area + leadSuffix)
}
/// Replaces, never appends — so you can't end up with BOTH "Meals" and "Meals · Lead".
func withArea(_ areas: [String], _ area: String, lead: Bool = false) -> [String] {
    areas.filter { baseArea($0) != area } + [lead ? area + leadSuffix : area]
}
func withoutArea(_ areas: [String], _ area: String) -> [String] {
    areas.filter { baseArea($0) != area }
}
func rolesIncludeAreaLead(_ roles: [String]?) -> Bool {
    (roles ?? []).contains { $0.hasSuffix(leadSuffix) }
}
func isCommitteeLead(isLead: Bool?, roles: [String]?) -> Bool {
    (isLead ?? false) || rolesIncludeAreaLead(roles)
}
```

Three more things about that string:

- ⚠️ **The separator is U+00B7 MIDDLE DOT (`·`, bytes `C2 B7`) with a plain ASCII space on each side** — verified by hexdump against migration 0177 (`25 20 c2 b7 20 4c 65 61 64` for the pattern `'% · Lead'`). SQL matches `LIKE '% · Lead'`. A hyphen, an interpunct look-alike, a non-breaking space, or a smart-quote-mangled paste produces a role that **no** lead check anywhere — SQL, web, or the two push senders — will ever recognise. Define it once as a constant and never type it again.
- ⚠️ **Never build a role string from a localized or user-typed value.** `withArea` composing `area + " · Lead"` is the only sanctioned construction. If a role name itself ever ended in `" · Lead"`, `baseArea` would eat it — one more reason not to let users type role names into this position.
- **`withArea` replaces rather than appends** on purpose. Appending gives a row holding both `"Meals"` and `"Meals · Lead"`; `is_committee_lead` would still pass, but the roster UI double-renders and `set_my_committee_areas` would drop the `· Lead` copy while keeping the plain one, unpredictably.

### Gating the editor UI

Web computes `canManage = (isAdmin || iAmLead) && !previewAsId`, where `iAmLead` is `members.some { $0.linkedUserId == effectiveUserId && isCommitteeLead($0) }` over **your own** roster row for that committee.

Two conventions this project enforces everywhere and that apply here:

- ⚠️ **"Is this mine?" resolves through the effective user id**, never a raw session lookup. Web has an admin "view as" preview where the two differ.
- ⚠️ **Every write must no-op while previewing** — "view as" is strictly read-only (`useHouseLists`'s `guarded()` returns early on `previewAsId`, and `canManage` clears). If iOS has no preview mode, this collapses to the plain uid; don't invent one.

Note the asymmetry, and don't "simplify" it: **`isAdmin` DOES grant the roster editor** (via the 0056 `FOR ALL` policy on direct table writes) but **does NOT grant the Leads chat**. Same screen, two different gates. And a third wrinkle from the `is_committee_lead` redefinition in Part B: the *older* committee RPCs gated on `is_committee_lead` (`review_join_request`, `set_committee_areas`, `set_committee_lead`) no longer grant an app admin who isn't a roster lead of that committee — so "admin can do anything" holds for the roster table, not for those RPCs.

### Size

**Medium** — the only genuinely non-trivial piece here. It needs a roster editor: a person sheet (name / email / phone / link-an-account / a "Lead of this committee" star / per-area checkboxes each with their own ★ Lead toggle), plus add and remove. The web sheet is ~300 lines.

**A defensible v1 omits the editor entirely** and ships: a **Lead** badge on the roster (`isCommitteeLead`), the private **Leads room**, and **self-service step-down / leave**. That's most of the value at a fraction of the work, and it leaves every write path in the hands of the web admin UI, which already works. Add the editor when someone asks to run their roster from a phone.

---

## Verify-before-you-ship checklist

- `family-fest` is the **only** committee with leads right now, and only 4 accounts qualify. Sign in as one of them or nothing in Part B is testable.
- Create a house list from the web app first — there are **0** in the database, so an empty iOS screen proves nothing.
- Your test account needs `profiles.approved = true` (or `is_admin`) or `committee_roster` returns nothing at all.
- If a list screen or the roster reads empty but writes succeed, suspect a **two-FKs-to-`profiles` embed** (HTTP 300 → `[]`) — it applies to `house_list_items` (`created_by`/`checked_by`) *and* to `committee_roster` (`linked_user_id`/`updated_by`) — then RLS, in that order.
- Never trust "no error" as "it wrote." A direct UPDATE/DELETE against `house_lists` / `house_list_items`, or a cross-committee roster UPDATE/DELETE, matches **0 rows and returns success**. Only INSERTs raise `42501`.
- If a message you just posted is missing on another device, check `committee_messages.status` — chat moderation (0128) holds messages so only the author and admins can see them.
- If Leads-room unread badges never clear, check that you wrote `area` as exactly `"Leads"` everywhere including `mark_area_read`.
- `set_area_mute`: send all four keys.
- Handle `?area=Leads` in the APNs deep-link router — leads are already receiving those pushes today, and the committee-chat payload has no `target_type`/`target_id`, only the `url`.
