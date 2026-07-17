# iOS parity — admin-managed committees & roles

Handoff spec for bringing the **admin committee taxonomy** feature (web PR #310,
migration `0112_admin_committee_taxonomy.sql`) to the native SwiftUI app
(`mlr-app-ios`). The backend is already live and shared, so this is a
**UI + service** job only — no new SQL, no schema work on the iOS side.

> One backend, two clients. Everything below already works against the shared
> Supabase project; the web app calls these exact RPCs. iOS just needs to call
> the same RPCs and render the same states. Mirror the pattern already used for
> Houses admin (`HousesService` + `AdminHousesView`), which is the closest
> precedent.

## What the feature is

App admins can now manage the committee **taxonomy**, not just membership:

1. **Create / rename / "delete" committees.**
2. **Add / rename / "delete" the roles** inside a committee. A role is an
   **"area"** — and each area is its own chat channel (migration 0063), so a new
   role automatically becomes a new channel once someone holds it.
3. **"Delete" = archive, never destroy.** Archiving hides the committee/role from
   the live app and makes its chat **read-only**, but keeps the roster intact so
   **Restore** brings it fully back. Archived chats stay reachable, read-only,
   under an "Archived chats" section.

Adding/removing *people* and assigning roles already existed — don't rebuild that.

## Backend surface (already live — call these)

### New columns
- `committees.archived_at timestamptz` (+ `archived_by uuid`)
- `committee_areas.archived_at timestamptz` (+ `archived_by uuid`)

A committee/role is **live** when `archived_at IS NULL`, **archived** otherwise.
Decode these when reading the tables. (Handle their absence gracefully only if
you support a pre-0112 DB — the shared project already has them.)

### Admin-only RPCs (all gated on `profiles.is_admin`; call via `supabase.rpc`)

| RPC | Params | Returns | Purpose |
|---|---|---|---|
| `create_committee` | `p_name text, p_emoji text, p_description text` | the new `committees` row | Create; auto-generates a unique slug |
| `update_committee` | `cid uuid, p_name text, p_emoji text, p_description text, p_position int` | void | Edit display fields. **Slug never changes** |
| `archive_committee` | `cid uuid` | void | "Delete" (archive) |
| `restore_committee` | `cid uuid` | void | Un-archive |
| `add_committee_area` | `cid uuid, p_area text` | void | New role/channel (re-adds an archived name → un-archives it) |
| `rename_committee_area` | `cid uuid, p_old text, p_new text` | void | Rename a role **and its whole chat history** |
| `archive_committee_area` | `cid uuid, p_area text` | void | "Delete" a role (archive) |
| `restore_committee_area` | `cid uuid, p_area text` | void | Un-archive a role |

Notes:
- **Slug is immutable.** `committee_roster` / `committee_areas` key off the slug,
  so `update_committee` edits name/emoji/description only. Don't expose a slug
  editor.
- **`rename_committee_area` is not a table edit** — it cascades the name through
  six tables server-side (allow-list, `committee_roster.roles[]`,
  `committee_members.areas[]`, `committee_messages.area`,
  `committee_area_reads.area`, `committee_join_requests.requested_areas[]`) in one
  transaction. Just call the RPC; never rename an area by writing a table.
- Role-name validation (server-side): rejects empty, `general`/`General`
  (reserved for the committee-wide channel), and anything ending in ` · Lead`.
  Surface the thrown error message inline.

### RLS behavior to reflect in the UI
- **Reads of an archived committee/role still work** for people who were in it
  (and admins) — that's what makes the archived chat readable.
- **Inserts into an archived chat are blocked** by RLS
  (`is_committee_area_archived`). So an archived room must render **read-only** —
  don't show a composer; a post attempt would fail anyway.

## Source of truth for "what roles exist"

`committee_areas` is now the single source of truth. On web this replaced a
hardcoded `FAMILY_FEST_AREAS` constant. On iOS:

- Fetch a committee's roles from `committee_areas` (filter `archived_at IS NULL`
  for the live set), **not** from any hardcoded list and not by scraping the
  roster's current `roles[]`.
