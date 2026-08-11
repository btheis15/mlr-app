<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **11 correction(s)** were applied.

### Verified members (0181–0184), and the smaller catch-up items

Everything below already exists in the shared Supabase project. Unless a paragraph is
flagged **BACKEND CHANGE NEEDED**, you are writing Swift against live schema — no SQL.

---

## Part A — Verified members: the app-wide access gate (0181, 0182, 0183, 0184)

### A.1 What the feature is

Anyone can sign up with any email address and complete Supabase's email OTP. Before
0181 that was the *only* gate: a stranger with a throwaway address could read posts,
comments, the Drop Box albums, and every member's phone number and street address
straight from PostgREST as soon as they had any session at all (0081 had already
closed those tables to a bare anon key — the wall was `auth.uid() is not null`, and
minting a `auth.uid()` takes one throwaway email). Now a new signup sees exactly
what a signed-out visitor sees **until an app admin approves them**.

⚠️ **The database column is `profiles.approved`. The user-facing word is "Verified."**
That mismatch is deliberate and documented — Supabase already owns "verified" for
email confirmation, and conflating the two is how you end up telling a member their
email is unverified when it isn't. Do not "clean this up" in either direction: keep
`approved` in your Codable structs and "Verified" in the copy.

### A.2 Schema (migration 0181)

Three columns on `profiles`:

| Column | Type | Meaning |
|---|---|---|
| `approved` | `boolean NOT NULL DEFAULT false` | Admin-approved member. |
| `approved_at` | `timestamptz` (nullable) | **When the last approval DECISION was made — approve *or* revoke** (0182 changed this). `NULL` = no human has ever decided. |
| `approved_by` | `uuid` → `profiles(id) ON DELETE SET NULL` | Who tapped the button; `NULL` when the roster auto-approved them. |

`approved` is **not** in any `grant update(...) on profiles to authenticated` list, so
a client literally cannot write it. `profiles` had `revoke update ... from anon,
authenticated` in 0001 and then re-grants specific columns, so new columns are locked
out by default. The RPC is the only write path.

0181 backfilled every existing row to `approved = true` before the default took
effect (56 members, 0 pending), which is what kept the migration from locking the
whole family out.

⚠️ That backfill also stamped `approved_at = now()` on all 56 rows, and 0182's trigger
stamps it too. So read the flag in one direction only: **`approved_at is null` means
"never decided", but a non-NULL `approved_at` does NOT mean a human decided.**
`approved_at` set with `approved_by` NULL = the backfill or a roster auto-approval.
You never need either column for a UI decision.

### A.3 The helper functions — real signatures, in order

```
is_approved_member() → boolean
    SECURITY DEFINER, STABLE. EXECUTE granted to authenticated AND anon.
    Body: exists(select 1 from profiles where id = auth.uid()
                 and (approved is true or is_admin is true))
    → an admin is IMPLICITLY approved; there is no such thing as an unverified admin.

set_member_approved(p_user uuid, p_value boolean) → void
    SECURITY DEFINER. EXECUTE granted to authenticated; raises
    'Only app admins can approve members' unless the caller has profiles.is_admin.
    Stamps approved_at = now() and approved_by = auth.uid() on BOTH approve and revoke.

is_preregistered_email(p_email text) → boolean
    SECURITY DEFINER, STABLE. ⚠️ `revoke all ... from public` and NO grant to
    authenticated — iOS CANNOT call this. It exists only for the trigger below.

auto_approve_preregistered()  -- trigger fn, not callable
    BEFORE INSERT OR UPDATE OF contact_email ON profiles
    (trigger name: trg_auto_approve_preregistered)
```

`directory_recipients()` and `admin_recipients()` (0184) both `returns table(id uuid,
name text, email text)`, take no parameters, and are `SECURITY DEFINER` gated on
`public.is_approved_member()`. Only relevant if you build the "Email a group" tool.

### A.4 The auto-approve path (0182) — why almost nobody sees the waiting screen

People an admin has already put on `committee_roster` or `family_roster` (name +
email, no account yet) have **no `profiles` row at all**, so 0181's backfill missed
them. They'd sign up months later and sit there waiting on a manual tap even though
an admin had explicitly added them by name and email.

So the trigger auto-approves on signup when `contact_email` matches a roster email
(trim + case-insensitive, same matching as the 0056/0060 roster auto-link).
`handle_new_user()` (0007) seeds `profiles.contact_email` from the OTP-verified
`auth.users.email`, so the INSERT branch is fed a verified address.

The trigger sets **two** columns — `approved := true` *and* `approved_at := now()` —
and deliberately leaves `approved_by` NULL, because nobody tapped a button.

⚠️ The trigger is guarded on `approved_at is null` — "no human has decided yet."
Without that, an admin who deliberately **revoked** someone would see them silently
re-approved the next time their email was touched, making revoke useless. (Because it
stamps `approved_at` itself, it can also only ever fire **once** per person.)

Practical consequence for iOS: with 56 members approved and 12 roster emails
auto-approving, the waiting-for-approval state is **rare but real**. Build it anyway;
it is the whole point of the migration.

⚠️⚠️ **BACKEND CHANGE NEEDED — a likely self-approval hole in 0182. Verify this,
then fix it in SQL, NOT in iOS.** `contact_email` *is* in a member's own update
grant (0006: `grant update (phone, contact_email, venmo, …) on profiles to
authenticated`), and the trigger fires `BEFORE INSERT OR UPDATE OF contact_email`.
Read literally, an unapproved signup can `PATCH` their own row's `contact_email` to
any address that appears on `committee_roster.email` or `family_roster.email` — real
family addresses, guessable, and visible to any approved member — and the trigger
sets `approved := true` because `approved_at` is still `NULL`. `link_family_roster()`
(0123) would additionally stamp `linked_user_id` and carry the roster's pre-assigned
`house_id` onto the account. The INSERT branch is sound (verified auth email); the
UPDATE branch trusts a self-settable column. Sensible fix directions: match against
`auth.users.email` instead of `profiles.contact_email`, or drop the `UPDATE OF
contact_email` branch entirely. **Do not paper over this by hiding the contact-email
field in the iOS UI** — the REST API is the boundary, not your app.

