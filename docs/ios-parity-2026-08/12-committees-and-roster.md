<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **13 correction(s)** were applied.

### Committees, roles, roster & the family roster

Everything here is **already live in the shared Supabase project** — every table, column, RPC and RLS policy below was read out of `pg_proc` / `pg_policies` on project `vrksrpzlslrcjvbzchfg` on 2026-08-10, not inferred from migration files. **No backend work is needed for any of it** except the two defects in §9 and §13, which affect web today and will affect iOS identically because the bug is in the database, not the client.

**Server state right now** (use as test fixtures):

| | value |
|---|---|
| live committees | **2** — `resort-maintenance` 🛠️ (28 roster rows / 3 `committee_members`), `family-fest` 🎉 (21 / 14) |
| `committee_roster` | **49** rows, **6** unlinked ("Pending"), **5** carrying a `· Lead` role, **0** with `is_lead = true` |
| `committee_members` | **17** rows |
| `committee_areas` | **7**, none archived. Family Fest: `Art & Decorating`, `Entertainment & Games`, `Logistics, Scheduling & Finance`, **`Meals & Head Chefs`**, `Merchandise, Fundraising & Polling`. Resort Maintenance: `General Operations & Upkeep`, `Property Design & Beautification` |
| `family_roster` | **14** rows, **12** unlinked |
| `committee_join_requests` | 9 total, **0** pending |
| pre-registered emails with no account yet | **12** — these auto-approve the instant they sign up (§14, migration 0182) |

⚠️ Note `Meals & Head Chefs`. The web bundle's `FAMILY_FEST_AREAS` seed in `lib/data.ts` still says `"Meals"`, and Beautification was hard-deleted as a committee (its slug is still in the `COMMITTEES` seed). **Any hardcoded area or committee list you ship is already wrong.** See §10.

---

#### 1. The two rosters — and why the counts legitimately differ

Two membership-ish tables. Confusing them is the most expensive mistake available here.

**`committee_roster` — the display roster, and the real access gate.** One row per *person slot* on one committee, keyed `(committee_slug, name)` UNIQUE. A slot may or may not point at an account (`linked_user_id`). Holds `name`, `email`, `phone`, `roles text[]`, `position`, and (since 0177) `is_lead`. Since migration **0057** this table — specifically `linked_user_id` — is what `is_committee_member()` and `can_access_committee_area()` check. Live body:

```sql
is_committee_member(cid) =  profiles.is_admin(me)
  OR EXISTS(committee_roster r JOIN committees c ON c.slug = r.committee_slug
            WHERE c.id = cid AND r.linked_user_id = auth.uid())
```

⚠️ **A roster edit grants more than chat.** Scanning every live SECURITY DEFINER body for `committee_roster` turns up two more consumers the roster silently drives:

* **`can_edit_fest()`** — admin OR a linked **`family-fest`** roster row (repointed by 0057). This is the gate on every Family Fest editor: schedule, dinners, dues, the Home call-outs. So adding someone to the Family Fest roster hands them fest-editing rights, and `leave_committee` / an unlink takes them away.
* **`can_organize_meeting(scope, committee_id, area, house_id)`** — keys on a `" · Lead"` roster role (plus admins). A roster lead can propose committee meetings.

Neither is "the committees screen", but both change the moment you write this table — don't treat a roster write as chat-scoped.

**`committee_members` — a legacy mirror that no longer gates anything.** PK `(committee_id, user_id)`, plus `role text` (`'Lead'`/null), `areas text[]` and `joined_at`. Only `review_join_request`, `set_committee_areas` / `set_my_committee_areas`, and `request_to_join`'s backfill ever write it. Anyone seeded straight into the roster never gets a row.

**That is the whole explanation for 49 vs 17.** Resort Maintenance shows 28 people on its page and 3 in `committee_members`. Expected, not drift — `CommitteeMembers.tsx` was rewritten precisely because it used to read `committee_members` and reported "3 members" beside a 20-person roster.

> **iOS rule: read and write `committee_roster` for everything user-facing.** Treat `committee_members` as write-through exhaust produced by the RPCs. Never display a count from it, never gate a screen on it, and don't try to reconcile the two — they are not supposed to agree. `committee_members.role = 'Lead'` in particular is **dead**: nothing in the live lead logic reads it.

⚠️ Two live RPCs still read `committee_members` as their source of truth and are wrong because of it — `committee_member_recipients()` (§12) and `all_member_recipients()` (§14). Both are covered below; neither is safe to trust as a member list.

`lib/roles.ts` `fetchJoinState` checks *both*, in this order: **`committee_members` first, then a linked `committee_roster` slot, then a pending request** — the roster check exists purely so a pre-registered member isn't shown "Request to join" for a chat they can already open. Mirror that order (members → roster → request); the roster lookup needs the committee's `slug`, which it resolves from the id first.

---

#### 2. Read rules — so an empty array is interpretable

In every case below an unexpected empty result means **"not permitted"**, not "no data".

| table | SELECT policy (live) | what empty means |
|---|---|---|
| `committees` | `true` — fully public, guests included | genuinely no committees |
| `committee_areas` | `true` — public (labels only: a slug + a role name, no PII) | genuinely no roles — **but see §10, this table was invisible for months** |
| `committee_roster` | `is_approved_member()` (was `auth.uid() is not null` before 0183) | signed in but **not admin-approved**, or signed out |
| `committee_members` | `is_committee_member(committee_id)` | not on that committee and not an admin |
| `committee_join_requests` | `user_id = auth.uid() OR is_committee_lead(committee_id)` | neither the requester nor a **roster lead** — now excludes plain app admins, **see §9** |
| `family_roster` | `is_approved_member()` | not approved, or signed out |

`is_approved_member()` (live) = `profiles.approved IS TRUE OR profiles.is_admin IS TRUE` for `auth.uid()`. An unverified brand-new signup reads **zero** roster and family-roster rows — render a "waiting to be verified" state, not an empty roster. (But see §14: a signup whose email is already on either roster is auto-approved and never sees that state.)

