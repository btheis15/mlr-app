<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ⚠️ **NOT fact-checked.** The verification pass for this section did not run (session limit). Treat every table/column/RPC name as needing confirmation before you build against it.

### Admin surfaces

⚠️⚠️ **This section is HAND-WRITTEN, not agent-generated and NOT fact-checked.** Its
drafting agent failed three times to transient server errors and further retries weren't
worth the cost. Every other area in this set had every table, column and RPC verified
against the SQL by a second pass — **this one did not.** Confirm names against
`app/admin/` and the migrations before building. It is deliberately a map, not a build
spec.

**The honest recommendation: do NOT port all of this.** The owner wants every
*member-facing* feature on iOS, but admin tooling splits cleanly, and treating it as one
block would burn days on screens nobody opens on a phone.

#### Port to iOS — things done while standing in a field at the lake

| Surface | Route · component | Why it belongs on a phone |
|---|---|---|
| **Members + verify** | `/admin/members` · `AdminMembers.tsx` | Approving a new relative is time-sensitive — they're locked out of everything until you do. `set_member_approved(p_user, p_value)`. |
| **Cabin requests** | `/admin/cabins` · `AdminCabinBookings.tsx` | Approve/deny a stay from anywhere. ⚠️ A non-admin *approver* sees this queue on `/request-stay`, not the admin route — the component computes its own `canManage`. |
| **Content review** | `/admin/content-review` · `AdminModeration.tsx` | A held family photo should be cleared in minutes. `moderation_queue()` / `set_content_status(...)`. |
| **Alerts / broadcast** | `/admin/alerts` · `AdminBroadcastComposer.tsx` | "Dinner's ready" during fest week. Three independent channels: banner, Activity tab, email. |
| **Notification test** | `/admin/notification-test` · `NotificationTestView.tsx` | Answers "I'm not getting notifications" while standing next to the person. |

#### Leave on the web — desk work

`/admin/committees` (bulk taxonomy), `/admin/houses`, the scheduled-broadcast queue,
`/admin/signins` (audit log), `/admin/help-contact`, `/admin/preview` (view-as), and
`/admin/system` (owner-only media-server restart). All rare, all fiddly, all better with
a keyboard. A single row linking out to the web app is a perfectly good iOS "admin" tab.

#### Things that will bite you

⚠️ **`profiles.is_admin` is UI-ONLY — RLS is the real gate.** Never make an authorization
decision from it beyond hiding chrome; the server re-checks everything. A stale cached
admin flag painting admin UI the server won't honor is harmless. The inverse — hiding a
control from a real admin — is the only actual bug.

⚠️ **The Media server card is gated by VERIFIED EMAIL, not the admin flag**
(`lib/owner.ts` `OWNER_EMAIL`). The mini re-enforces it in its own `requireOwner`
middleware from the GoTrue-verified email, regardless of what any client shows. Do not
reimplement it as an `is_admin` check — that would widen it to every admin.

⚠️ **Admin-gated notification preferences must stay hidden from non-admins.** Some
`notif_types` (cabin requests, committee join requests) only make sense for admins;
`NotifPrefs` is a hand-authored row list, not derived from the type union, so it's easy
to leak them into a member's settings screen.

⚠️ **Editing another member's profile needs a two-admin unlock window** (migration 0025,
`admin_override_status`). It expires, so the affordance appears and disappears on its own
— poll it rather than caching the answer for the session.