### A.5 What 0183 changed, and what iOS has to do about it (nothing, and something)

0183 swapped **exactly 29 SELECT policies** from `auth.uid() is not null` to
`is_approved_member()`, inside a single `BEGIN`/`COMMIT`.

**iOS needs ZERO query changes.** Every table name, column name and filter stays
identical. What changes is that an unapproved session gets **empty arrays** back.

**And that is precisely the trap.** An unverified newcomer who is handed the normal
member layout sees a Posts tab with no posts, a People tab with one person (themself),
an album with no photos — an app that looks broken. You must add an explicit UI state.

Read rules, one plain sentence each. In every case **empty means "not permitted", not
"no data"**:

- `profiles` — readable by any approved member, **plus your own row always**
  (`is_approved_member() or id = auth.uid()`).
- `albums`, `committee_roster`, `family_roster`, `houses`, `event_attendance`,
  `help_requests`, `help_responses`, `help_request_items`, `polls`, `poll_options`,
  `poll_votes`, `post_media`, `post_comment_media`, `post_comment_mentions`,
  `post_reactions`, `post_tags`, `drop_boxes` — approved members only, nothing else.
- `posts` and `post_comments` — approved member **AND** (`status = 'visible'` OR
  you are the author OR you are an admin). The moderation half is preserved.
- `drop_box_media` — approved member **AND** (`status = 'visible'` OR
  `uploaded_by = auth.uid()` OR admin).
