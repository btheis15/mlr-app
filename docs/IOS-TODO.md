# iOS to-do — the changes to make, and nothing else

**This file is self-contained.** Every table, column, RPC name and argument name
below was read out of `mlr-app/supabase/migrations/` and verified to exist. You do
**not** need the web repo checked out to work from it, and you should **not** plan
from `ios-parity-2026-08*` — those rounds are older and much of what they call
missing already exists.

- **iOS repo audited:** `btheis15/mlr-app-ios` @ `7a6795f` (231 Swift files)
- **Web covered:** through PR #581 / migration 0209
- **Backend:** all of this is Swift against schema that is **already deployed**.
  Nothing here needs a migration run.

⚠️ **Supabase keys RPC arguments BY NAME.** A wrong `p_` key fails at runtime with
an unhelpful error, not a compile error. The argument lists below are exact —
copy them.

⚠️ **Build before claiming anything works** (Cmd-B). Watch for new Swift files
missing target membership — a known silent failure in this project.

---

## 0. Two live bugs — do these first (small, and they're wrong on phones today)

### 0a. The fest week is hardcoded, and it's wrong

`MLRApp/Shared/Utilities/FestSeason.swift`:

```swift
struct FamilyFestConfig {
    static let startDate = "2026-07-27"   // ← wrong
    static let endDate   = "2026-07-31"   // ← wrong
```

The database (`fest_config`) says **`2026-07-26` → `2026-08-01`**. `FestSeason.current()`
computes from the hardcoded pair, and **seven** files consume it:

```
MLRApp/Tabs/HomeTab/HomeView.swift
MLRApp/Tabs/FamilyFestTab/FestOverviewView.swift
MLRApp/Tabs/FamilyFestTab/FestDuesCalculator.swift
MLRApp/Houses/MjtHouseDuesView.swift
MLRApp/App/RootView.swift
MLRApp/Intents/FestCountdownIntent.swift
MLRWidget/FamilyFestCountdownWidget.swift
```

**What already went wrong:** during the week iOS showed *"Day n of 5"* instead of
*of 7*, and on **Aug 1 — the actual final day** — it had already flipped to "wrap".

**Fix:** resolve the window from `fest_config` (see §1) instead of compiling it in.
Keep the constants only as an offline fallback. ⚠️ The widget and the Siri intent
run in separate processes and can't reach a fetch as easily — cache the resolved
window in the shared App Group (`AppGroup/` already exists) and have them read that.

### 0b. The widget and Siri say Family Fest "starts today" — right now

`FestSeason.swift:93` clamps `daysUntilStart: max(0, daysUntilStart)`, and the
off-season branch treats `0` as *starting today*. Three weeks after the fest ended:

- `MLRWidget/FamilyFestCountdownWidget.swift:159,168` → **"Today!" / "See you there"**
- `MLRApp/Intents/FestCountdownIntent.swift` (`days == 0` branch) → **"Family Fest starts today!"**

⚠️ This is the **same clamp-to-zero-reads-as-happening-now bug the web had**, where
zero meant "the moment has arrived" and rendered *"🎉 Family Fest is on"*. The
in-app cards are fine (`FestStatus.swift` has a real `OffSeasonCard`), so it only
shows on the home screen and in Siri.

**Fix:** §1's `concluded` phase. Both call sites must branch on it *before* they
look at `daysUntilStart`.

---

## 1. Family Fest: a fifth season phase, and many fest years

### 1a. Add `concluded` to the phase enum

`MLRApp/Shared/Utilities/FestSeason.swift`:

```swift
enum FestPhase: String { case offSeason = "off-season", planning, live, wrap, concluded }
```

Rule: `concluded` = today is **more than `wrapTailDays` (14)** past the end date.
`offSeason` keeps its other meaning only — the window is still **ahead**.

⚠️ **These two are not interchangeable.** Collapsing them is the original bug:
`off-season` meaning both "still ahead" and "already over" is what let a finished
fest render as a countdown.

✅ `isTakeover` is **already correct** in the Swift (`isLive || isPlanning || isWrap`)
— don't change it to a `!= .offSeason` negation, which would count a finished fest
as a takeover.

⚠️ Guard invalid/empty dates to `offSeason` explicitly (the Swift `guard let` at the
top of `compute` already does this — keep it).

### 1b. Resolve the fest YEAR from data, not a constant

`MLRApp/Services/FestContentService.swift:187`:

```swift
private let year = FamilyFestConfig.year   // ← hardcoded 2026
```

`fest_config`'s primary key is `fest_year` and there can be **many rows**. The
current fest is **the newest row**:

```
from("fest_config").select("fest_year, name, tagline, start_date, end_date")
  .order("fest_year", ascending: false)
```

