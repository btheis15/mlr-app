# iOS parity — 2026-08-19 addendum

**Read this alongside the 2026-08 round, not instead of it.** That set
([`ios-parity-2026-08.md`](ios-parity-2026-08.md) + the 18 area docs in
[`ios-parity-2026-08/`](ios-parity-2026-08/) + the 407-item
[`DELTA`](ios-parity-2026-08-DELTA.md)) is still the standing spec and still
describes ~90% of the app correctly. This addendum covers only what the web app
gained *after* it was written, plus the places where it is now **wrong**.

| | |
|---|---|
| **Standing spec covers** | web `main` through **PR #539** / migration **0184** |
| **This addendum covers** | **42 merged PRs (#540–#581)** and **25 migrations (0185–0209)** |
| **Web source** | `btheis15/mlr-app` @ `origin/main` |
| **iOS target** | `btheis15/mlr-app-ios` |
| **Machine-readable** | [`ios-parity-2026-08-19.json`](ios-parity-2026-08-19.json) |

Product direction is unchanged from the 2026-08 round: **iOS is the flagship,
parity is the floor**. Everything below is Swift against schema that already
exists — with **one exception that needs SQL run first** (0209, see WS-N1).

---

## ✅ AUDITED against the real iOS source (2026-08-19)

The standing round's statuses were **inferred from `CLAUDE.md`**, not read from the
iOS repo — its own caveats said so. `btheis15/mlr-app-ios` @ `7a6795f` has now been
read directly (231 Swift files). Three things change as a result.

### 1. All five "true blockers" are DONE. Ignore that list.
Every one is implemented, including the big one — **signed media reads**
(`MLRApp/Services/MediaTokenService.swift`, 166 lines, commit `9c0dfb4` *"Sign
media-server URLs so photos load once MEDIA_AUTH enforcement turns on"*). It has
the two properties the spec insisted on: **host-based** matching (not a string
prefix) and a **refresh on every app open** (`ensure(force:)`), so a signing-key
rotation self-heals. Pending-approval gating, APNs registration, chat-media
signing and cache-clearing on sign-out are all present too.
→ **This means `MEDIA_AUTH` may be promotable from `report` to `on`.** Verify
first with the mini's WOULD-BLOCK log per
[`ios-parity-2026-08-PROMPT.md`](ios-parity-2026-08-PROMPT.md) — exercise photos
**and a scrubbed video** (Range requests are a separate failure mode), then check
for zero iOS user-agent hits.

### 2. iOS already has most of what the standing round called missing.
Real implementations, not stubs: `DropBoxesService` (201), `TournamentsService`
(269), `MeetingsService` (495), `ChatPollsService` (148), `PrivateActivitiesService`
(123), `FamilyRosterService` (183), `WorkItemsService` (377), `EventsService` (409).
**Treat that round's ADD items as AUDIT items** until each is checked. iOS work
landed right after those docs were generated, which is why they read as stale.

### 3. ⚠️⚠️ Two live bugs on the phones, found by this audit
Neither doc knew about either.

**a. The compiled-in fest window is WRONG, and it's what drives the season.**
`FamilyFestConfig` (`MLRApp/Shared/Utilities/FestSeason.swift`) hardcodes
`startDate = "2026-07-27"`, `endDate = "2026-07-31"`. The database says
**2026-07-26 → 2026-08-01**. `FestSeason.current()` computes from the hardcoded
pair, and **seven surfaces** consume it (`HomeView`, `FestOverviewView`,
`FestStatus`, `FestDuesCalculator`, `MjtHouseDuesView`, `RootView`, the widget and
the Siri intent). Consequences already realised: during the week iOS showed
**"Day n of 5"** instead of *of 7*, and on **Aug 1 — the actual final day** — iOS
had already flipped to "wrap". Fixing this is the same job as correction **C2**:
resolve the window from `fest_config`, don't compile it in.

**b. The widget and Siri say Family Fest "starts today" — right now.**
iOS clamps `daysUntilStart` to `max(0, …)` (FestSeason.swift:93), and the
off-season branch treats `0` as *starting today*. With the fest three weeks past,
`FamilyFestCountdownWidget` renders **"Today!" / "See you there"** and
`FestCountdownIntent` speaks **"Family Fest starts today!"**.
⚠️ **This is the exact same clamp-to-zero-reads-as-happening-now bug the web had**
— there, zero meant *"the moment has arrived"* and produced "🎉 Family Fest is on".
iOS's in-app cards are fine (a real `OffSeasonCard`, no false "it's on"), so this
hides on the home screen and in Siri rather than in the app. The **`concluded`
phase (C1) is the fix**, which makes C1 a live-bug fix on iOS, not a tidy-up.

---

## ⚠️ FIRST: three corrections to the standing spec

These aren't new features. They're places where building from the existing area
docs would reproduce a bug the web app has already fixed.

### C1 — The Family Fest season has FIVE phases, and `fest_config` is many rows
**Supersedes parts of [`13-family-fest.md`](ios-parity-2026-08/13-family-fest.md).**
That doc has a warning block at the top now; this is the same information.

- A fifth phase **`concluded`** was added to `lib/festSeason.ts` (past
  `WRAP_TAIL_DAYS`). Previously `off-season` meant *both* "the fest is still
  ahead" and "the fest is over", so a finished fest fell into the branch that
  renders a countdown to its own start date — which clamps at zero and reads
  **"🎉 Family Fest is on — welcome Up North!"**. Family Fest 2026 advertised
  itself as live for three weeks after everyone went home.
- `isTakeover` is now spelled out as `isPlanning || isLive || isWrap`, **not**
  `phase !== "off-season"` — with a fifth phase that negation counts a finished
  fest as a takeover.
- Empty/malformed dates are explicitly guarded to `off-season`: every comparison
  against `NaN` is false, so they otherwise fall through to the final branch and
  report a fest with *no dates at all* as concluded.
- **`fest_config` is read as MANY rows now.** The PK has always been `fest_year`,
  but the web client pinned a hardcoded `FEST_YEAR = 2026` — **which is what iOS
  mirrors today**. The current fest is now "the newest row"
  (`lib/festYears.ts`), which is what makes a **Past Years** archive and an
  in-app "start next year" possible. **No new table, column or migration** — this
  is purely how the rows are read.
- ⚠️ The fest week is **decided by a family poll every year**. It must never be
  defaulted or computed from the previous year (a first cut used "+52 weeks" and
  was wrong). Dates are typed in by hand once the poll lands.

### C2 — `can_manage_event()` is no longer "admin OR creator"
**Supersedes the permission model in
[`09-events-and-cabins.md`](ios-parity-2026-08/09-events-and-cabins.md).** See
WS-N1 for the full rule. Any iOS screen that decides whether to show Edit /
Delete / add-an-attendee on an event must not hardcode the old predicate.

### C3 — `docs/IOS_PARITY.md` does not exist
It was referenced twice in `CLAUDE.md` and led nowhere. The handoff spec is
[`ios-parity-2026-08/`](ios-parity-2026-08/); media-server + signed reads are §15.
Both references are fixed.

---

## The work, by area

Effort: `¼d` `½d` `1-2d` `3-5d`. Status: **ADD** = iOS doesn't have it ·
**AUDIT** = iOS has a version and the web one grew.

### WS-N1 · Event hosts (NEW) — ⚠️ needs migration 0209 run
Extends WS09. **The one item here that is not "Swift against existing schema".**

An event now carries zero or more **hosts**, each either a **person** or a whole
**committee**, and hosts decide who may manage it:

| hosts | who may change it + RSVP others |
|---|---|
| none | any signed-in member |
| person host(s) | those people |
| committee host, **has leads** | that committee's **Leads** only |
| committee host, no leads | any member of it |

…always plus an app admin and the event's creator.

- [ ] `ADD` `½d` **Show who's hosting** — chips on the event sheet; a committee
      chip taps through to the committee. `event_hosts_for(p_event_ids text[])`
      returns hosts for MANY events in one call with names/emoji already joined.
- [ ] `ADD` `½d` **Host-aware Edit/Delete/add-attendee gating** — call
      `my_event_permissions(p_event_ids text[])` → `{event_id, can_manage,
      can_delete}` per event, one round-trip for a whole calendar.
- [ ] `ADD` `½d` **Add/remove a host** — `add_event_host(p_event_id, p_user_id,
      p_committee_id)` (exactly one of the two ids), `remove_event_host(p_id)`.

⚠️ **Gotchas, each from a real decision:**
- ⚠️⚠️ **THE HOST PANEL MUST OWN ITS OWN LIST — this already shipped broken on
  web once.** It rendered a `hosts` value threaded from the parent, and only one
  of the **three** surfaces that mount the event sheet passed a refresh. Picking
  "Resort Maintenance" wrote the row, the picker closed, and the panel still said
  *"Nobody yet"* — the click looked like it did nothing while the database had the
  host all along. **Load hosts inside the panel on appear and refetch after every
  add/remove;** treat anything handed in as a first-paint seed only. This was the
  **second** time this exact shape hit this one screen (web #572, "Add someone to
  an event does nothing", same cause) — a fix phrased as *"the parent must
  refetch"* does not survive the next caller.
- ⚠️ **A write that returns no error but changes nothing must SAY SO.** A silent
  success and a silent failure look identical, which is what made the web bug take
  a database query to diagnose.
- ⚠️ **"No host" is a COMPLETE answer, not an unfinished form.** A holiday weekend
  has nobody running it, somebody may put an event on the calendar without hosting
  it, and blank is the **default** for every event. Don't word the empty state as a
  gap to fill; word it as how the event currently works, with naming a host offered
  as the optional narrowing it is — and say what removing the last one *does*
  (hands the event back to the whole family). ⚠️ Synthesized events (holiday
  weekends, Family Fest) have no `events` row, so they're permanently hostless and
  should not offer a host editor at all.
- **Do NOT re-implement the permission rule client-side.** It needs the viewer's
  committee memberships, which of those they lead, AND whether each committee has
  any leads at all. The web deliberately asks the database for exactly this
  reason (the `event_message_preview` doctrine, 0192). A second copy drifts.
- **`can_delete_event` is a SEPARATE, narrower function** — same rule minus the
  "any member" fallback. Deleting destroys every RSVP on the event. Don't reuse
  `can_manage` for the Delete button.
- **`event_hosts.event_id` is TEXT with no FK**, matching `event_attendance`, so
  synthesized events (`family-fest-2026`) can carry hosts. Don't type it as uuid.
- **Read RLS is members-only** (a host row names a person — the 0081 doctrine), so
  a guest gets an empty list, not a partial one. Render no host line.
- **Anyone may always RSVP THEMSELVES.** `set_event_attendance` is untouched.
  Hosts govern acting on *other* people and changing the event.
- Pre-migration both RPCs 404 (PGRST202). Degrade to the OLD rule (admin OR
  creator), **not** to "nothing is manageable" — otherwise admins lose Edit.

### WS-N2 · House requests + House Admins (NEW) — the biggest gap
Migrations **0194, 0195, 0198–0203, 0205–0208**. 16 PRs. Nothing in the standing
spec covers any of it.

The board that carries a house's "should we?" from somebody noticing to somebody
actually buying it. Three kinds — 💡 **Idea**, 🛒 **Purchase request**, 🧾
**Reimbursement** — submitted by any member of a house, decided by a **House
Admin** (`profiles.house_admin`, 0194).

- [ ] `ADD` `3-5d` **The board** — `/house/requests` equivalent: grouped by
      status, with a permanent three-line legend. `house_requests` +
      `house_request_media`.
- [ ] `ADD` `1-2d` **Submitting each kind** — ⚠️ **there is NO default kind**;
      picking one is its own step and the form doesn't exist until you've chosen.
      `create_house_request` (8 args — 0200 dropped the 7-arg overload).
- [ ] `ADD` `1-2d` **Approve / deny / modify, with a note** —
      `review_house_request`, `update_house_request` (creator-while-pending OR a
      reviewer any time; a reviewer's edit notifies the requester).
- [ ] `ADD` `½d` **Record what happened** — `set_house_request_progress`.
      ⚠️ `pending → approved → ordered` for a purchase; `→ received` ("Paid") for
      a reimbursement, which skips `ordered`; **an idea ENDS at `approved`**.
- [ ] `ADD` `½d` **"They told me to just grab it"** — convert a purchase request
      to a reimbursement in place: `convert_request_to_reimbursement` (0207; note
      the name has no `house_` in it). ⚠️ **Requester-only** — a reimbursement pays
      `created_by`, so anyone else converting would route the money to whoever
      *asked* rather than whoever *paid*.
- [ ] `ADD` `½d` **House Admin badge + appointment** — `set_house_admin`.
      ⚠️ Only an app admin **who is themselves in that house** may appoint one.
- [ ] `ADD` `½d` **Notifications** — `house_request_submitted`,
      `house_request_decision`, `house_request_handled`, `house_request_reminder`.
      All four need adding to the iOS pushable set.
- [ ] `ADD` `¼d` **"Just test it — only notify me"** (0200) — reviewer-only
      checkbox; runs the real pipeline, notifies only the author.
- [ ] `ADD` `½d` **Delete / 7-day tombstone** (0201–0203, **0208**).
- [ ] `ADD` `¼d` **Order-in-time nudge** (0206) — a card at a 45-day horizon.

⚠️ **Gotchas:**
- **App admins have NO authority here** (0202). Only that house's House Admins
  may decide; only the author + that house's members may even *see* the board.
  ⚠️ The read policy compares `house_id` **directly** rather than calling
  `is_house_member()`, because that helper grants app admins a blanket pass and
  using it silently re-opens cross-house reads.
- **`fetchHouseRequests` uses a column-group ladder** — an unknown column fails
  the WHOLE select with 42703 and renders an empty board, which then reads as
  "migration missing". Newest group peels off first.
- **`numeric` comes back from PostgREST as a STRING.** Coerce it, or every cost
  sum is string concatenation.
- **Never name only the paperwork.** Migration 0205 exists because "Purchase
  Request" told the House Admins nothing about *whose money* or *who orders*.
  Every surface showing a kind must also show its `deal` line.

### WS-N3 · Email everyone about an event (NEW)
Migrations **0190–0193, 0196, 0197, 0204**. Extends WS09.

- [ ] `ADD` `1-2d` **Compose + preview** — ⚠️ **nothing sends until reviewed**:
      the button is "Preview the email →", and only the preview screen can send.
      `event_message_preview()` is a **dry run of the same SQL** the real send
      uses, returning per-bucket recipient *counts* and no addresses.
- [ ] `ADD` `½d` **Send** — `send_event_message()`.
- [ ] `ADD` `½d` **Manually add an attendee** (0196) — ⚠️ **two RPCs, not one**:
      `add_event_family_member` (an app member **or** a `family_roster` person
      with no account) and `add_event_guest` (a typed outside guest, **sponsor
      required**). Deliberately separate entry points — collapsing them into one
      "type a name" box is the confusion 0196 exists to fix.
- [ ] `ADD` `¼d` **Draft the note for me** — restates only what the event row
      says; ⚠️ must never invent a commitment.

⚠️ **Gotchas:**
- **ONE SEND PER AUDIENCE, not one email.** A house-scoped work item is visible
  only to that house, so recipients come back pre-sorted into buckets: one per
  house with items, plus a "general" one. A person lands in exactly one.
- **The house copy SAYS it's the house copy**, and the general copy stays
  completely silent about it.
- ⚠️ **`event_attendance` now has THREE FKs to `profiles`** (`user_id`,
  `sponsor_user_id`, `added_by`). Any embed MUST name the FK explicitly
  (`profiles!event_attendance_user_id_fkey(...)`) or PostgREST returns PGRST201
  instead of data — the same trap already hit on tournaments.
- **No link to the app, anywhere, by decision** — a bare link opens the browser,
  which on iOS is a separate signed-out session.

### WS-N4 · Family Fest: Past Years + starting a new year (NEW behaviour)
No migration. Supersedes parts of WS13 — read **C1** first.

- [ ] `ADD` `½d` **The `concluded` state** — hub says thank you, links the
      archive; RSVP card and the finished week step aside; Home's spotlight
      matches; the sub-nav drops to Overview + Past Years.
- [ ] `ADD` `1-2d` **Past Years** — a list of finished fests → one year read-only.
      ⚠️ **No edit affordances for ANYONE including admins** (the editor writes to
      the CURRENT year, so its sheets would edit the wrong fest), and **no
      sign-up cards**. ⚠️ **Keep tournament brackets** — who won the musky
      tournament is the history worth archiving.
- [ ] `ADD` `½d` **Resolve the current fest year** from the newest `fest_config`
      row instead of a compiled-in constant.
- [ ] `ADD` `½d` **Start next year** — INSERT a `fest_config` row; ⚠️ never edit
      the current one's dates, which would drag the finished fest forward.
      Optional template copy of schedule/dinners/dues/payees; ⚠️ deliberately
      **not** sign-up config or tournament flags.
- [ ] `AUDIT` `¼d` **Per-year photo album** — the year is a live segment of the
      well-known Drop Box id (`0000fe57-<year>-…`).

### WS-N5 · Work items: custom urgency + recurrence (AUDIT)
Migrations **0185, 0186**. iOS already has house-scoped work items.

- [ ] `AUDIT` `½d` **A fifth urgency: `custom`** — free-text wording +
      a picked colour. ⚠️ **Always resolve through `urgencyMeta(item)`**, never by
      indexing the fixed table: a `custom` item has no entry there.
- [ ] `AUDIT` `½d` **Recurring items** — `recur_every_years` (1–15).
      `mark_work_item_done()` auto-creates the next cycle stamped
      `surface_on` = **Jan 1 of the year it's next due**, and rows with a future
      `surface_on` are filtered OUT of the list. ⚠️ Deliberately **no
      notification** on the auto-created copy.
- [ ] `AUDIT` `¼d` **Urgency chip colours** — This year orange, Next year yellow.

### WS-N6 · Events: member-created + work-item linking (AUDIT)
Migrations **0187–0189, 0196, 0204**. Extends WS09.

- [ ] `AUDIT` `½d` **Any member can create an event** (0187) — was admin-only.
- [ ] `ADD` `1-2d` **Pick work items from the existing checklist** rather than
      only creating new ones, with urgency + scope shown on each row.
- [ ] `ADD` `¼d` **Unlink an item** — `remove_work_item_from_event` (never
      deletes the item itself). ⚠️ Its counterpart `add_work_item_to_event` is
      declared in 0050 **without a schema prefix**, unlike nearly every other RPC
      here — a grep for `function public.add_work_item_to_event` finds nothing.
      It exists; don't conclude otherwise.
- [ ] `ADD` `½d` **Group an event's work items by scope**, and show
      **"🔒 MJT House · 2 items planned"** for a house you're not in —
      `event_work_item_house_counts()`. ⚠️ That RPC is SECURITY DEFINER and
      therefore **gated on `is_approved_member()`**; any new SECURITY DEFINER
      read needs the same check.

### WS-N7 · House calendar: who's actually staying (AUDIT)
No migration. Extends WS06. iOS already has the house calendar + Hub.

- [ ] `AUDIT` `½d` **"In the house" is THREE kinds of person** — `via`:
      `member` (has an account, RSVP'd), `roster` (assigned to the house, **not on
      the app yet** — `family_roster.house_id` with no `linked_user_id`; added to
      an event via `event_attendance.roster_id`), `guest` (not family, but
      `sponsor_user_id` is a housemate). The web derivation used to open
      `if (!row.userId) continue`, silently dropping the last two.
- [ ] `AUDIT` `½d` **One derivation for "who's here on day X"** — ⚠️ the web's day
      popover read `house_stays` only and said **"Staying (0)"** while the list
      below it showed five people for the same dates. Don't derive it twice.
- [ ] `AUDIT` `¼d` **A count on the heading** — people, not rows: a stay's
      `guest_names` count, and nobody is double-counted.

⚠️ **Gotchas:** "a real stay always wins" must be guarded on `userId`
(`house_stays.created_by` is a uuid, so no real stay can belong to a roster
person or guest — matching a null would suppress all of them); and key a derived
row on the **attendance row's id**, not the user id, or two guests at one event
collapse into one person.

### WS-N8 · No iOS work — read and move on
- **#563 Search indexer stopped polling** — mini-side only. It now reconciles on
  a Realtime change and on search (`ensureFresh()`), with no boot sweep.
- **0204** — never email the App Store reviewer account. Server-side.
- **#540–#543** — the parity docs themselves.
- ⚠️ **Media-server changes need a `git pull` + restart on the mini** (Admin →
  Media server) before the event-email and house-request emails go out at all.

---

## Suggested order

1. **C1/C2 corrections** — cheap, and they stop you building known bugs.
2. **WS-N2 House requests** — the biggest family-visible gap, and entirely absent.
3. **WS-N1 Event hosts** — after Brian runs 0209.
4. **WS-N4 Family Fest** — seasonal; wants to be in before next summer.
5. **WS-N3 Event email**, then the three AUDITs (N5–N7).

The 2026-08 round's own **5 true blockers** (`how_to_use.true_blockers` in its
JSON — signed media reads first) still come before all of this. Nothing here
matters if photos 403.

## Still true from the standing spec

- **`MEDIA_AUTH` sits at `report`, not `on`, because native iOS can't sign media
  reads yet.** Complete Swift for it is in §0 of
  [`ios-parity-2026-08.md`](ios-parity-2026-08.md). That remains the single
  highest-value thing to ship.
- Every rule in that round's kickoff prompt
  ([`ios-parity-2026-08-PROMPT.md`](ios-parity-2026-08-PROMPT.md)) still applies —
  especially: never invent an RPC parameter name, and don't sequence off the
  JSON's `priority` field.