- `work_items` — approved member **AND** (`house_id is null` OR you're in that house).
- `tournaments`, `tournament_entrants`, `tournament_matches`,
  `tournament_participants` — approved member **AND** the tournament's
  `private_activity_id` is null or you're a member of that private activity.
- `meetings`, `meeting_slots`, `meeting_availability` — a `CASE` on `scope_type`:
  `'committee'` → `can_access_committee_area(committee_id, area)`, `'house'` →
  `is_house_member(house_id)`, `'family'` → `is_approved_member()`, else `false`.
  **Only the `'family'` branch changed.**
- **Unchanged, already stricter:** `committee_messages` / `house_messages` and their
  media, gated on `can_access_committee_area()` / `is_house_member()`. A stranger has
  neither, so chat was already closed to them.
- **Unchanged, public by design:** `events`, `cabins`, `announcements`, `committees`,
  `committee_areas` (`using (true)` since 0170), `resort_config`, `app_images`, and
  all the `fest_*` content tables (`fest_config`, `fest_dues`, `fest_schedule_items`,
  `fest_dinners`, `fest_payees`, `fest_activities` — `using (true)` since 0053).
- `notifications` — your own rows only (`recipient_id = auth.uid()`), unchanged. An
  unapproved user can still receive and read a notification; tapping it will land on
  empty content, which is another reason the waiting state must exist.
- `public_profiles` (view, 0081) — `SELECT` granted to `anon` **and** `authenticated`;
  returns `id`, **first name only**, `avatar_url`. The masked name is
  `split_part(trim(coalesce(nullif(display_name, ''), full_name, '')), ' ', 1)`
  aliased back to `display_name` — so it falls back to `full_name` when
  `display_name` is blank. This is the guest tier, and an unverified member now falls
  back to it for other people's names — same as a signed-out visitor.

⚠️ **The own-row escape hatch on `profiles` is load-bearing.** Without
`or id = auth.uid()`, an unverified member cannot read their own profile row — which
means you cannot load their identity, cannot read `approved`, and therefore cannot
even *show* them the waiting screen. It's also recursion-safe: `is_approved_member()`
is `SECURITY DEFINER`, so it bypasses RLS on `profiles` rather than re-entering this
policy.

### A.6 The UI states iOS must add

| Session state | Behaviour |
|---|---|
| Signed out | Existing guest view, unchanged. |
| Signed in, `approved == false` | Treat as **guest**, and on any members-only screen show an explicit "You're signed in — almost there" panel: an admin needs to okay the account, it's a quick check that everyone here is family, and **there is nothing more to do on their end**. |
| Signed in, `approved == true` | Full member view. |
| `approved` missing, null, or the read failed | **Treat as VERIFIED.** |
| Auth still settling | Neutral skeleton — never flash either wall. |

⚠️⚠️ **That fourth row is the single most important line in this section.** An
unknown or unreadable approval flag must default to **verified**. The failure mode to
avoid is locking real members out of their own app over an optional column, a dropped
request, or a schema-cache miss. The web client defaults to verified in *three*
independent places: the initial state value (`useState(true)`, specifically so a
returning member never flashes the waiting screen while the profile query is in
flight), the read-error branch, and the column-absent branch
(`e.approved === undefined ? true : e.approved !== false`). Mirror all three.
`false` is the only value that gates.

Two more behaviours worth copying:

- Where the web shows an inline "🔒 Sign in to see" chip for a guest, an *unverified*
  member gets a **non-interactive** "🔒 Waiting to be approved" chip instead — a
  sign-in button is actively wrong for someone who already signed in successfully and
  will just make them retry a thing that worked.
- The web forces `verified = true` while an admin is using "view as" preview, so an
  admin checking the guest view never appears unverified to themself. Only relevant
  if you port preview mode.

### A.7 Swift specifics

**Decoding.** Make it optional and default open:

```swift
struct MyProfileFlags: Decodable {
    let approved: Bool?       // nil => column absent / not selected => treat as TRUE
    let is_admin: Bool?
}
// var verified = true          // start optimistic
// verified = (flags.approved != false)   // ONLY false gates
```

Do **not** decode `approved` as non-optional `Bool`. A non-optional field makes the
whole `JSONDecoder` throw if the key is missing, and your catch-all error path is
exactly where you must not conclude "unverified".

**Calling the RPC.** Supabase RPC arguments are matched by **name**, so a wrong key
fails at runtime, not at compile time. Use a `Codable` struct whose property names are
character-for-character the SQL parameter names:

```swift
struct SetMemberApproved: Encodable { let p_user: UUID; let p_value: Bool }
try await client.rpc("set_member_approved",
                     params: SetMemberApproved(p_user: memberId, p_value: true)).execute()
```

⚠️ If you use a `JSONEncoder` with `.convertToSnakeCase` anywhere near these structs,
`p_user` stays `p_user` but any camelCase key you invent will be silently renamed.
Keep RPC param structs plain and snake_case-by-hand.

**Timestamps.** `approved_at` is `timestamptz`; PostgREST emits it as
`2026-08-10T14:22:03.123456+00:00`. Swift's `ISO8601DateFormatter` with
`.withFractionalSeconds` is fussy about 6-digit fractions — configure supabase-swift's
decoder with a lenient date strategy, or decode these as `String` and parse lazily.
You do not need `approved_at` for any UI decision; it exists so the trigger can tell
"never decided" from "currently not approved."

**What does NOT transfer from web.** The web caches an identity snapshot in
`localStorage` keyed `identity.<userId>` so a returning member paints instantly. Use
`UserDefaults`/Keychain, and ⚠️ **key any cached private data on the real per-user
identifier, never a shared constant** — the web app leaked one member's cached private
chat to the next user of the same device because a cache key was a literal `"self"`
and sign-out doesn't reload a native app either.

### A.8 The admin surface — and a live web bug not to copy

Admin → Members has a "N people need verifying" banner, an explicit **"Not verified"**
chip on the row, a **✓ Verify / Un-verify** button per member (hidden for yourself and
for admins, since an admin is implicitly approved), and a `VerifiedBadge` ✓ that
members also see in the People directory.

⚠️ Two surfaces the section-writer expected and the web does **not** actually have —
build them on iOS, but don't go looking for a working reference:

- There is **no "N verified · N not verified" counter.** The panel header renders
  `{members.length} members · {adminCount} admins` (`AdminMembers.tsx:270`).
  `verifiedCount` is computed at `:255` and never referenced.
- There is **no unverified-only filter control.** `showOnly` exists (`:80`) and is
  applied at `:261`, but `setShowOnly` has zero call sites, so nothing can flip it.

Two design decisions to keep:

- The **✓ badge renders NOTHING for an unverified person on family-facing surfaces.**
  An "unverified" label next to a relative's name in the directory is a quiet
  accusation and isn't actionable for a member. Admins get the explicit chip.
- The badge is **tappable** and opens an explainer ("An admin confirmed that … is
  part of the family"). On web this had to be portaled out of the row (it was clipped
  to invisibility inside a `truncate` container) and could not be a `<button>` inside
  the row's `<button>`. Neither constraint exists in SwiftUI — but do keep the
  affordance; people ask what the checkmark means.

⚠️⚠️ **The web's admin Verify button does not currently work, and reading the web
code as a reference will mislead you.** `AdminMembers.tsx` defines
`mergeApproval(sb, rows)` — which does `sb.from("profiles").select("id, approved")`
and merges it onto the directory — and **never calls it** (grep the repo: exactly one
occurrence, the definition at line 35). The rows come from `admin_members()`, whose
current definition (0100) returns `id, display_name, avatar_url, household, email,
is_admin, house_id, house_name, created_at` — **no `approved`**; the pre-0008
fallback path selects `id, display_name, avatar_url, household, is_admin` and doesn't
include it either. So `m.approved` is always `undefined`, which means the "Not
verified" chip, the ✓ Verify / Un-verify button (`m.approved !== undefined &&
m.approved !== null`), the `VerifiedBadge` (`if (verified !== true) return null`) and
the "N people need verifying" banner **all render nothing**. Today an admin can only
approve someone by calling `set_member_approved` from the SQL editor. **For iOS: fetch
the flag yourself** — `admin_members()` for the directory, then a separate
`profiles.select("id, approved")` merged client-side by id. (`PeopleDirectory.tsx`
does exactly that and its badge works — it selects `approved` in its own query.) 0181
deliberately did *not* widen `admin_members()`: per the 0160 lesson, that function has
been recreated by 0008 → 0029 → 0064 → 0100, and rebuilding it from an older copy
silently drops whatever the newest version added. A plain additive select is the safe
move. (Worth a one-line web fix too.)

### A.9 The media server is gated on the same flag

The Mac-mini media server (`https://mlr-media.duckdns.org`) enforces approval
independently, because it serves the photo bytes:

- `GET /media-token` (`requireUser` + an inline approval gate) → **403**
  `{ error: "…", pendingApproval: true }` for an unapproved caller. It answers
  `no-store` with **no ETag**, written via `res.end()` so it can never 304.
- `POST /upload` (`requireUser, requireApprovedMember`) → same 403.
- `GET`/`POST /dropbox-zip` → same 403 (this one reads the JWT from the **query
  string / form body**, which is why it needed a separate `isApprovedMemberByToken()`
  variant and was briefly ungated).

⚠️ **`pendingApproval: true` is not an error state — it's the waiting state.** Route a
403-with-`pendingApproval` to the same "almost there" screen, not to an alert.

⚠️ And the server applies the identical fail-open rule: `isApprovedMemberByToken()`
returns `true` / `false` / **`null`**, and `null` (column missing, transient failure,
service key unset) is treated as **allow**. Callers only block on an explicit `false`.

### A.10 The 0184 lesson (no client work, but read it once)

0183 swapped 29 **policies** and contained no function statements at all. A
`SECURITY DEFINER` function bypasses RLS by design, so two of them kept their old
"any signed-in user" check and a brand-new throwaway account could still call them
over the public REST RPC endpoint and get back the family email directory:
`directory_recipients()` (name + best email for 68 people, 12 of whom have never
created an account) and `admin_recipients()` (name + email of all 7 admins — a target
list). Nothing else leaked; the same caller still got zero rows from `profiles` and
`family_roster` directly, which is 0183 working as intended.

⚠️ **Generalise it: policies and DEFINER functions are two separate surfaces. Sweep
both.** If you ever add a gate, enumerate `pg_proc` for `prosecdef` functions
executable by `authenticated` as well as `pg_policies`.

⚠️ Also from 0184: both function bodies were copied **verbatim from the live
`pg_get_functiondef()` output**, not from the migrations that created them, with the
predicate as the only edit. And because they use `set search_path to ''`, every
reference must be schema-qualified — `public.is_approved_member()`, not
`is_approved_member()`, or it fails at runtime with "function does not exist."

### A.11 Size

Small: roughly one flag on your identity model, three default-to-true code paths, one
waiting-for-approval view, one inline chip, and a 403 handler. Half a day.
The optional admin Verify surface is another half day. **Do this before the Drop Box
work** — it costs almost nothing and it's what stops a newcomer seeing an app that
looks broken.

---

## Part B — The smaller catch-up items

### B.1 Post comment media (0162)

Comments on the Main Feed can carry photos and videos. `post_comment_media` mirrors
`post_media` (0004) exactly:

| Column | Type |
|---|---|
| `id` | `uuid` PK |
| `comment_id` | `uuid NOT NULL` → `post_comments(id) ON DELETE CASCADE` |
| `storage_path` | `text NOT NULL` — the **full mini URL**, not a relative path |
| `media_type` | `text NOT NULL DEFAULT 'image'`, check `in ('image','video')` |
| `position` | `int NOT NULL DEFAULT 0` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `thumbnail_url` | `text` nullable (added by 0173) |

Index: `(comment_id, position)`. Added to the `supabase_realtime` publication.

**RLS.** Read: approved members only (0183). Insert: only if you are the author of
that comment (`exists (select 1 from post_comments c where c.id = comment_id and
c.author_id = auth.uid())`). Delete: the comment's author, or an admin.

**Client flow (no RPC — plain inserts):**

1. Insert the comment: `post_comments` ← `{ post_id, author_id, text }`, returning `id`.
   Text may be empty **if** there is at least one attachment (a photo-only comment is
   valid, same rule as the post composer).
2. Optional mentions: `post_comment_mentions` ← `{ comment_id, mentioned_user_id }`.
3. For each file: upload to `POST /upload` (default `category=posts`), then insert
   `post_comment_media` ← `{ comment_id, storage_path: res.url, media_type,
   position: i, thumbnail_url: res.thumbnailUrl }`.

⚠️ **Moderation needs zero client code, but the status can change under you.** Uploads
under `category=posts` are graded **inline** by the mini, so a flagged verdict usually
already exists in `media_moderation` by the time you insert. The DB trigger
`hold_comment_on_flagged_media()` then flips the parent `post_comments.status` from
`'visible'` to `'pending'`, and RLS hides it from everyone but the author and admins.
There is also a reverse-race branch in `hold_content_on_media_verdict()` for a verdict
that lands *after* the row. So: **honour `post_comments.status` when rendering, and
expect a comment you just posted to become `pending` a few seconds later.** Don't
cache the row's status forever. (Note the web does *not* select `status` on comments —
it leans entirely on RLS — so there's no reference implementation to copy here; select
it yourself.)