Take `[0]`. Everything else (`fest_dues`, `fest_schedule_items`, `fest_dinners`,
`fest_payees`, `fest_activities`) filters on that resolved `fest_year`.

### 1c. The concluded UI

- **Fest tab**: a thank-you card (*"That's a wrap on 2026 — Thank you for a great
  Family Fest. See you next year!"*), a link to Past Years, a link to the photo
  album. Hide the RSVP card and the week accordion.
- **Home spotlight**: *"Thank you for a great Family Fest · See you next year"*.
- **Sub-nav**: drop to Overview + Past Years while concluded.

### 1d. Past Years (the archive)

A list of finished fests → one year, **read-only**. A year is "past" when it's more
than 14 days after its end date — the same threshold as `concluded`, so the hub
saying "that's a wrap" and the year appearing in the archive flip on the same day.

⚠️ **Rules that matter:**
- **No edit affordances for ANYONE, including admins.** The fest editor writes to
  the *current* year, so its sheets would silently edit the wrong fest.
- **No sign-up cards** — nothing left to sign up for.
- **KEEP tournament brackets**, read-only. Who won the musky tournament is exactly
  the history worth archiving.
- **No seed fallback.** The live hub backfills an empty table with in-code seed
  data so it's never blank; an archive doing that would **fabricate history**.

**Per-year photo album:** the year is a live segment of the well-known Drop Box id
— `0000fe57-<year>-4000-8000-000000000001`. An unseeded year degrades to "folder
isn't available", so linking one early is harmless.

### 1e. Start next year (fest editors only, when concluded)

**INSERT a new `fest_config` row.** ⚠️ Never edit the current row's dates — that
drags the finished fest forward, so its archive describes a week that never
happened and the app counts down to it again.

⚠️⚠️ **Dates are typed in BY HAND and start EMPTY.** The fest week is **different
every year and the family decides it by poll**. Do not default or compute it (the
web shipped a "+52 weeks" default and it was wrong). Derive the year from the
start date so the two can't disagree.

---

## 2. Event hosts (backend is live — migration 0209)

An event has zero or more hosts, each a **person** or a whole **committee**.

| hosts | who may change it + RSVP others |
|---|---|
| none | any signed-in member |
| person host(s) | those people |
| committee host, **has leads** | that committee's **Leads** only |
| committee host, no leads | any member of it |

…always plus an app admin and the event's creator.

```
event_hosts_for(p_event_ids: text[])
  → rows of { id uuid, event_id text, user_id uuid?, committee_id uuid?,
              display_name text, emoji text?, slug text? }

my_event_permissions(p_event_ids: text[])
  → rows of { event_id text, can_manage boolean, can_delete boolean }

add_event_host(p_event_id: text, p_user_id: uuid? = nil, p_committee_id: uuid? = nil) → uuid
remove_event_host(p_id: uuid) → void
```

⚠️ **Do NOT re-implement the permission rule in Swift.** It needs the viewer's
committee memberships, which of those they lead, *and* whether each committee has
any leads at all. Ask `my_event_permissions` — one call for a whole calendar.

⚠️ **`can_delete_event` is separate and narrower** — the same rule *minus* the "any
member" fallback, because deleting takes every RSVP with it. Use `can_delete`, not
`can_manage`, for the Delete button.

⚠️ **`event_id` is TEXT, not uuid** — synthesized events (`family-fest-2026`) can
carry hosts.

⚠️ **The host panel must own its list.** Load on appear, refetch after every
add/remove; treat anything passed in as a first-paint seed. On web this shipped
rendering a value threaded from the parent, only one of three surfaces refreshed
it, and picking a committee wrote the row while the panel still said "Nobody yet".
That was the **second** time this shape hit that screen. A rule that says "the
parent must refetch" does not survive the next caller.

⚠️ **A write that returns no error but changes nothing must SAY SO** — silent
success and silent failure look identical, which is what made the web bug need a
database query to diagnose.

⚠️ **"No host" is a COMPLETE answer, not an unfinished form.** A holiday weekend
has nobody running it, and blank is the default for every event. Word the empty
state as how the event currently works, not as a gap to fill, and say what removing
the last host does (hands it back to the whole family). Synthesized events have no
`events` row and are permanently hostless — don't offer the editor there at all.

⚠️ Read RLS on `event_hosts` is **members-only**, so a guest gets an empty list.
Render no host line rather than a partial one.

---

## 3. House requests + House Admins (the biggest gap)

Nothing of this exists on iOS. Three kinds — 💡 **Idea**, 🛒 **Purchase request**,
🧾 **Reimbursement** — submitted by any member of a house, decided by a **House
Admin** (`profiles.house_admin`).

**Table `house_requests`:** `id, house_id, created_by, kind ('purchase'|'idea'|
'reimbursement'), title, reason, links jsonb, est_cost numeric, quantity int,
status ('pending'|'approved'|'denied'|'ordered'|'received'|'withdrawn'),
reviewed_by, reviewed_at, review_note, actual_cost, order_note, ordered_at,
ordered_by, received_at, received_by, change_note` (+ `house_request_media`).

```
create_house_request(p_house_id: uuid, p_kind: text, p_title: text,
    p_reason: text = "", p_links: jsonb = [], p_est_cost: numeric? = nil,
    p_quantity: int? = nil, p_test_only: bool = false) → uuid
review_house_request(p_id: uuid, p_approve: bool, p_note: text? = nil, p_notify: bool = true) → void
update_house_request(p_id: uuid, p_title:…, p_reason:…, p_links:…, p_est_cost:…,
    p_quantity:…, p_clear_cost: bool = false, p_clear_quantity: bool = false,
    p_note: text? = nil, p_notify: bool = true) → void
set_house_request_progress(p_id: uuid, p_status: text,
    p_actual_cost: numeric? = nil, p_order_note: text? = nil) → void
convert_request_to_reimbursement(p_id: uuid, p_actual_cost: numeric,
    p_note: text? = nil, p_title: text? = nil, p_links: jsonb? = nil) → text  // new status
withdraw_house_request(p_id: uuid) → void
delete_house_request(p_id: uuid) → void
set_house_admin(target: uuid, value: bool) → void      // ⚠️ NOT p_-prefixed
```

⚠️ **App admins have NO authority here.** Only that house's House Admins may
decide, and only the author + that house's members may see the board. When
checking membership yourself, compare `house_id` **directly** — the
`is_house_member()` helper grants app admins a blanket pass and would re-open
cross-house reads.

⚠️ **Only an app admin who is *themselves in that house* may appoint a House
Admin.** Changing someone's house clears the flag.

⚠️ **The status ladder:** `pending → approved → ordered` for a purchase;
`→ received` ("Paid") for a reimbursement, which **skips `ordered`**; **an idea
ENDS at `approved`** — it has no third step, and offering one invents a chore
nobody owes. `approved` is **not** terminal for a purchase: "approved but nobody
bought it" is the exact failure this feature exists to make visible. `ordered` IS
terminal — there is deliberately no "it arrived" step.

⚠️ **There is NO default kind.** Picking one is its own step and the form doesn't
exist until you've chosen. Every surface showing a kind must also say **whose money
and who orders** — a request that only said "Purchase Request" was read as "he's
buying it himself", and nobody ordered the thing.

⚠️ **Converting a purchase → reimbursement is REQUESTER-ONLY.** A reimbursement
pays `created_by`, so anyone else converting would route the money to whoever
*asked* rather than whoever *paid*.

⚠️ **`numeric` comes back from PostgREST as a STRING.** Coerce it, or every cost
total is string concatenation.

⚠️ **Use a column-group ladder on the select.** An unknown column fails the whole
select with `42703` and renders an empty board, which then reads as "migration
missing".

⚠️ **Show the recipient list before sending anything.** Read `profiles.house_admin`
for that house — the same predicate the server fan-out uses. A house with no House
Admin notifies **nobody**; say so loudly.

**Notifications to add to the pushable set:** `house_request_submitted`,
`house_request_decision`, `house_request_handled`, `house_request_reminder`.

---

## 4. Email everyone about an event

```
event_message_preview(p_event_id: text, p_event_title: text? = nil,
    p_event_when: text? = nil, p_include_work_items: bool = true,
    p_exclude_not_attending: bool = true, p_include_roster: bool = true) → table
send_event_message(p_event_id: text, p_event_title: text, p_event_when: text? = nil,
    p_subject: text? = nil, p_body: text? = nil, p_include_work_items: bool = true,
    p_exclude_not_attending: bool = true, p_include_roster: bool = true) → integer
```

⚠️ **Nothing sends until it's been reviewed.** The button is "Preview the email →";
only the preview screen can send. `event_message_preview` is a **dry run of the same
SQL** the real send uses, returning per-bucket recipient **counts** and no
addresses. Don't assemble the preview client-side: a house-scoped work item is
RLS-invisible to a non-member, so you'd render a different email than the one that
sends.

⚠️ **ONE SEND PER AUDIENCE, not one email.** Recipients come back pre-sorted into
buckets — one per house that has work items, plus a "general" one. A person lands
in exactly one. The house copy **says** it's the house copy; the general copy stays
completely silent that a hidden list exists.

**Manual attendee add — two RPCs, deliberately separate:**

```
add_event_family_member(p_event_id: text, p_user_id: uuid? = nil,
    p_roster_id: uuid? = nil, p_status: text = "going") → uuid
add_event_guest(p_event_id: text, p_name: text, p_sponsor_user_id: uuid,
    p_status: text = "going", p_email: text? = nil) → uuid
```

⚠️ A guest's **sponsor is required** and picked from a dropdown, never typed, so an
outside guest is always traceable. Collapsing these into one "type a name" box is
the confusion they exist to fix.

⚠️ **`event_attendance` has THREE FKs to `profiles`** (`user_id`,
`sponsor_user_id`, `added_by`). Any embed **must** name the FK explicitly —
`profiles!event_attendance_user_id_fkey(...)` — or PostgREST returns `PGRST201`
instead of data.

---

## 5. Work items — two additions (iOS already has work items)

```
create_work_item(p_title:…, p_notes:…, p_category:…, p_people_needed:…,
    p_house_id:…, p_urgency:…, p_custom_label:…, p_custom_color:…,
    p_recur_every_years:…) → uuid
update_work_item(p_id:…, p_title:…, …same trailing three…) → void
mark_work_item_done(p_id: uuid) → void
```

- **A fifth urgency, `custom`** — free-text `custom_label` + a picked
  `custom_color`. ⚠️ Always resolve through one `urgencyMeta(item)`-style helper;
  a `custom` item has **no entry** in the fixed tier table, so indexing it directly
  crashes or renders blank.
- **Recurring items** — `recur_every_years` (1–15). `mark_work_item_done()`
  auto-creates the next cycle stamped `surface_on` = **Jan 1 of the year it's next
  due**. ⚠️ **Filter out rows whose `surface_on` is in the future** — they exist
  immediately so the recurrence is never lost, but must not show until their year.
  ⚠️ Deliberately **no notification** on the auto-created copy.

---

## 6. Event work items grouped by scope

```
event_work_item_house_counts(p_event_id: text)
  → { house_id uuid, house_name text, house_emoji text, item_count integer }
```

Group an event's work items: "🌲 Around the Resort" first, then one group per
house. For a house you're **not** in, its items are RLS-invisible, so show
**"🔒 MJT House · 2 items planned — details only visible to that house"** from this
RPC rather than letting the section silently vanish.

⚠️ After unlinking an item, refetch the **counts** too, not just the items.

✅ `add_work_item_to_event` is **already wired** on iOS
(`MLRApp/Services/WorkItemsService.swift:280`) — this task is the picker UI and the
scope grouping, not the link.

---

## 7. House calendar: who's actually staying

iOS has the house calendar. Three things it doesn't know:

**"In the house" is three kinds of person**, not one:
- **member** — `profiles.house_id`, has an account, RSVP'd themselves.
- **roster** — assigned to the house but **not on the app yet**
  (`family_roster.house_id` with `linked_user_id` null). They can't RSVP, but a host
  can add them to an event (`event_attendance.roster_id`). ⚠️ Only ever pull
  **unlinked** roster slots — a claimed one is already covered by `profiles.house_id`
  and would list the person twice.
- **guest** — not family, but `event_attendance.sponsor_user_id` is a member of this
  house, so they're staying here too. Label it "Guest of {sponsor}".

⚠️ The web derivation used to open `if (!row.userId) continue`, which silently
dropped the last two categories.

⚠️ **"A real stay always wins" must be guarded on `user_id`.** `house_stays.created_by`
is a uuid, so no real stay can belong to a roster person or guest — matching a null
would suppress every one of them at once.

⚠️ **Key a derived row on the attendance row's id, not the user id** — two guests at
one event otherwise collide and render as one person.

⚠️ **One derivation for "who's here on day X".** On web the day popover read only
real stays and said **"Staying (0)"** while the list below it showed five people for
the same dates. Both surfaces must call the same function.

**A count on the heading** — *people*, not rows: a stay's extra `guest_names` count,
and nobody is double-counted.

---

## Suggested order

1. **§0** — both live bugs (small; they're wrong on phones today).
2. **§1** — the rest of the fest season + Past Years (seasonal; wants to be in
   before next summer, and §0a/§0b are half of it anyway).
3. **§3** — house requests (biggest gap, entirely absent).
4. **§2** — event hosts.
5. **§4**, then the audits **§5 / §6 / §7**.

## One thing to check on the server, not in Xcode

`MEDIA_AUTH` is still held at `report` because iOS couldn't sign media reads — but
it **can** now (`MLRApp/Services/MediaTokenService.swift`). To turn enforcement on:

1. Exercise the app hard — scroll an album, open a photo, **play and scrub a video**.
2. On the mini: `grep WOULD-BLOCK ~/mlr-app/media-server/logs/server.log`
3. Zero lines with an iOS user agent ⇒ safe to set `MEDIA_AUTH=on`.

Video matters separately: it issues Range requests, and a player that drops the
query string on a range retry breaks video while photos look perfect. The signature
is `range=yes tok=missing`.