Writes:
* `committee_roster` — **direct table writes, no RPC.** Two permissive policies OR together: `committee_roster write` (`FOR ALL`, `profiles.is_admin`) and `committee_roster lead {insert,update,delete}` (`TO authenticated`, `is_committee_lead_slug(committee_slug)`). Admin anywhere, or a lead within their own committee.
* `committee_members` — **no INSERT/UPDATE/DELETE policy at all.** RPCs only.
* `committee_areas` — **no write policy at all** (deliberate, 0170). RPCs only.
* `committee_join_requests` — no INSERT/UPDATE policy; DELETE self-or-lead. RPCs only.
* `family_roster` — `FOR ALL` on `profiles.is_admin`. Direct writes, admin only.

---

#### 3. Email-based account linking — a placeholder upgrades in place

The point of the display roster: **most of the family has no account**, yet the roster is complete, and the moment someone signs up their existing slot becomes their slot — no duplicate, no admin action. Four `SECURITY DEFINER` triggers do it server-side; iOS just renders the result.

1. **`link_committee_roster()`** — `AFTER INSERT OR UPDATE OF contact_email ON profiles`. Stamps `linked_user_id` on every roster slot (any committee) whose `email` matches, case-insensitive **and trim-insensitive** on both sides (0060 added the trims; 0056 lacked them and silently missed a stray space).
2. **`link_committee_roster_from_slot()`** — `BEFORE INSERT OR UPDATE OF email, linked_user_id ON committee_roster`. Reverse direction: an admin typing an email that *already* has an account links it immediately. Only **fills** a null link, so it never clobbers an explicit "pick a member".
3. **`link_family_roster()`** — `AFTER INSERT OR UPDATE OF contact_email ON profiles`. Same for `family_roster`, plus applies the admin's pre-set `house_id` (only when the profile has none) and seeds `display_name` from the roster's temp name (only when the member's own is blank or the raw email prefix, e.g. `motu42`).
4. **`link_family_roster_from_row()`** — `BEFORE INSERT OR UPDATE OF email ON family_roster`.

⚠️ **`link_family_roster_from_row()` starts with `new.linked_user_id := null` and re-derives from the email.** Unlike the committee version it *discards* any `linked_user_id` you send. There is no manual-link path for `family_roster` — email is the only key. Don't build a "pick a member" control there.

⚠️ **Email is the only key that stamps a link. `nameMatches()` is display-only, forever.** `lib/committees.ts`'s fuzzy prefix-token matcher (`"Michelle B"` ↔ `"Michelle Birkholz"`) only *shows* a face next to a seed name (`linkFor()` in `CommitteeRoster.tsx` falls back to it after the email lookup). It must never write `linked_user_id`, because that link grants chat access — a fuzzy match letting the wrong relative into a private committee room is the failure mode.

⚠️ **`review_join_request` never renames an existing roster row — don't warn about something that can't happen, and don't re-implement it.** The live body (0090) prefers linking an existing *unlinked* slot (email match first, then a case/whitespace-insensitive name compare) and, on that path, writes only `roles`, `email` (coalesced, so an existing address wins), `linked_user_id`, `updated_at`, `updated_by` — **`name` is untouched**. `profiles.display_name` is used as `name` only when it has to INSERT a brand-new row, and even that statement's `on conflict (committee_slug, name)` branch doesn't set `name`. Before 0090 the function upserted on an exact name match, which is what produced the visible duplicate ("Rob" twice: the old placeholder plus a new linked row) whenever a display name differed from the roster name by so much as case. Call the RPC; don't match client-side.

⚠️ **`(committee_slug, name)` is UNIQUE.** Two people with the same name cannot both be on one committee, and a colliding rename fails `23505`. `sync_committee_roster_from_family()` handles this by *keeping the old name* instead of erroring. Your roster editor must surface a duplicate-name error, not swallow it.

Collapse the whole thing to three cases and render from it:

```swift
enum RosterLink {
    case linked(userId: UUID, name: String, avatarURL: URL?)  // linked_user_id != nil
    case pending                                              // linked_user_id == nil, email != nil
    case placeholder                                          // linked_user_id == nil, email == nil
}
```
`.linked` renders the **account's** `display_name` + avatar and taps through to the member sheet; the roster row's own `name` is only a fallback. `.pending` gets the "Pending" chip ("links up automatically when they sign in with that email"). `.placeholder` will never auto-link — needs an admin to add an email or pick a member.

⚠️ **Contact precedence:** for a linked person the **linked profile's** `phone`/`contact_email` wins over the roster row's own columns (`effectiveContact()` in `CommitteeRoster.tsx`). The roster columns are the pre-account fallback. Backwards, and you `tel:` a stale number.

---

#### 4. Roles are "areas", and the `" · Lead"` suffix has exactly one home

A committee's roles live in `committee_areas (committee_slug, area, archived_at, archived_by, description)`. A person's roles live as **plain text** in `committee_roster.roles[]`, each entry either the bare area name or the area name **plus the literal suffix `" · Lead"`** — U+00B7 MIDDLE DOT with a regular space either side. `can_access_committee_area` accepts either:

```sql
(p_area = any(r.roles) OR (p_area || ' · Lead') = any(r.roles))
```

⚠️⚠️ **Never compare a role string raw. Port these five helpers verbatim** (`lib/committeeAdmin.ts`) — a raw compare already caused silent data loss on web: for someone holding `"Meals · Lead"` the Meals chip rendered *unlit*, so an admin editing any of their other areas saved a list with that person's lead standing **stripped**.

```swift
let leadSuffix = " · Lead"
func baseArea(_ e: String) -> String { e.hasSuffix(leadSuffix) ? String(e.dropLast(leadSuffix.count)) : e }
func isOnArea(_ areas: [String], _ a: String) -> Bool { areas.contains { baseArea($0) == a } }
func isAreaLead(_ areas: [String], _ a: String) -> Bool { areas.contains(a + leadSuffix) }
func withArea(_ areas: [String], _ a: String, lead: Bool = false) -> [String] {
    areas.filter { baseArea($0) != a } + [lead ? a + leadSuffix : a]   // never leaves both forms
}
func withoutArea(_ areas: [String], _ a: String) -> [String] { areas.filter { baseArea($0) != a } }
```

Server-side, `valid_committee_areas(cid uuid, areas text[])` validates each element against `committee_areas` after stripping the suffix, and **hard-rejects `"general"`/`"General"`** (case-insensitive) because area `IS NULL` *is* the committee-wide channel and that word is reserved. `add_committee_area` / `rename_committee_area` also reject an empty name, `general`, and anything already ending in `" · Lead"`.

⚠️ **The 0076 "Committee Admin is no longer a role" guard is on the ASSIGNMENT paths only, not the taxonomy paths.** `mentions_removed_admin_role(areas)` matches `admin` / `admins` / `committee admin` / `committee admins` (case-insensitive, ignoring a trailing `" · Lead"`) and raises a friendly "please update to the latest version of the app" — but it is wired into exactly three functions: `request_to_join`, `set_committee_areas`, `set_my_committee_areas`. It is **not** in `valid_committee_areas`, `add_committee_area` or `rename_committee_area`, so an admin can still create a role literally named "Admin". That check exists precisely because **a stale client kept sending a role the UI no longer offered** — expect to hit it if you hardcode anything.

**A role can have more than one lead.** Don't build a single-lead picker.

---

#### 5. Two kinds of lead, unified into one check

* **Area lead** (0172) — any `" · Lead"` entry in `roles[]`.
* **Committee-level lead** (0177) — `committee_roster.is_lead = true`, independent of any subcommittee. Exists because a committee with *no* roles (Resort Maintenance had none) would otherwise have no possible lead and an unreachable Leads chat.

Live predicate, and the only one that matters:

```sql
is_committee_lead(cid) =
  EXISTS(committee_roster r JOIN committees c ON c.slug = r.committee_slug
         WHERE c.id = cid AND r.linked_user_id = auth.uid()
           AND (r.is_lead OR EXISTS(SELECT 1 FROM unnest(coalesce(r.roles,'{}')) role
                                    WHERE role LIKE '% · Lead')))
```
Plus a slug-keyed twin `is_committee_lead_slug(p_slug text)` used by the roster write policies. `is_committee_area_lead(cid)` / `is_committee_area_lead_slug(p_slug)` (0172) still exist but nothing in the live policies **or any live function body** references them (checked against `pg_get_functiondef` across `pg_proc`) — **don't call them; they miss committee-level leads.**

```swift
func isCommitteeLead(_ r: RosterRow) -> Bool { r.isLead || r.roles.contains { $0.hasSuffix(" · Lead") } }
```

⚠️ **`is_committee_lead` deliberately has NO admin override.** Explicit product decision for the Leads chat (an admin who isn't a lead of a committee is not in its Leads room) — but the same function gates four other things written in 2026-06 assuming it *did* include admins. See §9.

⚠️ **An account-less lead grants nothing.** Live data has Keith Thibodeau holding `"Entertainment & Games · Lead"` with `linked_user_id = NULL`. He renders a "Lead" badge and is a mailto target for "Email the leads", but `is_committee_lead()` can never be true for him (it requires `linked_user_id = auth.uid()`). Of the 5 lead entries live, only 4 confer anything. Gate lead affordances on the **linked** roster entry, not on the badge.

**The Leads chat entry point** (the chat itself is another section): a reserved channel value `area = 'Leads'` on `committee_messages`, gated by a branch in `can_access_committee_area`:

```sql
CASE WHEN lower(p_area) = 'leads'
       AND NOT EXISTS(committee_areas ca JOIN committees c ON c.slug = ca.committee_slug
                      WHERE c.id = cid AND lower(ca.area) = 'leads')
     THEN is_committee_lead(cid)
     ELSE <the ordinary 0063 membership branch>
END
```
The `NOT EXISTS` guard means that if an admin ever creates a real role literally named "Leads", the sentinel backs off and it behaves as an ordinary area. **Mirror that guard client-side** — skip the Leads channel row when a real `leads` area exists (currently 0 do). No new tables: it reuses `committee_messages` / `committee_area_reads` with the string `'Leads'`, so unread/mute/mark-read work unchanged.

⚠️⚠️ **`mark_area_read` is one function; `set_area_mute` has TWO LIVE OVERLOADS and the 3-arg call is AMBIGUOUS. Always send the 4th argument.**

```
mark_area_read(cid uuid, p_area text)                                              -- one overload
set_area_mute(cid uuid, p_area text, p_muted boolean)                              -- 0063, never dropped
set_area_mute(cid uuid, p_area text, p_muted boolean, p_muted_until timestamptz DEFAULT null)  -- 0155
```
Because `p_muted_until` has a DEFAULT, a PostgREST call naming only `cid`/`p_area`/`p_muted` satisfies **both** candidates and comes back **HTTP 300 / `PGRST203` "Could not choose the best candidate function"** — which reads like a missing function, not an overload collision. `FeedView.tsx` always passes `p_muted_until`, which is the only reason web has never hit this. This is the same trap `request_cabin_stay` sprang in migration 0115. **Send `p_muted_until` on every call — `null` for a permanent mute.**

That 4th parameter is also a feature the mute UI needs: `committee_area_reads.muted_until` stores a timed mute (`null` = permanent; `p_muted = false` clears both flags). **Nothing server-side expires it** — `FeedView` compares `muted_until` to `Date.now()` itself and treats a past timestamp as unmuted. Do the same, or an expired mute stays stuck on. Both functions coalesce `NULL` → `''` for the General channel's PK, and both accept the `'Leads'` sentinel like any area.

⚠️ On web every committee room opens **through the Feed** (`/posts?c=<slug>&area=Leads&from=<slug>`), never the standalone `/committees/<slug>/chat`, because that route dies in the installed PWA before React runs. That is a WebKit-container bug with **no iOS-native equivalent** — you have real navigation. Don't copy the URL shape as if it were meaningful.

---

#### 6. Admin taxonomy management

All admin-gated (`profiles.is_admin`) `SECURITY DEFINER` RPCs. **Argument names are exact and Supabase keys arguments by name** — note the committee id parameter is `cid`, *not* `p_cid`:

| RPC | signature | notes |
|---|---|---|
| `create_committee` | `(p_name text, p_emoji text, p_description text)` | returns the new `committees` row; auto-slugs via `slugify()`, de-duping `-1`, `-2`… |
| `update_committee` | `(cid uuid, p_name text, p_emoji text, p_description text, p_position integer)` | **display fields only — the slug is immutable.** `committee_roster`/`committee_areas` key off the slug with no FK, so changing it orphans both. No slug editor. Each param coalesces to the existing value when blank/null |
| `archive_committee` / `restore_committee` | `(cid uuid)` | sets/clears `archived_at` + `archived_by` |
| `delete_committee` | `(cid uuid)` | **permanent.** Deletes the slug-keyed `committee_roster` + `committee_areas` rows explicitly, then the `committees` row, cascading to messages/media/reactions/mentions, chat polls, meetings, `committee_members`, join requests, `committee_area_reads`, `committee_reads` |
| `add_committee_area` | `(cid uuid, p_area text)` | re-adding an archived name **un-archives** it (history returns live) rather than erroring on the PK |
| `rename_committee_area` | `(cid uuid, p_old text, p_new text)` | see below |
| `archive_committee_area` / `restore_committee_area` | `(cid uuid, p_area text)` | |
| `delete_committee_area` | `(cid uuid, p_area text)` | permanent: drops the allow-list row, `array_remove`s both `'X'` and `'X · Lead'` from every `committee_roster.roles[]` and `committee_members.areas[]`, and **deletes that channel's `committee_messages` + `committee_area_reads`** |
| `set_committee_area_description` | `(cid uuid, p_area text, p_description text)` | 0179; `''` clears. Column is `NOT NULL DEFAULT ''` |

⚠️⚠️ **`rename_committee_area` is not a table edit — it is a seven-way cascade in one transaction.** A role name is denormalized text in seven places, and renaming by writing `committee_areas` alone strips the chat history, everyone's membership, and any role-scoped meeting off the old name:

1. `committee_areas.area` — the allow-list
2. `committee_roster.roles[]` — both `'X'` **and** `'X · Lead'`, suffix preserved
3. `committee_members.areas[]` — same, both forms
4. `committee_messages.area` — **the chat history** (base name, never suffixed)
5. `committee_area_reads.area` — unread/mute state (deletes a colliding target row first)
6. `committee_join_requests.requested_areas[]` and `.requested_area`
7. `meetings.area` — added by 0121, because 0112 predated meetings and a renamed role left its scheduled meeting invisible

**Never rename a role from the client. Call the RPC.** The live `Meals` → `Meals & Head Chefs` rename proves this path is in real use. (Note `delete_committee_area` is *not* symmetrical — it purges 5 of those 7 places and leaves `meetings.area` and `committee_join_requests` pointing at a role that no longer exists.)

---

#### 7. Join requests vs. a member self-managing their own areas

Two different flows, and the distinction is the product.

**Not yet on the committee → request + approval.** `request_to_join(cid uuid, msg text, requested_areas text[])` — exactly one overload live (0061 dropped the older `(uuid, text, text)` form), no ambiguity. Validates the areas, no-ops if you're already in `committee_members`, **and no-ops (backfilling a `committee_members` row) if you already have a linked roster slot** — the 0090 fix, which is why a pre-registered member isn't asked to request access they already have. Otherwise it UPSERTs on `(committee_id, user_id)`, so re-asking after a rejection flips the same row back to `pending` (hence the notification trigger is `AFTER INSERT OR UPDATE`). It writes both `requested_areas[]` and the legacy `requested_area` (element 1) — **read the array, fall back to the scalar.**

`review_join_request(req_id uuid, approve boolean)` — approve upserts `committee_members`, then links-or-creates the roster row (§3).
⚠️ **An empty `requested_areas` on approve means "didn't ask for anything", never "clear their roles"** (0075). A member with two curated areas used the *chat's* "Request to join" prompt, which sends `'{}'`, and approval wiped both. Both upserts now guard with `case when array_length(excluded.…,1) is null then <existing> else excluded end`. The RPC handles it — just pass through.

⚠️⚠️ **The web's area-picking join flow is DEAD CODE — do not "match web" by reproducing it, and do not assume `requested_areas` normally arrives populated.** `CommitteeJoin.tsx` (the request-to-join card, its "Your areas" editor, and `RoleRequiredSheet`) is exported but **mounted nowhere** in the shipped app; `CommitteeEmailMembers.tsx` is likewise unmounted. The **only live request-to-join path** is `CommitteeChat.tsx`'s lock card, which fires

```ts
supabase.rpc("request_to_join", { cid: committeeId, msg: `Hi! I'd like to join the ${name} committee.` })
```

— a canned message, no picker, so `requested_areas` always defaults to `'{}'`. Every live request is therefore a "didn't ask for anything" request, which is exactly the 0075 scenario above. A required-area picker on iOS would be a genuine improvement (see the *"where iOS can beat the web app"* list), not parity — build it if you want it, but the server accepts `[]` deliberately and your approve path must handle `[]` correctly regardless.

**Already on the committee → no approval at all.** `set_my_committee_areas(cid uuid, areas text[])` — the member adds/removes their own areas instantly. It strips any `" · Lead"` the caller passes (**self-service can never self-appoint lead**), strips `general`, dedupes/trims, validates the rest. `set_committee_areas(cid uuid, target uuid, areas text[])` — lead/admin editing *someone else*.

⚠️ **`set_committee_areas` keys on `user_id`, so it silently skips account-less people.** That's why `RolesManager` and `MyCommitteeCard` write `committee_roster` **directly** — the only path that can put a Pending person on a subcommittee. Prefer direct roster writes for assignment; reserve `set_my_committee_areas` for a plain member editing their own areas (a lead editing their own must use the direct write, or the RPC's lead-stripping erases their standing — which is exactly what `MyCommitteeCard` branches on).

⚠️ **Assignment is scoped to people already in the committee.** A role is a subdivision of it, so `RolesManager`'s picker only offers the committee's own roster people, and its empty state points at the members card rather than offering a second way to add someone. Mirror that, or you get two competing "add a person" entry points.

`leave_committee(cid uuid)` — deletes the `committee_members` row and any join request, then nulls `linked_user_id` and empties `roles` on the roster row. **See §13 before shipping a Leave button.**

---

#### 8. Archive-not-delete, and the read-only state

`archived_at` on both `committees` and `committee_areas`. Archiving hides it from live lists and makes its chat **read-only in RLS, not just the UI**: the `cmsg: member insert own` policy carries `AND NOT is_committee_area_archived(committee_id, area)`. Reads still work for the people who were in it plus admins — that's what makes archived history readable. Archiving deliberately **does not** strip the role from anyone's `roles[]`: keeping it preserves "they were in it" and makes restore a single flag flip. `restore_*` brings it back roster and all. 0178's `delete_*` is the separate, irreversible "Delete forever", offered only on already-archived items.

**iOS:** derive "this channel is archived" from `committees.archived_at OR committee_areas.archived_at`, group those under a quiet collapsed disclosure, and render with **no composer** plus a small "This chat is archived" note. Don't rely on the insert failing.

---

#### 9. ⚠️⚠️ VERIFIED LIVE DEFECT — an app admin can no longer see or approve join requests

0015 defined `is_committee_lead(cid)` as `committee_members.role = 'Lead'` **OR `profiles.is_admin`**, and five call sites were written against that contract. **0177 redefined the same function** to the roster-based check in §5 — which, by design for the Leads chat, **dropped the admin override**. Confirmed with `pg_get_functiondef`: there is no `is_admin` clause in the live body.

Consequences, all live, for an app admin who is not a roster lead of that committee:

| surface | gate | effect |
|---|---|---|
| the pending-request queue (`AdminJoinRequests.tsx`, mounted per-committee inside `AdminCommittees`) | RLS `join_requests: self or lead read` → `is_committee_lead(committee_id)` | **returns zero rows.** `useManagedCommittee` resolves `canManage = isAdmin || role === "Lead"`, so the UI renders, then its query is denied and the list is empty; `AdminCommittees`' per-committee "N requests" badge is computed from the same denied query, so it reads 0 |
| Approve / Reject | `review_join_request` → `raise exception 'Not authorized'` | fails — and `AdminJoinRequests`' `review()` **discards the error** and just reloads, so it looks like nothing happened |
| clear/withdraw a request | RLS delete policy | denied |
| `set_committee_member(cid, target, is_member)` | `is_committee_lead` | fails |
| `set_committee_lead(cid, target, is_lead)` | `is_committee_lead` (since 0051; it was admin-only in 0015) | fails |
| `set_committee_areas(cid, target, areas)` | `is_committee_lead` | fails |

Unnoticed because there are **0 pending requests** live, and because roster management moved to direct `committee_roster` writes (whose admin `FOR ALL` policy is intact), so admins can still do everything *else*.

**What iOS must do:** (a) do **not** show approve/reject based on `profiles.is_admin` alone — gate on `is_committee_lead`-equivalent state resolved from the roster, or the buttons throw; (b) **surface the RPC error inline** instead of optimistically removing the row (web's bug, don't port it); (c) treat an empty request list as possibly-denied, not definitely-empty. **The right fix is a backend one-liner** — restore the admin branch in `is_committee_lead`, or add `OR profiles.is_admin` at the five call sites and leave the Leads-chat predicate strict. Hand Brian the SQL; don't work around it in Swift.

---

#### 10. ⚠️⚠️ `committee_areas` was RLS-enabled with ZERO policies — and a fallback hid it

The most important lesson in this section.

`committee_areas` is created by 0073 with **no RLS clause**, and 0081's lockdown explicitly lists it as staying public-read. RLS was nonetheless switched **on out-of-band from the Supabase dashboard** — almost certainly in response to the Security Advisor's "RLS disabled in public" warning — with no policy added. That is the deny-all state.

* **Writes kept working.** `add_committee_area` etc. are `SECURITY DEFINER`, so they bypass RLS. The rows really landed.
* **Reads returned zero rows with NO error.** RLS *filters*; it does not raise. The client got `[]`.
* **Nothing revealed it, because `fetchCommitteeAreas()` falls back to the in-code `FAMILY_FEST_AREAS` seed on an empty result.** Family Fest — the one committee anyone looks at — kept rendering five roles from hardcoded data and looked perfectly healthy. Every other committee got `[]`.
* **Knock-on:** the per-member role picker renders only when `areaOptions.length > 0`, and the join picker gated the same way — so the *assignment UI did not exist on screen*, making "how do I put someone on a subcommittee?" unanswerable. One unreadable table silently deleted the whole feature, in both directions.

Fixed by **0170**, which adds the public-read policy that should have shipped with 0073 (labels only — a slug and a role name, no PII) and deliberately adds **no write policy**, leaving direct writes denied for anon *and* authenticated — strictly tighter than the pre-dashboard state.

**Three rules, and they generalize past this table:**

1. **An empty list is not proof of no data.** Distinguish the outcomes explicitly and never merge them:
   ```swift
   enum Load<T> { case loaded(T), empty, denied, failed(Error) }
   ```
   PostgREST returns HTTP 200 with `[]` for an RLS-denied read. If a table you *expect* to be non-empty comes back empty while a write to it just succeeded, the answer is almost always a policy — check `pg_policies` before touching client code.
2. **Do not ship a seed fallback that substitutes hardcoded content for an empty read.** The web fallback is what made this invisible for months, and it is *already wrong*: `FAMILY_FEST_AREAS` says `"Meals"` where the DB says `"Meals & Head Chefs"`, and the `COMMITTEES` seed still lists a Beautification committee that has been hard-deleted. `fetchCommitteeAreas` also falls back on *any* read error, not just a missing table — so a genuine failure paints as healthy. Ship no seed; show an explicit error or empty state.
3. ⚠️ **The same trap is live in `fetchCommitteeRoster`.** It returns the in-bundle `COMMITTEES` seed whenever the DB read yields **zero rows** — and 0183 makes the read yield zero rows for any account that isn't admin-approved. For Family Fest that seed is 21 real family names and their stale roles (the other two seed committees carry no members, so they'd just render empty). So on web an unverified signup sees a hardcoded family roster. **On iOS: no seed. Show the "waiting to be verified" state.**

---

#### 11. Realtime: only ONE of these tables is published

Verified against `pg_publication_tables`: of `committees`, `committee_areas`, `committee_members`, `committee_join_requests`, `committee_roster`, `family_roster`, **only `committee_roster` is in the `supabase_realtime` publication** (added by 0058).

* Roster changes — add/remove a person, assign an area, an auto-link firing on someone's signup — **do** arrive live. `committee_roster` has no `committee_id` column, so a filtered subscription must use `committee_slug=eq.<slug>`, not `committee_id`.
* ⚠️ **`committee_join_requests` is not published, yet the web app subscribes to `postgres_changes` on it in three places** — `AdminCommittees`' badge-count channel, `useManagedCommittee(slug, {watch: "committee_join_requests"})` (which is what `AdminJoinRequests` rides), and `CommitteeChat`'s own `committee_id=eq.<cid>` channel that reloads a viewer's access state. All three can never fire: the queue only refreshes on mount, and a member's chat lock card never updates live after they request access. **Don't port a realtime subscription for join requests — refresh on `onAppear`/scene-active, or when the `committee_join_request` push arrives.**
* ⚠️ Newly added/renamed/archived **roles** don't arrive live either (`committee_areas` unpublished). Refetch after any taxonomy RPC returns, and on appear.
* `family_roster` changes don't arrive live.

Publishing any of these is a one-line migration — but realtime respects RLS, so an unapproved member gets nothing regardless.

---

#### 12. Swift shapes, and where the web idiom doesn't transfer

⚠️⚠️ **PostgREST embed ambiguity will silently return `[]`.** `committee_roster` has **two** FKs to `profiles` (`linked_user_id` and `updated_by` — confirmed in `pg_constraint`), and so does `family_roster`. A bare `.select("*, profiles(*)")` is ambiguous → PostgREST answers **HTTP 300 / PGRST201**, which reads exactly like "no data". **Always name the FK column**, as the web code does:

```
committee_roster:  id, name, email, phone, roles, position, linked_user_id, is_lead,
                   profiles:linked_user_id(display_name, avatar_url)
family_roster:     id, name, email, phone, house_id, position, linked_user_id,
                   profiles:linked_user_id(display_name, avatar_url)
```
This already bit the project once on `tournaments ↔ tournament_entrants`. Audit every embed you write here.

```swift
struct RosterRow: Decodable, Identifiable {
    let id: UUID
    let committeeSlug: String?          // absent unless you select it (web's select omits it)
    let name: String                    // NOT NULL
    let email: String?                  // nullable
    let phone: String?                  // nullable
    let roles: [String]                 // NOT NULL DEFAULT '{}' — decodeIfPresent ?? []
    let position: Int                   // NOT NULL
    let linkedUserId: UUID?             // nullable — the whole link story
    let isLead: Bool                    // NOT NULL DEFAULT false — decodeIfPresent ?? false
    let updatedAt: Date                 // timestamptz NOT NULL (select it if you want it)
    let profiles: LinkedProfile?        // nil when linkedUserId is nil
    struct LinkedProfile: Decodable { let displayName: String?; let avatarUrl: String? }
}

struct CommitteeRow: Decodable, Identifiable {
    let id: UUID; let slug: String; let name: String; let emoji: String
    let description: String             // NOT NULL DEFAULT ''
    let position: Int
    let archivedAt: Date?               // nil == live
}

struct CommitteeAreaRow: Decodable {
    let committeeSlug: String; let area: String
    let description: String             // NOT NULL DEFAULT ''
    let archivedAt: Date?
}

struct FamilyRosterRow: Decodable, Identifiable {
    let id: UUID; let name: String
    let email: String?; let phone: String?
    let houseId: UUID?; let position: Int
    let linkedUserId: UUID?
    let profiles: RosterRow.LinkedProfile?
}
```
`profiles.display_name` can be a non-nil **empty/whitespace** string — the web trims and falls back (`?.trim() || null`). Do the same or you'll render blank names.

**Web idioms that don't transfer:**
* Every committee surface uses a bespoke module-scope `Map` cache keyed `slug|viewer-email`, with elaborate rules about never seeding from storage in a `useState` initializer. That apparatus exists only because Next.js remounts these components on every tab navigation and a cache read during render breaks hydration. **SwiftUI has none of those constraints** — one `@Observable` service plus `.task` replaces all of it. Do keep the *security* property: **key any cached roster/permission state on the real signed-in user id and clear it on sign-out** — a shared cache key already leaked one member's cached private chat to the next user on web. (`useManagedCommittee`'s persisted key is `managedCommittee.<userId>.<slug>.<isAdmin>` for exactly this reason.)
* The `previewAsId` / "View as" read-only override (`effectiveUserId = previewAsId ?? userId`) is a web admin tool. Drop it if you don't ship it — but if you do, **every write must no-op while previewing**, and "is this mine?" must resolve through the effective id, never `auth.currentUser`.
* `mailto:` hand-off: web builds `mailto:?bcc=…` for "Email everyone" / "Email the leads" / per-role, resolving emails from the roster (linked profile wins). On iOS use `MFMailComposeViewController` — same recipient resolution, real compose UI, no URL-length cliff.
* ⚠️⚠️ **Do not use `committee_member_recipients(cid)` as a member list.** It returns `(id, name, email, roles text[])`, but it selects **`FROM committee_members`** — so the *recipient list itself*, not just the `roles` column, is limited to the 17 legacy rows: it returns **3 of Resort Maintenance's 28** rostered people and **14 of Family Fest's 21**. Anyone seeded straight into the roster is absent entirely, not merely role-less. Resolve recipients from `committee_roster` yourself (linked profile's `contact_email` first, roster `email` as fallback — the §3 precedence).

---

#### 13. ⚠️⚠️ SUSPECTED LIVE DEFECT — `leave_committee` may re-link you instantly

`leave_committee(cid)` does `UPDATE committee_roster SET linked_user_id = NULL, roles = '{}' WHERE linked_user_id = auth.uid()`. But `link_committee_roster_from_slot_trg` is `BEFORE INSERT OR **UPDATE OF email, linked_user_id**`, so this very UPDATE fires it, and its body is:

```sql
if new.linked_user_id is null and new.email is not null and length(trim(new.email)) > 0 then
  select p.id into match_id from public.profiles p
   where lower(trim(p.contact_email)) = lower(trim(new.email)) ... ;
  if match_id is not null then new.linked_user_id := match_id; end if;
```

If the roster row carries the leaver's own email — which it does whenever the link was made by email in the first place — the trigger **re-stamps `linked_user_id` back to them before the row is written**, so leaving revokes nothing. Consistent with live data: all 6 unlinked roster rows carry an email, and **none** of those 6 emails matches any account, i.e. there is no counter-example anywhere in the table.

I could not execute a write to prove it (read-only session), so: **verify with a single test leave before shipping a Leave button.** Either way the client rule already applies — **`MyCommitteeCard` calls the RPC and, on a nil error, immediately paints "You've left {committee}" without re-reading anything**, which would hide exactly this failure. After calling `leave_committee`, **re-read your roster row** and only show "you've left" if `linked_user_id` really came back nil; otherwise show an error. If real, the fix is backend (guard the UPDATE, or drop `linked_user_id` from the trigger's column list) — hand Brian the SQL.

---

#### 14. The family roster — account-less relatives as first-class records

`family_roster` (0123) is the **master list of family who aren't on the app yet**: 14 rows live, 12 unlinked. One row per person — `name` (a temporary admin-set display name), `email` (the join key), `phone`, optional `house_id`, `position`, `linked_user_id`. A partial `UNIQUE` index on `lower(email) WHERE email IS NOT NULL` means two rows can't claim one address (a second insert fails `23505`), while rows with **no email at all** are allowed (the index doesn't cover them — they simply can never auto-link).

Reads: `is_approved_member()`. Writes: **app admins only**. Surfaced at `/admin/members` → `AdminFamilyRoster`.

⚠️⚠️ **These two rosters are also the approval allow-list (migration 0182) — putting an email here is an approval decision.** `is_preregistered_email(p_email)` returns true when an email matches any `committee_roster` **or** `family_roster` row (trim/case-insensitive, the same claim key as 0056/0060), and the `auto_approve_preregistered` trigger — `BEFORE INSERT OR UPDATE OF contact_email ON profiles` — stamps `approved = true, approved_at = now()` (leaving `approved_by` NULL, since nobody tapped a button) whenever it fires. It's guarded on `approved_at is null` = "no human has decided yet", so it can never silently undo an admin's deliberate revoke. **12 roster emails currently have no account and will auto-approve the moment they sign up.** Two consequences for iOS: (a) still build the "waiting to be verified" state (§2), but expect most rostered family to *skip* it entirely — a rostered person signs in and immediately has full read access; (b) an admin adding an email to either roster is granting membership-level read access on future signup, so the roster editor's copy should say so. `is_preregistered_email` is revoked from `public` and **not granted to `authenticated`**, so a client cannot call it to probe whether an address is on the list.

**What signing up triggers, all at once, from one email match:**
1. `linked_user_id` stamped on every matching `family_roster` row **and** every matching `committee_roster` slot (two independent triggers, same signup).
2. The account is **auto-approved** if either roster carries that email (0182, above).
3. The admin's pre-assigned **house** is applied to `profiles.house_id` — only if the member has none yet, so it never overrides a later explicit assignment. Not an escalation: `house_id` is out of the client update allowlist entirely; the only writers are admins and `set_member_house`, so this is the admin's earlier decision taking effect.
4. The temp **name** seeds `profiles.display_name`, but only when the member's own is blank or equal to their raw email prefix. Family roster wins; a committee-roster name is the fallback. They can rename any time after.

**One person, one record (0125).** Two triggers keep the rosters from drifting:
* `family_from_committee_roster()` — `AFTER INSERT OR UPDATE OF email, linked_user_id ON committee_roster`: adding an email'd, **account-less** person to *any* committee also puts them on the family roster if not already there. So "add someone not in the app yet" from a committee page makes them manageable (house, phone, name, invite) in one place.
* `sync_committee_roster_from_family()` — `AFTER UPDATE OF name, email, phone ON family_roster`: editing them on the family roster cascades to their account-less committee slots, matched by the **old** email. Early-returns if the old email was empty or if nothing relevant changed, and **keeps the slot's old name if the new one would collide** with `(committee_slug, name)`. An email change re-resolves the account link on the committee side via 0060's BEFORE trigger.
* Deleting a family-roster row **never** touches committee slots or real accounts. Both cascades are INSERT/UPDATE-only, never DELETE.

**Where these emails flow** (account-less people only, `linked_user_id IS NULL`): `directory_recipients()` and `all_member_recipients()` (resort-wide "Email members" pools, UNION'd with the roster); `house_member_recipients(hid uuid)` ("Email the house": account members ∪ roster people assigned to that house, so nobody falls between "not on the app", "signed up but unassigned" and "full member"); `meeting_proposal_email(p_meeting uuid)` / `meeting_confirmed_email(p_meeting uuid)` (`service_role` only).

⚠️ **`all_member_recipients()` is gated on the legacy table, and 0184 did not repoint it.** Its live gate is `profiles.is_admin OR EXISTS(committee_members WHERE user_id = auth.uid())` — *not* `is_approved_member()`. Since only 17 of 49 rostered people have a `committee_members` row, an approved, roster-linked, non-admin member gets an **empty** "Everyone" pool. Not a leak (an unapproved signup has neither, so it correctly returns nothing) but a live functional hole, and the §1 roster-vs-members divergence surfacing in a user-facing feature. `directory_recipients()` is the pool that actually works for a plain member.

⚠️ **0184 is the security lesson here.** 0183 swapped 29 RLS *policies* to `is_approved_member()` but contained **no function statements** — and a `SECURITY DEFINER` function bypasses RLS by design. So `directory_recipients()` and `admin_recipients()` kept their old `auth.uid() is not null` check, and any brand-new throwaway signup could call them over the public REST RPC endpoint and get **the whole family email directory (68 people = 56 members + the 12 who never made an account) plus a list of all 7 admins**. Direct table reads were correctly denied the whole time — that's 0183 working. Note `admin_recipients()`' two clauses are different questions: `public.is_approved_member()` governs the **caller**, `and p.is_admin` is the **row filter** — an approved member is *supposed* to be able to email the admins. **Takeaway for iOS: tightening a table's RLS does nothing for the DEFINER functions that read it.** If you add any RPC in this area, put the predicate *inside* the body, and re-run 0184's `pg_proc` audit query afterward.

⚠️ Both roster tables' `is_approved_member()` gate also means an **unverified** iOS account gets an empty family roster and an empty committee roster. Show the verification state, not an empty list.

**Admin UI to mirror** (`AdminFamilyRoster.tsx`): add a person (name required, email validated, optional phone, house chips); per unlinked person — Invite (`inviteByEmailLink`, the branded one-tap sign-in email), Edit, Remove, house chips, and a read-only "On committees (until they join)" chip row from `fetchRosterCommittees()`; "💌 Invite all (N)" for everyone with an email and no account; a linked person collapses to "✓ On the app" + a tap-through to their `MemberSheet`. The Remove confirm must say it only removes the placeholder and never touches a real account.

---

#### Where iOS can beat the web app

* **Contacts + `CNContactPickerViewController` for adding a roster person.** Web makes an admin hand-type name, email and phone for 12 relatives. On iOS: pick from the address book, and the email — the *one* field that makes auto-linking (and auto-approval, §14) work — is filled correctly with no typos. Typo'd emails are the entire failure mode of the linking design (`.placeholder` rows never auto-link).
* **A real required-area join picker.** Web's only live join path (`CommitteeChat`'s lock card, §7) sends `requested_areas = '{}'` with a canned message, so every request arrives with nothing asked for and the lead has to guess. A picker over `committee_areas` on the request sheet is a genuine improvement, not parity — just keep the ≥1 rule client-side, since the RPC accepts `[]` on purpose for other callers.
* **`CNContact` write-back for a linked member.** Tapping a roster row offers "Add to Contacts" with name, photo, phone and email — the family's roster becomes the family's phone book. No browser equivalent.
* **Native contact actions with haptics:** `tel:`/`sms:`/`mailto:` become real Call/Message/Mail swipe actions, and `MFMailComposeViewController` replaces the `mailto:?bcc=` URL that mail apps truncate past ~50 recipients (web literally warns at `MAILTO_WARN_COUNT = 50`).
* **Actionable notifications.** `committee_join_request` already targets the *request id* (0061 retargeted the notification entity from the committee to the request precisely so APNs could carry an inline Approve). Ship a `UNNotificationCategory` with **Approve / Reject** calling `review_join_request(req_id:approve:)` from the lock screen. (Respect §9: it fails for a non-lead admin — surface the error, don't dismiss silently.)
* **Offline roster.** 49 rows, rarely changes, and it's what people look up *at the lake* where signal is worst. Cache in SwiftData and render fully offline with a staleness stamp. Web's `localStorage` caches are capped at 200 KB per entry and cleared on sign-out.
* **Widget + Shortcuts:** a "My committees & roles" widget, and a Siri Shortcut for "who leads Meals & Head Chefs" — genuinely useful during fest week.
* **Dark mode.** Web is light-only by hard rule, so every surface here needs a dark treatment with **no reference to copy**. Budget for it; don't discover it at review.

---

#### Size, and a v1 cut

Honest total: **large** — roughly 2–3 weeks for full parity across all 14 items, of which the admin taxonomy editor and the roster editor are most of the work.

**v1 (~1 week):** read paths + self-service. Committee list with subcommittee chips and live roster counts; committee detail grouped by area — **empty areas included ("Nobody on this one yet") AND a final "On the committee" group for anyone whose `roles` is empty**, which is where Resort Maintenance's role-less people and any committee-level lead with no area appear (drop that group and they vanish from the page); role **descriptions** under each heading (0179); the linked/Pending/placeholder states with correct contact precedence; `MyCommitteeCard` self-service (edit my areas, step down as area lead, leave — with the §13 verification); the Leads-chat entry tile; request-to-join (web's only live path is the chat lock card).

**v1 can omit:** the admin taxonomy editor (create/rename/archive/restore/delete committees and roles, descriptions) — 2 committees and 7 areas change a few times a year and an admin can use the web app; the family-roster admin screen and Invite/Invite-all; the archived-chats disclosure; the by-role email pools. Keep **reading** `committee_areas` from the DB from day one regardless — that is not optional (§10).

**Verify in the iOS repo** (not on this machine, so none of this is asserted): whether the existing roster reads `committee_roster` or the legacy `committee_members`; whether `is_lead` (0177) is decoded at all; whether the `" · Lead"` comparison is a raw string compare (the silent-data-loss bug); whether `committee_areas` is read from the DB or a hardcoded `FAMILY_FEST_AREAS`-style constant (and whether it still says `"Meals"`); whether `archived_at` is decoded on committees and areas; whether area **descriptions** (0179) are read; whether any embed uses a bare `profiles(...)` on `committee_roster`/`family_roster`; **whether any `set_area_mute` call omits `p_muted_until` (it will 300/PGRST203 — §5) and whether `muted_until` expiry is evaluated client-side**; whether the roster cache is keyed on the real user id; whether the join-request approve path exists and how it handles a `Not authorized` throw; whether the "waiting to be verified" state accounts for pre-registered auto-approval (§14); and whether `docs/ios-committee-taxonomy-parity.md` was ever implemented — that handoff doc is written against 0112 and mentions none of 0170, 0172, 0177, 0178 or 0179 (no reference to `is_lead` anywhere in it), so treat it as a starting point, not current truth.