⚠️ **Render comment media as a small wrapping row of thumbnails, not the full-bleed
grid a post uses** — the post treatment is visually far too heavy inline in a thread.
Tap opens the full-screen viewer.

### B.2 Comment deep links (0164)

`notif_on_post_comment()` and `notif_on_post_mention()` now build their url as:

```
/posts?post=<post uuid>&comment=<comment uuid>
```

for the notification types `post_comment`, `post_reply` and `post_mention`. The APNs
payload's `url` field is `${APP_URL}${n.url}`, so the query string arrives on device
intact.

**iOS work:** parse **both** `post` and `comment` from the notification URL, open the
post, then scroll to and briefly flash that specific comment. Comments render
unpaginated on web (every comment of a loaded post is in the tree), so there's no
"expand thread first" step; if you paginate on iOS, you need to force-load the page
containing that comment id.

⚠️ Notification rows created **before 0164** keep their post-only url. That's a
deliberate, harmless degrade — it still opens the right post. So treat a missing
`comment` param as normal, never as a malformed link.

Also note the `notifications` select needs an FK hint, because the table has **two**
FKs to `profiles` (`recipient_id` and `actor_id`):
`"id, type, actor_id, title, body, url, created_at, seen_at, read_at, expires_at,
actor:profiles!actor_id(display_name, avatar_url)"`. ⚠️ An unhinted embed across two
candidate FKs returns HTTP 300 / `PGRST201` and decodes as an empty array — a bug that
looks exactly like "no data." Name the FK.

### B.3 Chat mute durations (0155)

"Mute for 1 day / 3 days / 7 days / until I turn it back on", for committee-area
chats **and** house chat (which had no mute at all before).

Columns added:
- `committee_area_reads.muted_until timestamptz` (it already had `muted boolean`)
- `house_reads.muted boolean NOT NULL DEFAULT false` and
  `house_reads.muted_until timestamptz`

**A row is effectively muted when `muted` is true OR `muted_until` is set and still in
the future.** A timer clears itself by going stale — there is no cron and nothing
writes `muted` back to false. Compute it at read time:

```swift
let mutedNow = (row.muted ?? false)
    || (row.muted_until.map { $0 > Date() } ?? false)
```

**RPCs — note the first parameter is NOT `p_`-prefixed on either one:**

```
set_area_mute(cid uuid, p_area text, p_muted boolean, p_muted_until timestamptz DEFAULT null) → void
set_house_mute(hid uuid, p_muted boolean, p_muted_until timestamptz DEFAULT null) → void
```

Both `SECURITY DEFINER`, `EXECUTE` to `authenticated`, upserting on
`(committee_id, user_id, area)` / `(house_id, user_id)`. `p_muted = false` always
clears `muted_until` too, so "unmute" fully resets the row.