- Use that live set for: the roster's group-by-area layout, the join/area picker,
  and the admin roster editor's role checkboxes.
- Keep any in-code Family Fest area list only as an offline/first-paint fallback.

## iOS work — build these

Mirror the web components (named in parentheses) as SwiftUI equivalents.

### 1. Service layer (`CommitteesService`, or extend the existing one)
- `fetchCommittees()` → `[Committee]` with `archivedAt` decoded, ordered by
  `position`. (web: `lib/committeeAdmin.ts` `fetchCommittees`)
- `fetchCommitteeAreas(slug:includeArchived:)` → `[CommitteeArea]`
  (`area`, `archivedAt`). (web: `fetchCommitteeAreas`)
- Thin `rpc(...)` wrappers for the eight RPCs above.

### 2. Admin editor (web: `AdminCommittees.tsx`) — in the iOS Admin area
- **New committee** form: emoji + name + description → `create_committee`.
- Per live committee (expandable): edit details (`update_committee`); a **Roles**
  manager to add (`add_committee_area`), rename (`rename_committee_area`), and
  archive (`archive_committee_area`) roles, plus a small **Archived roles** list
  with Restore (`restore_committee_area`); the existing join-request queue +
  member controls; and a **Delete committee** action (`archive_committee`) with a
  confirm making clear it archives + is restorable.
- **Archived committees** section at the bottom with **Restore**
  (`restore_committee`). Copy: history stays under "Archived chats"; restore
  brings it back roster and all.
- Confirm-dialog copy should say *archive / restorable*, not *permanently
  delete*.

### 3. Committee list + detail (web: `CommitteeList`, `CommitteeDetail`)
- List committees from the DB (live only), so admin-created ones appear and
  archived ones drop out.
- Detail = header (emoji/name/description) + chat entry + roster; if the
  committee is archived, show an "Archived — read-only" note.

### 4. Roster + join (web: `CommitteeRoster`, `CommitteeJoin`, `CommitteeMembers`)
- Group by / offer the DB `committee_areas` live set (see "source of truth").
- Keep areas people still hold that aren't in the live set (e.g. archived
  out from under them) so nobody drops off the roster silently.

### 5. Archived chats (web: `FeedView` `ArchivedChatsLine` → `CommitteeChat readOnly`)
- In the chats list, split channels into **live** vs **archived**: a channel is
  archived if its committee is archived **or** its role (`committee_areas` row)
  is archived. Build the archived set from `committees.archived_at` +
  `committee_areas.archived_at`.
- Show a quiet, collapsed **"Archived chats"** disclosure at the foot of the list.
- Opening an archived chat renders the message history **read-only** — no
  composer, a small "This chat is archived" note instead.
- Keep the archived chats reachable even if a member has *only* archived chats.

## Acceptance walkthrough (the requester's Family Fest scenario)
1. Admin creates a role in Family Fest → it appears as a joinable area and a new
   channel once someone's on it.
2. Admin puts people on the role via the roster → they get the channel.
3. Admin renames the role → the channel + its history keep going under the new
   name; members' roles update.
4. Admin "deletes" the role → its chat goes read-only and moves to "Archived
   chats"; people no longer see it as a current role but can still read it.
5. Admin restores it → live again, roster intact.
6. Same create/rename/delete/restore lifecycle works for a whole committee.

## Reference (web implementation)
- SQL: `supabase/migrations/0112_admin_committee_taxonomy.sql`
- Service seam: `lib/committeeAdmin.ts`, `lib/committeeParams.ts`
- UI: `components/AdminCommittees.tsx`, `components/CommitteeDetail.tsx`,
  `components/CommitteeChatRoute.tsx`, `components/CommitteeList.tsx`,
  `components/CommitteeRoster.tsx`, `components/CommitteeJoin.tsx`,
  `components/CommitteeMembers.tsx`, `components/FeedView.tsx`
  (`ArchivedChatsLine`), `components/CommitteeChat.tsx` (`readOnly`)
- Docs: CLAUDE.md → **Committees & account linking** (admin taxonomy paragraphs)
