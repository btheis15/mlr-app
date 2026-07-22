# iOS parity catch-up — July 2026

Handoff spec for bringing the native SwiftUI app (`mlr-app-ios`) up to the web
app's current feature set. This is the **delta since the iOS app's last sync**
(2026-07-18 — committee taxonomy + emoji usernames) through web **PR #362**.

> **One backend, two clients.** Every RPC and table below is **already live** on
> the shared Supabase project — the web app calls these exact signatures. iOS
> just calls the same RPCs and renders the same states. **No new iOS SQL, no new
> migrations.** The machine-readable work-list (statuses, RPC signatures, target
> files, acceptance tests per item) is the companion
> [`ios-parity-2026-07.json`](ios-parity-2026-07.json) — that's the source of
> truth an agent should iterate over; this doc is the readable overview.

Backend delta behind all of this: migrations **0114 → 0128** (15 new since the
0108/0113 the last iOS plan referenced).

## What's already done — do NOT rebuild

The prior `IOS_PARITY_PLAN.md` workstreams **A–F all landed** (verified in the
current Swift source): design foundation + bundled Cinzel/Yellowtail fonts, Fest
visual redesign, full cabins parity (`set_booking_rooms`, `PickMyRoomSheet`,
`AdminCabinDetails`, book-on-behalf, email toggles), broadcasts + reminders
(`ScheduleSendPicker`, `ReminderScheduler`, `AdminScheduledBroadcasts`),
`OnThisDayCard` + post-reaction who-reacted, and committee self-service
(`set_my_committee_areas`, `leave_committee`, `AdminMembersView`, `PreviewAsView`).

Also already present from this delta:

- **Tap a member's name → profile** (#334) — `AdminMembersView` already does it.
- **Event-targeted email/push honor "not going"** (#342) — iOS already collects
  the event target (`EventTargetPicker`) and passes `p_exclude_not_attending`;
  the honoring is mac-mini side. *(Note: `alert_recipients()` dropped its old
  1-arg overload — call the widened signature.)*
- **`request_cabin_stay` dedupe** (#322) — just use the canonical 8-arg signature.

## What to skip — web-only

Not applicable to a native app: GitHub-Pages/Vercel build plumbing (#319/#320),
the desktop Lodge-Sidebar layout (#329/#330, reverted anyway), PWA chunk-load
recovery (#331), an `&nbsp;` copy fix (#337), and the mobile chat-open flicker /
hydration-caching fixes (#354/#355/#357/#358/#360). The Local Places
"two-tap-to-open" fix (half of #351) is a Safari `<details>` quirk — a native
`DisclosureGroup` already opens on first tap.

---

## The work — 8 workstreams (suggested order)

### WS1 · Meeting scheduler — **P0, biggest, entirely missing** · PRs #323–#328

A Doodle/when2meet-style scheduler pinned to any committee/area or house chat
room, plus a **family-wide** scope. Organizer proposes candidate slots; members
mark **Yes / If-need-be / No** per slot; organizer picks the winner and either
pastes a **Google Meet** link (posts a join message + notifies the room) or
**creates a real calendar Event** from it.

- **Tables** (0116/0122): `meetings`, `meeting_slots` (+ `ends_at` date ranges),
  `meeting_availability` (PK `(slot_id,user_id)`). `events` gains
  `source='meeting'` + `source_meeting_id`; `event_attendance.confirmed`.
- **RPCs:** `create_meeting`, `create_scheduled_meeting`, `set_my_availability`,
  `finalize_meeting`, `finalize_meeting_as_event`, `cancel_meeting`,
  `delete_meeting`, `can_organize_meeting` (gate — UI must ask it too),
  `set_event_attendance` (now stamps `confirmed=true` on any self-write).
- **Gating:** admin (any room) **or** a committee/area **Lead** (`committee_roster`
  role ending `· Lead`). Houses + family scope = admin-only.
- **Google Meet = guided in-app, one paste, no OAuth.** "Create Google Meet"
  opens a prefilled Google Calendar event; organizer pastes the link back. A
  linkless finalize is allowed (add the link later via the response bar).
- **Two create modes** (`MeetingComposer` toggle): *Find a time* (vote) vs *Set a
  time now* (no voting → `create_scheduled_meeting`, immediately finalized).
  Plus a *Times* vs *Dates* toggle (date-range slots, defaults Dates for family).
- **Family scope** (#328): admin-only poll open to every member, entered from
  **Events → "📅 Propose dates"**; active poll shows as a card near the top of
  Events. "Create an event" finalize carries Yes/If-need-be voters over as
  **unconfirmed** RSVPs (`EventSheet` shows "(hasn't confirmed)"; re-tapping
  Going/Maybe/Can't reconfirms) and auto-queues a 14-day "still coming?" reminder
  (`payload.onlyUnconfirmed`).
- **Area targeting** (#327): on a committee page, target a single role/area
  sub-channel (NULL area = committee-wide General).
- **Notifications:** `meeting_proposed` / `meeting_scheduled` → every room member;
  new "Meetings" section in `NotifPrefs` (default on) + `PushToggle` rows.
- **Emails** (mac-mini side-effects — iOS surfaces the checkbox only): optional
  proposal email ("Also email everyone a link to vote", default OFF); automatic
  confirmation email on a finalize with a Meet link.
- **Surfaces:** create lives in the room **⋯ menu** ("📅 Schedule a meeting",
  organizer-gated); `MeetingSection` is the active-meeting **response bar** pinned
  atop the chat body; also embedded on `CommitteeDetailView` and `EventsView`.
  *(Add a ⋯ header button to `HouseChatView` — houses didn't have one.)*
- **New Swift:** `MeetingsService`, `Models/Meeting`, `MeetingComposer`,
  `MeetingSchedulerSheet`, `MeetingSectionBar`. **Edit:** both chat views,
  `CommitteeDetailView`, `EventsView`/`EventsService`/`EventComposer`,
  `NotifPrefsView`, `PushToggleView`, `ReminderScheduler`.

### WS5 · Chat parity — **P1** · PRs #348, #349, #361, #344 (+ commit `4b0dce7`)

iOS chat already has reactions/who-reacted, mentions, and 24h edit + soft-delete.
Missing:

- **Optimistic send** (#348): insert a `temp-<ts>` bubble instantly (with pending
  media), clear the composer, upload+insert, refetch and drop the temp bubble;
  **restore the full draft on failure** (text, media, mentions, reply-to).
- **Typing indicators** (#361): "X is typing…" row above the composer, on its
  **own** Realtime broadcast channel `typing:<roomKey>` (separate from the message
  subscription). Throttled per keystroke, self-clears ~4.5s after the last one.
  Ephemeral — no table/RPC.
- **Smart auto-scroll + jump pill** (commit `4b0dce7`): jump to bottom on first
  open; smooth-follow only when already at bottom; a tappable "↓ New messages"
  pill when scrolled up; your own sends always pin to bottom. *(iOS currently
  always auto-scrolls with no pill.)*
- **Chat moderation** (#344): add `status` (visible|pending|hidden) to
  `committee_messages`/`house_messages`; a held message must **silently disappear**
  from the room on refetch (RLS shows non-visible rows only to author + admins;
  the mini holds flagged media retroactively a few seconds after the optimistic
  post). Add **Report** to the chat bubble menu (`report_content`); include held
  chat in the admin queue (`moderation_queue`) + Approve/Remove
  (`set_content_status` with `committee_message`/`house_message`).
- **Home → House Chat tunnel** (#349): a dedicated "Chat" button on the Home
  house card that deep-links straight into the room (keep the body → House Hub).

### WS2 · Places to stay — **P1, partial** · PRs #321, #326

iOS can edit existing cabins/rooms but can't **add a place**, has **no per-place
approver**, and **no guest messaging**.

- `create_cabin(p_name,p_kind,p_room_count,p_bed_count,p_notes,p_approver_user_id)`
  (0114) — admin adds a place (`kind` cabin|house is a display badge only).
- **`approver_user_id`** — a specific member (need **not** be an app admin) who
  reviews that place's requests. `is_cabin_approver(cabin)` widens the write gate
  on review/cancel/admin_update/set_booking_rooms **and** the read RLS. A
  non-admin approver sees a self-hiding **"Requests to approve"** section (iOS
  equivalent of web mounting `AdminCabinBookings` for non-admins).
- **Message guests** (#326, 0120): `send_cabin_message(p_cabin,p_subject,p_body,
  p_email)` → everyone with an approved booking not yet ended (`check_out >=
  today`). New `cabin_message` notif kind (+ PushType); optional email via mini.
- **Edit:** `CabinService` (+`createCabin`/`isCabinApprover`/`sendCabinMessage`/
  `fetchManageableCabins`; add `kind`+`approver_user_id` to the model),
  `AdminCabinDetails` ("＋ Add a place" + approver picker), `AdminCabinBookings`
  ("📣 Message guests" + `canManage` = admin **or** approver), `CabinRequestSheet`
  (kind badge). **New:** `CabinMessageSheet`.

### WS3 · Family roster + email pools + email-from-chat — **P1, partial** · PRs #332, #333, #335, #336, #338

- **Family roster** (0123): `family_roster` — people **not on the app yet** (name,
  email [unique lc], phone, house_id). Email is the join key: verifying with a
  matching email auto-links the account. Managed under **Admin → Members**.
  Enables emailing a whole house (incl. not-yet-signed-up people) via
  `house_member_recipients(hid)`. Triggers keep the committee + family rosters +
  accounts in sync (backend only).
- **Widened email pools** (0124): the People composer gains **House**, **App
  Admins** (`admin_recipients()`), and **By-Role** pools (roles now ride on
  `committee_member_recipients`). iOS today is committee-scoped only.
- **Email from chat** (#338): an "✉️ Email members" button in every chat ⋯ menu,
  open to **anyone** in the room, pre-scoped (committee General = whole roster,
  area = that area, house = the house). Emailing is a native-mail hand-off.
- **New Swift:** `FamilyRosterService`, `Models/FamilyRosterEntry`,
  `AdminFamilyRosterView`, `EmailMembersView` (generalize `CommitteeEmailComposer`).
  **Edit:** `AdminMembersView`, both chat views (⋯ menu), `CommitteeService`.

### WS4 · Unified broadcast composer — **P2, partial** · PRs #341, #343

iOS has two composers (banner + push) each with a mirror toggle. Web merged them
into **one** `AdminBroadcastComposer` with 3 independent channel checkboxes —
**📣 Banner / 🔔 Activity tab / ✉️ Email** (≥1 required). New:
`announcements.show_banner` (0126) lets a send **email opted-in members without
painting a banner** (and the mini skips the phone push then). Wire the same two
primitives into a Home callout's "Also send a notification" / "Also email
everyone" (default off each open). Also tuck **already-sent** scheduled broadcasts
into a collapsed disclosure below the pending list (#343 — iOS shows them in a
plain always-visible section today).

### WS6 · Family Fest Dinners — weekly-menu list — **P2, partial** · PR #318

Convert `FestDinnersView` from click-through `NavigationLink` rows to a flat
**weekly-menu list**: day · serving time · menu · head chef · houses on crew, all
shown at once, no tap-to-expand, no detail push. Omit crew-prep time/location
(crew-only). Keep the Edit button + chef/crew self-edit (already on iOS). Remove
the redundant "Schedule" sub-nav pill (Overview already shows the full week).

### WS7 · Home & House Hub IA — **P2, partial** · PRs #339, #351, #356, #359

- **Admin Dashboard card on Home** (#339) — admin-only, below the House Hub card,
  jumps to the admin dashboard; self-hides for non-admins + in "View as".
- **Admin "Alerts" quick-link** (#351) — a secondary button to the broadcast
  composer. *(The Local Places half of #351 is web-only.)*
- **House Hub grouped sections** (#356→#359) — regroup `HouseHubView` into
  **Communication / Calendar / Rules** with Calendar + House chat as a 2-up tile
  grid. Port the #359 end-state.
- (#353 equalize Home button sizes — trivial, P3.)

### WS8 · Native motion analogs — **P3, polish (optional)** · PRs #346, #347, #350, #352

Native equivalents of the web's framer-motion delight (some overlap the prior
plan's Workstream H): P3/HDR accent color (`Color(.displayP3,…)`), TabBar
active-icon spring, animated numbers (`.contentTransition(.numericText())`),
confetti on RSVP "going", gliding segmented pill (`matchedGeometryEffect`), chat
message spring-in, reaction-tray pop. **All must honor Reduce Motion.** Do this
last, after the functional workstreams.

---

## Notes

- **Suggested order:** WS1 → WS5 → WS2 → WS3 → WS4 → WS6 → WS7 → WS8. All backend
  is already live, so port in whatever order the team prefers.
- One branch per workstream on `btheis15/mlr-app-ios`; draft PR after the first
  substantive push; keep `IOS_PARITY_PLAN.md` / `IOS_COMPAT.md` current as
  features land. Build in Xcode (⌘B), verify **light AND dark** on every new
  surface, watch for new files missing target membership.
- The web `CLAUDE.md` sections **"Meeting scheduling"**, **"Places to stay"**,
  **"Reach everyone"**, **"Family roster"**, and **"Content safeguards"** are the
  authoritative behavior references — read them alongside this doc.