⚠️ `p_area` is `coalesce(p_area, '')` server-side — the committee's **main** chat uses
the **empty string**, not null, as its area key. The Leads room uses the literal
string `'Leads'` as a sentinel area. Send `""` for the main room or you'll upsert a
second, orphaned read row.

**RLS on both read tables: your own rows only** (`user_id = auth.uid()`), so a query
that returns nothing means "no row yet" (not muted), which is the correct default.

**Push suppression is already server-side** — `push-sender.js` and `apns-sender.js`
both filter recipients with
`.or("muted.eq.true,muted_until.gt.<now ISO>")` before sending. So iOS gets correct
mute behaviour on APNs **for free**; all you owe is the UI. The web pattern: tapping
the bell on an already-muted row is a one-tap **unmute**; tapping an unmuted row opens
the duration sheet.

### B.4 Notification test tools (0156, 0157) — admin only

**Send a test to one member.**
`send_test_notification(p_user uuid, p_title text DEFAULT null, p_body text DEFAULT null) → uuid`
— admin-gated `SECURITY DEFINER`, raises `'Not authorized'` / `'Member not found'`.
Inserts one `notifications` row of type **`admin_test`**, defaulting to title
"🔔 Test notification". It bypasses `profiles.notif_types` entirely (the admin
explicitly targeted one person, so there's no preference to consult).

⚠️ **The phone push is an OVERRIDE.** Both mini senders list `admin_test` alongside
`help_urgent`: anyone with `push_types` non-empty gets buzzed regardless of their
per-category picks. If push is fully off they correctly get nothing — that's useful
diagnostic signal, not a bug.

**"Notifications confirmed" checklist.** Three columns on `profiles`:
`notifications_confirmed boolean NOT NULL DEFAULT false`,
`notifications_confirmed_at timestamptz`,
`notifications_confirmed_by uuid → profiles(id) ON DELETE SET NULL`.
Only writable via
`set_notification_test_confirmed(p_user uuid, p_value boolean) → void` (admin-gated;
stamps or clears the timestamp and the who together). Any admin can check or uncheck
anyone; it is deliberately **not** wired to the send tool (an admin can confirm after
a phone call just as well).

**iOS work — the part that matters even if you skip the admin tools:**
⚠️ `admin_test` is a real `NotifType` your Activity feed and your APNs handler will
receive. If your notification-type enum is a Swift `enum: String, Decodable`, an
unknown raw value **throws and kills the whole decode of the feed page**. Give it an
`unknown` fallback (`init(from:)` with `?? .unknown`) or keep `type` as a `String`
with a lookup table for the icon. Web maps it to 🧪. It is deliberately absent from
the notification-preferences screen (there's nothing to opt into) — same as
`broadcast`, which is also pushed via the `alerts` category rather than a type of its
own.

### B.5 Family roster (0123, 0124, 0125) — family who aren't on the app yet

`family_roster` is the master record for a person **before** they have an account:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text NOT NULL` | Temporary, admin-set display name |
| `email` | `text` nullable | **The join key.** Unique index on `lower(email)` where not null |
| `phone` | `text` nullable | |
| `house_id` | `uuid` → `houses(id) ON DELETE SET NULL` | Pre-assigned house |
| `position` | `int NOT NULL DEFAULT 0` | |
| `linked_user_id` | `uuid` → `profiles(id) ON DELETE SET NULL` | Stamped by trigger once they sign up |
| `updated_at` / `updated_by` | | |

**RLS.** Read: approved members only (0183 — it carries emails, i.e. PII). Write
(`for all`): app admins only. So a non-admin's insert/update silently fails; don't
build an optimistic write path for non-admins.

**Two auto-link triggers, both `SECURITY DEFINER`:**
- `link_family_roster()` — `AFTER INSERT OR UPDATE OF contact_email ON profiles`.
  Stamps `linked_user_id`; carries the roster's `house_id` onto `profiles.house_id`
  **only if the account has none yet**; and seeds `display_name` from the roster name
  only if the member hasn't set their own (blank, or still the raw email prefix),
  preferring `family_roster` then `committee_roster`.
- `link_family_roster_from_row()` — `BEFORE INSERT OR UPDATE OF email ON
  family_roster`. Resolves `linked_user_id` from `profiles.contact_email` immediately,
  so an admin typing an already-registered email sees the link right away. ⚠️ It sets
  `new.linked_user_id := null` first and re-resolves, so **never write
  `linked_user_id` from a client** — it will be overwritten.

**0125 keeps one person as one record:** adding an email'd, account-less person to
*any* committee roster also creates their `family_roster` row
(`family_from_committee_roster()`, `AFTER INSERT OR UPDATE OF email, linked_user_id ON
committee_roster`), and editing name/email/phone on `family_roster` cascades to their
account-less committee slots (`sync_committee_roster_from_family()`,
`AFTER UPDATE OF name, email, phone`). ⚠️ So if you build a roster editor, expect a
single write to change rows in **two** tables — refetch both, don't patch locally.

**Where roster emails flow** (all `SECURITY DEFINER`, account-less people only):
`house_member_recipients(hid uuid)` → `table(id uuid, name text, email text)`, gated
on `is_house_member(hid)`; `directory_recipients()` (gated on
`public.is_approved_member()` since 0184) and `all_member_recipients()` (the
"Everyone" pool, still gated on admin-or-any-committee-member — note that check reads
the legacy `committee_members` table, not `committee_roster`); and the
service-role-only `meeting_proposal_email(p_meeting uuid)` /
`meeting_confirmed_email(p_meeting uuid)`. ⚠️ Those last two have been recreated
several times — the **current** definitions are 0133's (0132 had accidentally dropped
0123's account-less roster UNIONs; 0133 restored them). The return shapes are
unchanged: `table(title text, url text, emails text[])` and
`table(title text, description text, meet_url text, when_label text, url text,
emails text[])`.

**0124** additionally widened `committee_member_recipients(cid uuid)` to
`returns table(id uuid, name text, email text, roles text[])` — ⚠️ **the return type
changed, so the old signature was `drop function`'d.** `roles` is `null` when empty,
not `[]`; decode as `[String]?`. (It is gated on `is_committee_member(cid)`, not on
approval.)

**Swift shapes.** `roles text[]` → `[String]?`. `crew_user_ids uuid[]` → `[UUID]`. The
embed for the linked account is
`"…, profiles:linked_user_id(display_name, avatar_url)"` — the alias names the FK
column, which is what keeps it unambiguous.

**Pre-migration degrade convention worth copying:** the web probes with
`family_roster.select("id").limit(1)` and treats `42P01` (undefined table) or
`PGRST205` (schema-cache miss) as "not ready", showing a hint instead of a silent
empty list.

**v1 recommendation: skip this.** It's an admin data-entry surface with no member-
facing screen. The one thing worth knowing is that a member's house and display name
can arrive from a roster row they never saw.

### B.6 `thumbnail_url` (0173) — the biggest scroll-performance win in the app

0173 added a nullable `thumbnail_url text` to **all six** media tables:
`post_media`, `post_comment_media`, `work_item_media`, `drop_box_media`,
`committee_message_media`, `house_message_media`. The mini generates a ~400px JPEG
preview at upload time (sharp for photos, one ffmpeg frame grab for videos) and
returns it as `thumbnailUrl` in the `/upload` JSON response, which is:

```json
{ "url", "thumbnailUrl", "hlsUrl", "capturedAt", "capturedAtSource",
  "name", "originalName", "type", "path" }
```

⚠️⚠️ **Grids must render `thumbnail_url`, NOT `storage_path`.** Every grid on web used
to render the exact stored file, so scrolling an album re-downloaded full-resolution
photos and post-transcode videos for every tile. Load the full asset **only** when
someone taps through to the full-screen viewer. Fall back to `storage_path` when
`thumbnail_url` is `nil` (pre-migration rows, or a generation that failed — it is
best-effort and never fatal).

```swift
let tileURL = media.thumbnail_url ?? media.storage_path   // never the reverse
```

⚠️ **A video tile needs a visible ▶ badge.** With a generated poster frame it is
indistinguishable from a photo; without one it's a black box.

⚠️ **A video's poster frame is seeked ~10% in (capped at 3s), not frame 0.** Real phone
video routinely opens on a black or half-exposed frame while the camera settles;
grabbing frame 0 produced a whole album of black tiles. If you ever generate a poster
client-side, do the same — and size-check the output, because a seek past the last
keyframe can produce an empty file *without* erroring.

⚠️ **The hard-won lesson: an enrichment that only runs at upload time covers none of
the content already there.** When `thumbnail.js` shipped, **every** row in every media
table still had `thumbnail_url = null` (0/48 album items, 0/45 post media) — so grids
were universally falling back to full-res and nobody noticed, because the fallback
works. A separate sweep (`thumbnail-backfill.js`) fills the NULLs from files on disk.
Same shape of failure as B.7. If you add an iOS-side enrichment, ask "what about the
rows that already exist?"

**Chat bubbles are not wired yet:** `committee_message_media` / `house_message_media`
have the column, but neither chat view passes a thumbnail through or renders one
(`CommitteeChat.tsx` / `HouseChat.tsx` never mention it). If iOS wires it, that's a
genuine improvement over web, not parity drift.

**Write paths for the column** (four direct inserts, two RPCs):
- `post_media`, `post_comment_media`, `committee_message_media`,
  `house_message_media` — plain RLS-gated inserts; just include `thumbnail_url`.
  (`post_media` also gets written by `create_post`, below; the direct insert is the
  "add media to an existing post" path.)
- `add_work_item_media(p_work_item_id uuid, p_url text, p_media_type text DEFAULT
  'image', p_position int DEFAULT 0, p_thumbnail_url text DEFAULT null) → uuid`
- `add_drop_box_media(...)` — see B.7 for the current 7-argument signature.
- `create_post(p_caption text, p_occurred_at timestamptz, p_media jsonb, p_tags
  uuid[], p_held boolean) → uuid` (every parameter has a DEFAULT, and PostgREST
  matches by name, so send only what you need) — the media array's per-item keys are
  **camelCase**: `path`, `type`, `thumbnail`, `capturedAt`, `capturedAtSource`.
  ⚠️ Note `thumbnail`, not `thumbnail_url`, and camelCase — a snake_case-converting
  encoder will silently drop `capturedAt`/`capturedAtSource` and you'll lose the date
  with no error.

⚠️ **Signature-change discipline (the 0115 incident):** every widening of
`add_drop_box_media` / `add_work_item_media` explicitly `drop function`s the narrower
overload first. Postgres would otherwise keep both, and PostgREST would resolve to
whichever matched your argument count — so an old client silently kept writing rows
without the new field. If you ever need a new param, drop the old overload.

⚠️ **An unknown column fails the WHOLE insert (`42703`) and takes the photo down with
it, not just the extra field.** The web insert therefore retries in a **column-group
ladder**, newest migration first: drop `["captured_at","captured_at_source"]` (0176),
retry; then drop `["thumbnail_url"]` (0173), retry. Worth mirroring in Swift if you
want the same "the photo still attaches, it just loses the enrichment" behaviour.

### B.7 `captured_at` (0174, 0175, 0176) — sort by when it was TAKEN

Family photos get dumped into an album long after the moment, so "newest upload
first" reads out of order against the real timeline.

Columns:
- `drop_box_media.captured_at timestamptz` (0174)
- `drop_box_media.captured_at_source text` with
  `check (… in ('exif','video','file','post'))` (0175)
- `post_media.captured_at` + `post_media.captured_at_source`, same check (0176)

**Sort rule:** most-recent-first on `captured_at`, **falling back to `created_at`**
(upload time) when it's null — never hide an item for lacking metadata. The web's
comparator is literally
`(b.capturedAt ?? b.createdAt).localeCompare(a.capturedAt ?? a.createdAt)`.

⚠️ On web, capture order is a **per-viewer viewing preference**, applied client-side
over already-fetched rows and never written to the DB, so changing it can't reorder
the album for anyone else. And the **default is upload order**, deliberately: capture
order made a fresh upload scatter into the middle of the album by its shot date, which
reads as the app glitching or losing the photos. Keep upload order as the default and
put capture order behind a toggle (device-local — the web persists it in
`localStorage` under `mlr.dropbox.sort`; use `UserDefaults`).

⚠️⚠️ **`captured_at_source` is a provenance RANKING, and a sweep may only ever move a
row UP the list, never down:**

```
'exif'  ==  'video'   >   'file'   >   'post'
(real file metadata)   (picked file's mtime)   (the source post's own timestamp)
```

The mini runs a periodic sweep (`captured-at-backfill.js`) that upgrades a `'post'`
proxy to real `'exif'`/`'video'` metadata if it can find any, and **never** the
reverse. If iOS ever writes a date, send the honest source: claim `'exif'` only for a
real capture date, `'file'` for a filesystem mtime. `/upload` re-reads the stored bytes
whenever the client's claim is only `'file'` (or absent), precisely so a weak guess
gets replaced. Server-side, `add_drop_box_media` and `create_post` normalise anything
outside the four-value vocabulary to `'exif'`, and force the source to `null` when the
date is null.

⚠️ **Decode `captured_at_source` as `String?`, not a strict enum** — a fifth source
would break a `RawRepresentable` decode of every row in the album.

⚠️⚠️ **iOS should use `PHAsset.creationDate`, and it is genuinely better than what web
does.** The web reads EXIF `DateTimeOriginal` client-side with a hand-rolled JPEG/TIFF
IFD parser, and that parser **cannot open HEIC at all** — iPhone's default format.
Worse, the composer used to run every photo through a `<canvas>` re-encode, which
**stripped every byte of EXIF** before upload; migrations 0174–0176 exist almost
entirely to recover a date that re-encode destroyed. (`prepareImageForUpload()` is now
a deliberate no-op that returns the file untouched, kept as a named function purely so
there's one obvious place to reintroduce client work.) On iOS:

- Read `PHAsset.creationDate` from the **original** asset, before any resizing or
  re-encoding, and send it as `capturedAt` with `capturedAtSource = "exif"`.
- **Upload the original bytes.** HEIC is fine — the mini converts it with a real image
  library (`sharp`/libvips) and keeps the upload as `<uuid>_orig.<ext>`. Do not
  re-encode "to save bandwidth"; that is the exact mistake that caused this whole saga.
  (Trade-off, accepted: a few MB per photo instead of ~1MB, so a large batch over
  cellular is slower. Report per-file failures with a retry.)

⚠️ The web's `file.lastModified` fallback is guarded hard — rejected if missing,
pre-1995, in the future, **or within 60 seconds of now** (`FRESH_COPY_MS = 60_000`),
because a picker that hands over a freshly-made temp copy stamps it with the current
time, i.e. "upload time wearing a disguise." If you ever fall back to a file date on
iOS, apply the same freshness guard.

⚠️⚠️ **The 0175 story, because it's the lesson:** 0174 alone did almost nothing.
The Family Fest album was 48 items — 41 referenced in from existing Feed posts, 7
direct uploads that predated the feature — so **every single row had
`captured_at = null`** and the album collapsed to upload order. Worse, a bulk "add to
album" writes every row inside the **same second**, so those 41 had no meaningful
order at all. The structural cause: a photo referenced from an existing post has **no
File on the client, only a URL**, so there is nothing to read EXIF from. 0175 added
the server-side sweep plus the `'post'` proxy (which spread those 41 photos back
across the real days of fest week — the proxy is
`min(coalesce(posts.occurred_at, posts.created_at))`, and only where exactly one post
owns the file, so a shared file can't pick an arbitrary date). **The takeaway: a
metadata read that only runs at upload time silently covers none of the content that's
already there — and with a null-tolerant sort, the failure is invisible, because it
looks exactly like "these photos have no metadata."**

**Current `add_drop_box_media` signature (after 0180 — 7 args, in this order):**

```
add_drop_box_media(
  p_box                uuid,
  p_url                text,
  p_type               text,                     -- 'image' | 'video'
  p_thumbnail_url      text        DEFAULT null,
  p_captured_at        timestamptz DEFAULT null,
  p_captured_at_source text        DEFAULT null,
  p_credit_user_id     uuid        DEFAULT null
) → uuid
```

⚠️ `p_credit_user_id` is honoured **only** when the caller is an admin and it names a
real profile (and is not the caller themself); a non-admin's value is silently
ignored (they can't attribute an upload to anyone but themselves). It exists so an
admin editing a member's post and ticking "also add to an album" credits the **post's
author**, not themself.

### B.8 Anytime events (0139, 0141) — and the table iOS is keeping alive

**0139** added `fest_schedule_items.anytime boolean NOT NULL DEFAULT false`. It's
modelled as a flag, **not** a nullable `day`, so the `NOT NULL day` column and every
date formatter that reads it stay safe. An anytime item still carries a (meaningless)
`day` value that the client must ignore. Day lists and "what's on today" must
**exclude** `anytime` items; the detail header reads "Anytime all week."

**0141** merged the separate "Anytime activities" concept into anytime schedule
events. Every `fest_activities` row (scavenger hunt, merch, kids' activities) was
copied into `fest_schedule_items` with `anytime = true`, carrying its sign-up config,
slots and signups, with provenance columns making the conversion idempotent:
`fest_schedule_items.source_activity_id`,
`fest_schedule_slots.source_activity_slot_id`,
`fest_schedule_signups.source_activity_signup_id`.

Two shape changes when reading the merged row instead of the activity:
- The activity's `blurb` and `details` are folded into the event's single
  `description`, joined by a blank line (`concat_ws(E'\n\n', blurb, details)`).
- `day` was parked on `current_date` at conversion time — **meaningless, ignore it.**

⚠️⚠️ **iOS still reads `fest_activities`, and that is the ONLY reason the table still
exists.** No *reachable* web path reads or writes it any more: `FestWeek`'s
`ActivityCard` is gone, and nothing renders the `activities` array that
`fetchFestContent()` still fetches (`lib/festContent.ts:392`) and returns. The rows
were deliberately **not dropped** so the native app kept working.

⚠️ But the Planner's editor was **not deleted, only orphaned** — do not read its
presence as "the web still manages activities." Still in the tree with zero call
sites: `ActivityEditor` (`FestPlanner.tsx:1964`), `ActivitySheet` (`:2002`, exported),
`components/ActivityDetailsEditSheet.tsx`, and `saveActivity` / `deleteActivity` /
`updateActivityDetails` / `fetchActivityDrafts` in `lib/festContent.ts`
(`fetchActivityDrafts` is even still imported by `FestPlanner` at `:40` and never
called). It's dead code, but it compiles and it will show up in your grep.

**The drift risk is live and one-directional:** an admin editing a converted anytime
event on web writes only to `fest_schedule_items`. The untouched `fest_activities` row
keeps its old title, description, location, lead and sign-up config **forever**. So
today, an iOS "Anytime all week" section can show stale content that nobody can fix
from the web app — and the only way to fix it would be raw SQL. New anytime items
created since 0141 exist **only** as `fest_schedule_items` and are **invisible to iOS
entirely**.

**Migrating iOS off `fest_activities` is what finally lets the table be dropped.**
Concretely:

```
fest_schedule_items
  select: id, day, start_time, end_time, title, emoji, location, description, bring,
          is_private, anytime, lead_user_id, lead_name, lead_phone, crew_user_ids,
          image_url, links, signup_enabled, signup_capacity, signup_slot_minutes,
          signup_start_time, signup_end_time, signup_mode, signup_instructions,
          signup_fields, signup_reminder_minutes, signup_reminder_email,
          signup_team_size, tournament_enabled, signup_hide_names
  filter: .eq("fest_year", 2026)          -- FEST_YEAR is a client constant, = 2026
  order:  day, then position
  then:   partition on `anytime` — true → "Anytime all week", false → day cards
```

(That is the web's exact select list; note `position` is ordered on but not selected —
PostgREST allows that.)

**RLS: `using (true)`** on all the `fest_*` content tables (0053) — public, unchanged
by 0183, so this section renders for guests and unapproved members too. Writes require
`can_edit_fest()` (0053's blanket write policy) **or** the item's own `lead_user_id` /
a member in `crew_user_ids`, who may self-edit a narrower set of fields (0110, and
0135/0138 for slots).

**Swift decoding notes for that row:** `crew_user_ids` is `uuid[] NOT NULL DEFAULT
'{}'` → `[UUID]` (decode with a `?? []`). `links` and `signup_fields` are `jsonb NOT
NULL DEFAULT '[]'` — decode as your own nested `Decodable` types, defaulting to `[]`.
`signup_reminder_minutes` is `int[] NOT NULL DEFAULT '{}'`. `signup_mode` is
`text NOT NULL DEFAULT 'interval'` (0136), with the check widened by 0143 to
`'interval' | 'slots' | 'headcount'` — so it is **never actually null**; the web's
`?? "interval"` is purely defensive, and decoding as `String?` with that default
(rather than a strict enum) is still the safer call. `day` is a bare `date`
(`YYYY-MM-DD`) and `start_time`/`end_time` are `time` strings —
⚠️ **never hand a bare `YYYY-MM-DD` to a lenient date parser.** On web,
`new Date("2026-07-31")` parses as UTC midnight and rendered as the *previous* day in
Central, which mislabelled every slot by one day — and because the label also fed the
organiser's own picker, it **corrupted 10 stored rows**. Swift avoids that specific
trap if you set an explicit `timeZone` on your `DateFormatter`, but the general lesson
stands: a display bug inside a picker silently corrupts whatever that picker writes.

`is_private` is stored and editable in the web planner (`FestPlanner.tsx:731`) and
mapped through `lib/festContent.ts`, but is **not consumed by any web render path
today** — verify what you want it to mean before honouring it on iOS.

**Size / v1:** switching the existing Anytime section from `fest_activities` to
`fest_schedule_items where anytime = true` is a couple of hours (same section, new
source, one extra `anytime` filter on the day lists). Sign-up slots, teams and
tournaments hanging off those items are a much larger separate feature — a v1 can
render anytime items as read-only cards and skip sign-ups entirely.

---

## Things to verify before you rely on them

1. **The 0182 self-approval path (A.4).** Read from the SQL, not observed live.
   Confirm with a throwaway account against a non-production project before deciding
   how urgent the fix is.
2. **`mergeApproval` being dead code (A.8).** Confirmed by grep at commit `4a2ea79`
   (still true as of this pass — one occurrence, the definition at line 35); it may be
   fixed on web by the time you read this. Either way, fetch `approved` yourself. The
   same file's `verifiedCount` (`:255`) and `setShowOnly` (`:80`) are likewise unused.
3. **Whether 0184 has been run on production.** 0181–0183 were applied 2026-08-10.
   If 0184 hasn't landed, `directory_recipients()` / `admin_recipients()` are still
   open to any signed-in account. `is_approved_member()` being present is not evidence
   that 0184 is.
4. **`MEDIA_AUTH` mode.** Reported as `report`, not `on`, **specifically because
   the native app cannot sign media URLs yet** — but this is not verifiable from the
   repo: `media-auth.js` defaults to `off` (`process.env.MEDIA_AUTH || "off"`) and the
   live value lives only in the mini's gitignored `.env`, so check it on the box. Once
   iOS ships the media token it will be promoted to `on`, at which point an unsigned
   URL is a 403. Assume enforcement.
