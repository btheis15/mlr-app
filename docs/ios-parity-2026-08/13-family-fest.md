<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ✅ **Fact-checked.** Every table, column and RPC named below was verified against the migrations by a second pass; **9 correction(s)** were applied.

### The Family Fest section

Family Fest is the one week of the year the whole family is on the same lake at the same time, and this section is what they hold in their hands while it happens. On web it is `/family-fest/*` — a section of the resort app with its own parchment/Renaissance identity, its own sub-nav, and a four-phase "season" that swells and recedes across the calendar year. On iOS it must be **the** way to experience that week: everything below works with no signal, updates a Lock Screen, and drops the week into the system calendar. Parity is the floor here; the phone is the device people actually use at the lake.

Everything in this section reads and writes **schema that already exists**. There is exactly one place a backend change is genuinely warranted (see "⚠️ The self-edit scope is not enforced server-side"), and it is optional. Everything else is Swift against existing tables.

---

#### 1. The data layer

Seven tables, all created or extended by the migrations named below. **Unlike almost every other feature in this app, fest content is written by DIRECT table writes, not SECURITY DEFINER RPCs.** There is no `save_fest_schedule_item()` to call — you `insert`/`update`/`delete` on the table and RLS decides. The only RPC anything in *this* section calls is the boolean gate `can_edit_fest()`; there is no content-write RPC at all. (Don't over-generalize that: the sign-up-slots and tournament features, which are separate sections, do have their own RPCs — `fest_schedule_slot_starts`, `fest_schedule_signup_counts`, `remove_schedule_signup`, `run_signup_reminders`, … — and `sync_fest_lead_names()` below is a trigger function, not something a client calls.)

| Table | Migration | What it holds |
|---|---|---|
| `fest_config` | 0053 | One row per `fest_year` (PK): `name`, `tagline`, `start_date`, `end_date`. The **source of truth for the season window.** |
| `fest_dues` | 0053, 0078 | Dues tiers: `label`, `amount` (int, nullable = TBD), `note`, `per_day` (0078), `position`. |
| `fest_schedule_items` | 0053, 0110, 0134, 0139, 0141, 0142 | Every event. Also the home of **anytime events** since 0139/0141. |
| `fest_dinners` | 0053, 0099 | One row per night: chef, crew, houses, menu, served/prep time+location. |
| `fest_payees` | 0053 | Who to pay and by what method (`venmo`, `zelle`, `applecash`, `paypal`). |
| `fest_activities` | 0053, 0110 | **Legacy.** Retired on web by 0141; kept alive *only because iOS still reads it.* |
| `app_images` | 0055 | `key = 'fest_cover'` → the hub banner. |

**RLS read rules — one sentence each, so an empty result is interpretable.** Migration 0053 gives all six fest tables `for select using (true)`:

- `fest_config` — readable by **anyone**, including a signed-out guest and an unapproved new signup; an empty result means the row for that `fest_year` was never created, never "not permitted".
- `fest_dues` — same; empty means no tiers exist yet, so fall back to the seed rather than showing a blank price list.
- `fest_schedule_items` — same; empty means nothing is scheduled yet.
- `fest_dinners` — same; empty means no dinners on the books.
- `fest_payees` — same; ⚠️ **payment handles are readable by an anonymous client.** The privacy on web is purely the client-side `SignInWall` around `/family-fest/pay`. iOS must add the same gate itself; RLS will not do it for you.
- `fest_activities` — same; empty is normal after 0141 converted the rows.
- `app_images` — public read (0055).

Migration 0183 (verified-member reads) deliberately **left the fest tables public** — its own header lists "fest_content — public by design (browse-first content, no PII)". So an unapproved signup still sees the schedule. That is intended.

**Write rules.** 0053 puts one blanket policy on each table: `for all using (public.can_edit_fest()) with check (public.can_edit_fest())`. Layered on top, as *additional permissive* policies that Postgres ORs together (each with an **identical `with check`**, not just a `using` — so an UPDATE must still satisfy the predicate *after* it lands):

- `"fest_dinners: chef or crew self-edit"` — `for update using (chef_user_id = auth.uid() or auth.uid() = any(crew_user_ids)) with check (same)` (0099)
- `"fest_schedule_items: lead or crew self-edit"` — `for update using (lead_user_id = auth.uid() or auth.uid() = any(crew_user_ids)) with check (same)` (0110)
- `"fest_activities: lead or crew self-edit"` — same shape (0110)

All three are **UPDATE-only, not FOR ALL** — a chef can edit their dinner, not insert or delete one. (The `with check` does stop one thing: a lead can't reassign their own row's `lead_user_id`/`crew_user_ids` away from themselves and keep write access. It does **not** protect any other column — see §8.)

**`can_edit_fest()` — read its CURRENT definition, not 0053's.** 0053 defined it against `committee_members`; **migration 0057 replaced it** with:

```sql
-- current production form (0057)
select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    or exists (select 1 from public.committee_roster r
               where r.committee_slug = 'family-fest' and r.linked_user_id = auth.uid());
```

Three consequences: (a) it is the **display roster** that grants fest-edit rights, linked by verified signup email (`profiles.contact_email`, migrations 0056/0060) — that is ~21 people in the current seed, not a short admin list; (b) `revoke all … from public, anon; grant execute … to authenticated` means calling it from an anonymous session **errors** rather than returning false — wrap it and treat any error as `false`; (c) it takes **no parameters** — `supabase.rpc("can_edit_fest")` with an empty body.

**Swift shapes.** Every nullable column really is null in live data; nothing below is theoretical.

```swift
struct FestConfigRow: Decodable {          // fest_config
    let name: String
    let tagline: String?
    let startDate: String                   // "YYYY-MM-DD" — keep as String
    let endDate: String
    enum CodingKeys: String, CodingKey { case name, tagline, startDate = "start_date", endDate = "end_date" }
}

struct FestScheduleRow: Decodable {         // fest_schedule_items
    let id: String                          // uuid, but a seed fallback id is a slug — keep String
    let day: String                         // NOT NULL even for anytime items (see gotcha)
    let startTime: String?                  // FREE TEXT: "18:00" or "6:00 PM" or garbage
    let endTime: String?
    let title: String
    let emoji: String?
    let location: String?
    let description: String?
    let bring: String?
    let isPrivate: Bool                     // stored, edited, and NEVER read for display (see gotcha)
    let anytime: Bool                       // 0139
    let leadUserId: String?                 // link of record
    let leadName: String?                   // display SNAPSHOT, trigger-synced (0113)
    let leadPhone: String?
    let crewUserIds: [String]?              // uuid[] not null default '{}' — decode nil → []
    let imageUrl: String?                   // 0134
    let links: [EventLink]?                 // 0142, jsonb array of {href,label}
    let signupEnabled: Bool
    let signupCapacity: Int?
    let signupMode: String?                 // "interval" | "slots" | "headcount" | null
    let tournamentEnabled: Bool
    let signupHideNames: Bool?
    // … the remaining signup_* columns belong to the sign-up slots section
}

struct EventLink: Codable { let href: String; let label: String? }

struct FestDinnerRow: Decodable {           // fest_dinners
    let id: String
    let day: String
    let title: String
    let emoji: String?
    let chefUserId: String?
    let chefName: String?                   // display SNAPSHOT (0113)
    let chefPhone: String?
    let crewUserIds: [String]?              // 0099
    let houses: [String]?                   // text[] — family names, NOT member ids
    let menu: String?
    let servedTime: String?
    let servedLocation: String?
    let prepTime: String?
    let prepLocation: String?
}

struct FestDuesRow: Decodable {             // fest_dues
    let id: String
    let label: String
    let amount: Int?                        // WHOLE DOLLARS; nil = "TBD", never render "$0"
    let note: String?
    let perDay: Bool                        // 0078
}
```

**Web idioms that do not transfer.** The web display mappers coerce nils into the literal string `"TBD"` (`mapDinner` does `menu: r.menu ?? "TBD"`, `location: r.served_location ?? "TBD"`, and `chef: { name: r.chef_name?.trim() || "TBD" }`). Do **not** copy that into your model layer — keep `String?` in the model and resolve "TBD" at the view. The web pays for it: `DinnerDetailsEditSheet` has to un-do it on the way back in (`useState(dinner.menu === "TBD" ? "" : dinner.menu)`), which means a chef who literally types "TBD" gets it silently blanked.

**Order and filter, always.** Every read is `.eq("fest_year", 2026).order("day").order("position")` (dinners/schedule) or `.order("position")` (dues/payees/activities). ⚠️ `FEST_YEAR` is a **hardcoded constant** in `lib/festContent.ts` (`const FEST_YEAR = 2026`). iOS should derive it from `fest_config` or make it one constant in one file — 2027 otherwise means shipping a build.

⚠️ **Realtime is probably not wired for these tables — verify before relying on it.** `lib/useFestContent.ts` subscribes `postgres_changes` on all six, but **no migration adds any of `fest_config`/`fest_dues`/`fest_schedule_items`/`fest_dinners`/`fest_payees`/`fest_activities` to the `supabase_realtime` publication** (0135/0136/0138 explicitly add the *slots/signups* tables; the content tables are absent). Either they were added out-of-band in the dashboard or web's fest realtime has been quietly dead. **Verify in the Supabase dashboard**, and either way do not make iOS depend on it: refresh on foreground + pull-to-refresh is both more reliable and exactly what the offline-first design wants anyway. If you do subscribe, ⚠️ **put `home_callouts` on its own channel** — a `postgres_changes` binding to a table that doesn't exist fails the *whole channel join*, which would silently kill live updates for every table sharing it (the web comment in `useFestContent.ts` records this).

---

#### 2. The four-phase season model — and why it MUST be computed at runtime

`lib/festSeason.ts` is a pure function, mirrored byte-for-byte in the retired standalone `family-fest` repo. Port it verbatim; it is the spine every fest surface hangs off.

```
getFestSeason(startDate, endDate, now) -> {
  phase: "off-season" | "planning" | "live" | "wrap",
  isLive, isPlanning, isWrap,
  isTakeover,        // phase != "off-season"
  daysUntilStart,    // max(0, …)
  isSoon,            // isPlanning && daysUntilStart <= 7
  dayNumber,         // 1-based, only while live, else nil
  totalDays,         // inclusive day count of the window
  daysSinceEnd,
  wrapDaysLeft
}
PLANNING_LEAD_DAYS = 60      WRAP_TAIL_DAYS = 14
```

Phase rules, exactly: `today < start` → `planning` if `daysToStart <= 60` else `off-season`; `start <= today <= end` → `live`; `today > end` → `wrap` if `daysAfterEnd <= 14` else `off-season`.

⚠️⚠️ **This is date-only math, computed from "now", and a build-time or launch-once evaluation is a bug.** The web file says it in a header comment: *"Compute it on the CLIENT (it depends on 'now') via `useFestSeason` — a build-time `new Date()` would freeze the phase at deploy time."* The web hook returns `nil` until mounted to dodge hydration mismatch and the `DemoDateProvider` re-renders hourly so a long-open tab rolls over days. **On iOS the equivalent failure is worse**, because an app resident in memory for the whole fest week never recomputes: someone who opens the app Monday morning and leaves it backgrounded all week sees "Day 1 of 7" on Friday. Recompute on:

- `UIApplication.willEnterForegroundNotification`
- `NSCalendarDayChangedNotification` and `UIApplication.significantTimeChangeNotification`
- a `Timer` scheduled for the next local midnight (belt and braces; the app is likely foregrounded across midnight during the week)
- any change to `fest_config` dates

Make it an `ObservableObject` publishing `FestSeason`, seeded synchronously so no view flashes an off-season banner during the live week.

⚠️ **`dateOnly` semantics matter.** The web builds `new Date(y, m-1, d)` for both `today` and the parsed window, so comparisons are date-only in the **device's** timezone. In Swift use `Calendar.current.startOfDay(for:)` and `dateComponents([.day], from:to:)`, not raw `TimeInterval / 86400` — DST transitions in the fest window (July, so not an issue this year, but the function is year-agnostic) make the raw division wrong by an hour and can flip a `Math.round` boundary.

⚠️ **`fest_config` dates and the in-code seed already disagree.** `lib/data.ts` `FAMILY_FEST` says `startDate: "2026-07-26"`, `endDate: "2026-08-01"`; the 0053 seed row in `fest_config` says `'2026-07-27'` → `'2026-07-31'`. Web has both live at once — `FestStatus`, `FestWeek`, `FamilyFestSpotlight` and the Planner read `config` from `fest_config`, while `FestDuesCallout`, `FestCommitteesLink`, `HomePreFestCards`, the **Dinners index's day picker** (`eventDays(FAMILY_FEST.startDate, FAMILY_FEST.endDate)`) and — indirectly — **`FestRsvp`** (via the synthesized `family-fest-2026` event, which `RESORT_EVENTS` builds from the constant, see §10) all read the `FAMILY_FEST` constant. So the "pay your dues" callout, the RSVP card's disappear-at-live rule and the countdown can disagree about what phase it is. (CLAUDE.md's season section still says "Dates come from `FAMILY_FEST.startDate` / `.endDate`" — that's the stale half of the same drift; the hub genuinely reads the DB.) **iOS should read `fest_config` and only `fest_config`**, using a bundled constant strictly as the pre-network/offline seed. One clock, one answer.

**Who consumes the season:** the hub's `FestStatus` (countdown → "Day n of N + Happening today" → wrap photo nudge), the Home `FamilyFestSpotlight` (quiet banner → "planning underway" → today's agenda inline → "that's a wrap"), the tab bar (a live dot during `live` and `wrap`), `FestRsvp` (hides itself entirely once `isLive || isWrap` — off the *constant* window today), `FestDuesCallout` (only during `planning`), `FestCommitteesLink` (only during `live`), and `FestDuesCalculator` (caps the day-count stepper at `totalDays`).

---

#### 3. The section's visual identity — mirror it natively

The web scopes an entire alternate palette to the `.ff-section` subtree in `app/globals.css`, re-declaring the Tailwind color variables so every utility inside renders parchment/heraldry while the rest of the app stays forest green:

```
--color-background: #f4ecd8   /* aged parchment */
--color-foreground: #3a2a18   /* sepia ink */
--color-card:       #fdfaf1   /* light vellum */
--color-border:     #d8c7a3   /* tan hairline */
--color-primary:    #8b2e2e   /* heraldic wine (gules) */
--color-accent:     #1e3a8a   /* heraldic azure */
--font-display:     Cinzel    (next/font, self-hosted; Roman-inscription serif)
```
plus a layered ambient wash (`--ff-ambient-image`: a wine radial at the top, a sepia vignette at the bottom, over a parchment gradient) and a P3 wide-gamut variant under `@supports (color: color(display-p3 …))`: primary `color(display-p3 0.57 0.15 0.15)`, accent `color(display-p3 0.1 0.22 0.56)`. Outside the section, the fest's brand color is the separate `--color-fest: #8b2e2e` token (used for the tab bar's Family Fest tab and live dot).

There is also a lesson here: `FestThemeSync` exists because `.ff-section` only painted its own content box, so the resort's green ambient wash showed through during rubber-band bounce — it toggles `data-ff` on `<html>` to paint the viewport canvas too. The same escape-the-subtree problem hit **portaled sheets**, which is why `lib/festPath.ts` (`isFamilyFestPath`) exists as the one source of truth and `Sheet.tsx` re-applies the theme itself. Anything presented outside the fest view hierarchy has to re-assert the palette.

**On iOS**: define a `FestTheme` (a SwiftUI `EnvironmentKey` or a `Theme` struct injected at the tab root) with those exact colors as `Color(.displayP3, red:green:blue:)` so wide-gamut screens get the richer heraldry; bundle **Cinzel** (per `docs/ios-parity-2026-07.md` it is already bundled) and register it as the display face for titles with the web's `letter-spacing: 0.02em` → `.tracking(0.02 * fontSize)`. Paint the parchment on the **scroll view's background and the navigation bar**, not just the content — that is the native analogue of the `data-ff` fix; a green nav bar over parchment content is exactly the bug the web hit, and a modally presented sheet is the second instance of it. ⚠️ **Light mode only, deliberately** — the whole app is, and parchment is a light surface. Do not add a dark variant; if the user is in Dark Mode, force `.preferredColorScheme(.light)` for this subtree rather than inventing a dark parchment.

Native wins available here that the web cannot have: the parchment can be a real material with `.background(.ultraThinMaterial)` behind the sticky sub-nav (web fakes it with `bg-background/90 backdrop-blur`), and the section's identity can extend to the **app icon alternate**, a Live Activity, and a widget — see §11.

---

#### 4. The hub (`/family-fest` → `FamilyFestPage`)

One integrated screen, in this exact order:

1. `FestCover` — the banner. Fallback chain, in priority order: `app_images['fest_cover']` → the mini's `/assets/site/family-fest-2026.jpg` → the bundled asset. Implement all three; the web's `onError` swap to the bundled copy is what keeps the header from ever showing a broken image.
2. `config.name` as the title, then a `font-display` line: `⚜ {FAMILY_FEST.theme} ⚜ · {formatDateLong(startDate)} – {formatDateLong(endDate)}` (dates from `config`, i.e. `fest_config`). ⚠️ The theme string (`"Ye Olde Family Feste"`) is **only** in `lib/data.ts`, not in `fest_config` — there is no `theme` column. Either bundle it or add a column (a real, tiny backend change if you want it editable).
3. An "✏️ Edit Family Fest" pill to `/family-fest/master`, gated on `can_edit_fest()` (via the cached `useCanEditFest()`).
4. `FestStatus` — the phase-aware focal block (§5).
5. `FestRsvp` — the fest attendance card (§10).
6. `FestDuesCallout` — planning phase only; its subtitle is `duesSummary(dues)`, which prefers the Adult tier with a set amount ("$100 / adult"), else the first priced tier ("$50 · Kid"), else "Tap to see amounts" — never a bare "$0".
7. `FestCommitteesLink` — live phase only.
8. `FestWeek` — the whole week (§6).

The sub-nav (`FamilyFestNav`) is **Overview · Dinners · Pay**. There is deliberately **no Schedule pill** — the Overview already renders the full week, so a Schedule tab showed the same accordion twice. The `/family-fest/schedule` **index** route still exists for direct links but nothing points at it. ⚠️ Don't read that as "no schedule detail screen either": `/family-fest/schedule/{id}` (`FestScheduleDetail`) is very much live and actively linked — it is the tap-through target for change notifications (§13) and for a Home call-out's linked sign-up (`home_callouts.signup_item_id`). See §6. The nav hides itself on `/family-fest/planner` and `/family-fest/master`. On iOS this is a segmented control or three tabs inside the fest tab; the web uses a `matchedGeometryEffect`-style gliding pill (`layoutId="ff-nav-pill"`) which maps 1:1 to SwiftUI's `matchedGeometryEffect`.

---

#### 5. "Happening today" (`FestStatus`)

Phase-switched, and it is the single most-looked-at view of the year.

**`live`** — a header card (`Happening today` / `Day {dayNumber} of {totalDays}` / "Everything you need for today, right here.") followed by **today's events and tonight's dinner merged into ONE time-ordered timeline** via `dayTimeline(events, dinner)` in `lib/schedule.ts`. The merge matters: a 5:30 dinner sorts *before* a 6:30 event instead of being pinned to the bottom. Sorting is by `timeToMinutes()`, and an unset/unparseable time returns `+Infinity` so TBD items sort last, stably (ties keep events before the dinner).

Each `TodayEvent` card is **fully expanded, no tap** — emoji, title, `formatEventTime(e)` + `–end`, `📍 location` (guest-masked), description, `🎒 Bring:`, link buttons, the sign-up slots card when `signupEnabled`, the tournament section when `tournamentEnabled`, then a contact row (labelled `In charge`) with the lead's name and tap-to-call `tel:` / tap-to-text `sms:` buttons. `TodayDinner` is the same shape: `Dinner · {title}`, served time, `📍 location · prep starts {prepTime}`, the menu, `Head chef` contact.

⚠️ **Anytime events are excluded from "today"**: `eventsForDay(events, today).filter(e => !e.anytime)`. Miss this filter and the scavenger hunt shows up on all seven days.

Empty state: "Nothing scheduled today — enjoy the lake! 🛶" — shown only when there are no events *and* no dinner.

**`wrap`** — "That's a wrap / Thanks for a great week 🎆" and a CTA into the shared downloadable Family Fest album at `/drop?box=0000fe57-2026-4000-8000-000000000001` (`FEST_ALBUM_BOX_ID`/`FEST_ALBUM_HREF` in `lib/data.ts`). ⚠️ This used to point at the Feed; it now points at the Drop Box, which iOS does not have yet — coordinate with that section, and until Drop Boxes ship on iOS, point the wrap CTA somewhere real rather than a dead link.

**`off-season` / `planning`** — a live `Countdown` (days/hrs/min, targeting `startDate` at `T15:00:00`, ticking every second; static when a demo date is set) plus, during planning only and only for a non-member, a "🙋 Want to help plan? Join the Family Fest committee" row.

⚠️ **The countdown's zero state:** at `diff == 0` it swaps to "🎉 Family Fest is on — welcome Up North!", and before the first tick it renders `——` placeholders rather than a fake `00`. Keep both; a flash of "00 days" reads as a bug.

**Where iOS can beat the web app:** this screen is the one people open twenty times a day on weak lake wifi. Make it render **entirely from a local cache** with a staleness pill ("as of 8:12 AM") rather than a spinner, and drive a **Live Activity** for the next item (§11). Native haptics on the tap-to-call, `Link`/`ContactCard` presentation instead of a bare `tel:` hop, and `MapKit` "open in Maps" on the location line are all free wins the browser cannot match.

---

#### 6. The week (`FestWeek`)

Two blocks:

**"🗺️ Anytime all week"** — every item with `anytime = true`, rendered with the same `EventRow` as a dated event.

**"The whole week"** — one card per distinct day, where the day list is `Array.from(new Set([...dayEvents.map(e => e.day), ...dinners.map(d => d.day)])).sort()`. Note this is **days that have content**, not the full config window — a day with nothing on it does not get a card. (The full window, `eventDays(startDate, endDate)`, is a *separate* list used only to populate the editors' day pickers. Keep the two distinct; the web comment calls this out explicitly.) Inside each day card, the same `dayTimeline` merge as above.

Each row is collapsed to `emoji · title · formatEventTime(...)` with a chevron and **expands in place** — there is no drill-in for the normal path. Expanded content: the edit pill (if permitted), cover photo, `📍 location`, description, "What to bring", link buttons, sign-up slots, tournament, and "In charge" with the lead's name (`PrivateName`) and call/text buttons. `DinnerRow` expands to: "On the menu", a 2-up tile grid of **Served** (time + location) and **Crew preps** (prep time + prep location, falling back to the served location), "Houses on crew" as chips, and "Head chef of the day" with contact.

**There IS a drill-in, just not on the normal path — and iOS needs it.** `/family-fest/schedule/{id}` renders `FestScheduleDetail`: an "Anytime all week"-or-`formatDateLong(day)` + `formatEventTime` header, title, guest-masked `📍 location`, description, the sign-up slots card, the tournament section, and lead contact, with `canManage = canEditFest() || lead/crew match` (cached under `canEditFest.{uid}`) and a graceful "This event isn't on the schedule anymore." when the id resolves to nothing. Nothing in the *nav* points at it, but two things push people straight there: a change-notify send (§13) sets its url to `/family-fest/schedule/{scheduleItemId}`, and a Home call-out linked via `home_callouts.signup_item_id` links there too. Without an iOS destination for that path, every one of those taps dead-ends. (The `dinners/[id]` sibling, `FestDinnerDetail`, is the same idea for dinners and additionally carries full edit-in-place; it is no longer linked from anywhere in-app but still resolves.)

⚠️ **Today stays in the week list during the live week.** It used to be omitted on the theory that `FestStatus` covered it — which meant losing today's row *and its edit affordance* from the list entirely. Do not re-introduce that.

⚠️ **Mount the tournament section only while the row is open.** The web comment: *"Expander keeps its children in the DOM, and we don't want a realtime channel per row."* The SwiftUI analogue is real — a `DisclosureGroup`'s content is not built while collapsed, but if you use a `ZStack`/opacity trick or `.onAppear`-driven subscriptions you will open one Realtime channel per event row on a seven-day schedule.

---

#### 7. Anytime events — and the `fest_activities` migration iOS owes

This is the one place iOS is knowingly behind in a way that causes **live data drift**, and the parity backlog flags it in **`docs/ios-parity-2026-08.md` §3** ("Anytime events (0139, 0141) — `fest_activities` is retired on web … ⚠️ iOS still reads `fest_activities`, which is why the table still exists"). ⚠️ Don't go looking in `docs/ios-parity-2026-07.md` — that doc's backend delta stops at migration 0128, so 0139/0141 aren't in it at all.

History: `fest_activities` (0053) was a separate "things to do with no set time" concept — the scavenger hunt, merch. 0110 gave it lead/crew. 0139 added `fest_schedule_items.anytime boolean not null default false` — modelled as a **flag, not a nullable `day`**, precisely so the `NOT NULL date day` column and every date formatter stay safe. Then **0141 converted every `fest_activities` row into an anytime `fest_schedule_items` row**, carrying its sign-up config, slots and signups, with provenance columns (`fest_schedule_items.source_activity_id`, `fest_schedule_slots.source_activity_slot_id`, `fest_schedule_signups.source_activity_signup_id`) making the conversion idempotent. The web's Anytime-activities editor and `ActivityCard` are **gone from the UI** — you create everything through the event editor with the anytime toggle. ⚠️ *Gone from the UI, not deleted from the repo*: `ActivityEditor`/`ActivitySheet` are still in `FestPlanner.tsx`, `ActivityDetailsEditSheet.tsx` still exists, and `festContent.ts` still exports `fetchActivityDrafts`/`saveActivity`/`updateActivityDetails` — but the Planner's `Section` type and `SECTIONS` array have no `activities` entry and neither the tabs nor the page variant renders them. Don't port dead code you found by grepping.

⚠️⚠️ **The `fest_activities` table and rows were deliberately NOT dropped, solely because the iOS app still reads them for its own Anytime section — so right now a web edit to a converted event does not reflect on the untouched activity row, and the two silently diverge.** `fetchFestContent` still returns `activities` and nothing on web renders it. **iOS switching its Anytime section to `fest_schedule_items where anytime = true` is what finally lets that table be dropped.** Do this early; it is small and it stops a class of "the app shows the wrong scavenger-hunt instructions" reports. When you do: match by `source_activity_id` if you need to reconcile any iOS-local state, and note that 0141 folded `blurb` + `details` into the event's single `description` with `concat_ws(E'\n\n', …)`, so an old two-field iOS layout becomes one body field.

⚠️ **An anytime item still has a `day` value** — 0141 parked it on `current_date`, and an anytime event created in the Planner just keeps whatever the day `<select>` held — so never display or group on `day` when `anytime` is true. `formatEventTime` encodes the whole nuance: no start time + not anytime → `"TBD"` (someone still needs to pin it down); no start time + anytime + sign-ups on in a non-headcount mode → `"Specific time slots"` (the times live in the sign-up card); no start time + anytime otherwise → `"No specific time"`. Three different strings for three different truths — port all three.

---

#### 8. Chef/crew self-edit vs full committee editing

Two distinct edit surfaces, both reachable from wherever the item already renders (`FestWeek`'s rows, `FestStatus`'s today cards, the Dinners index, the standalone dinner detail). The rule, computed identically in every one of those places:

```
canEditThis = canEditAll || (uid != nil && (item.leadUserId == uid || item.crewUserIds.contains(uid)))
              // dinners: chefUserId instead of leadUserId
fullEdit    = canEditAll && draft != nil
```

**Narrow self-edit** — for the person actually running that one thing, who need not be on the committee:

- `updateDinnerDetails(id, {menu, servedTime, servedLocation, prepTime, prepLocation})` → a **partial** `update` on `fest_dinners` of exactly those five columns plus `updated_at`/`updated_by`. Day, title, emoji, chef, crew and houses stay committee-managed.
- `updateScheduleDetails(id, {location, description, bring, links})` → partial `update` on `fest_schedule_items`. Day, title, time, private, lead and crew stay committee-managed.
- `updateActivityDetails(id, {blurb, details, location})` → the `fest_activities` equivalent (obsolete once you migrate off that table).

⚠️ **These must be partial updates, not "save the whole model".** The web comment on `updateDinnerDetails` spells out why: it deliberately does *not* go through `writeRow`/`saveDinner`, *"which always write every `DinnerInput` field and would clobber fields this surface never touches, e.g. `position`."* In Swift this is the difference between `PATCH` with a small dictionary and encoding your full `struct` — encode a dictionary (or a dedicated `Encodable` with only those keys). A Codable round-trip of the full row from a screen that never loaded `position` will write `position = 0` and reorder the schedule.

**Full editing in place** — a `can_edit_fest()` viewer gets the **Planner's own sheets** (`ScheduleSheet`, `DinnerSheet`, exported from `FestPlanner.tsx` for exactly this) opened inline from the row, so an admin can change a dinner's chef, crew, houses, day and title without a trip to the Planner. Those sheets need the full **draft** row (which carries `position`, `isPrivate` and the lead links that the display model drops) plus the member directory, so `FestWeek`/`FestStatus`/the Dinners index each fetch `fetchScheduleDrafts()` / `fetchDinnerDrafts()` / `fetchMemberOptions()` themselves — but **only once `canEditFest()` resolves true**, so a chef/crew self-editor or an ordinary member never pays for those three round-trips. Port that gating; it is three extra requests on the highest-traffic screen of the year.

⚠️⚠️ **The self-edit scope is NOT enforced server-side — this is the one place a backend change is genuinely warranted.** Postgres RLS is **row**-level, not column-level. The 0099/0110 policies say "this row is updatable by its chef/lead/crew" — they say nothing about *which columns*. Their `with check` blocks exactly one abuse (handing your own row's `lead_user_id`/`crew_user_ids` to someone else, which would fail the post-update predicate) and nothing else. So a lead or crew member with a REST client can still change their event's `day`, `title`, `location`, `is_private`, or `position`, and a chef can rewrite any of their dinner's columns. On web this is invisible because the UI only ever hands them the narrow sheet; **on iOS the same is true only if you are equally disciplined.** Never show the full sheet to someone whose `canEditAll` is false. If you want it actually enforced, the fix is a `SECURITY DEFINER` RPC per surface (e.g. `update_dinner_details(p_id, p_menu, p_served_time, p_served_location, p_prep_time, p_prep_location)`) gated on the same predicate, and dropping the broad `for update` policies — a real migration, not something to invent client-side. Flag it to Brian; don't ship a hardening migration unilaterally.

---

#### 9. The denormalized lead/chef name (migration 0113) — render the snapshot

Each fest row stores a **display-name snapshot** next to the real link: `fest_schedule_items.lead_name` ← `lead_user_id`, `fest_activities.lead_name` ← `lead_user_id`, `fest_dinners.chef_name` ← `chef_user_id`. The snapshot is stamped from `profiles.display_name` at assignment time, and **it is the stored copy the public cards render.**

The bug this fixed: a brand-new member assigned while their display name was still the email prefix (`motu42`), who later set it to `Mikey 😀`, kept showing `motu42` on the card forever — even though "Edit event" resolved the live profile via `*_user_id`. Migration 0113 adds:

```sql
create trigger sync_fest_lead_names_trg
  after update of display_name on public.profiles
  for each row execute function public.sync_fest_lead_names();
```

`sync_fest_lead_names()` rewrites the stored name on every fest row that person leads or cooks, **matched by `*_user_id`, never by the free-text name** (so an account-less lead is untouched), and skips a blank incoming name so a card is never wiped to nothing. Plus a one-time backfill for names that already drifted. It fixed web and iOS at once because both read the same columns — **no client change was needed, and none is needed now.**

⚠️ **So: render `lead_name` / `chef_name`, not a name you resolve from `profiles` yourself.** Joining to `profiles` for the display name would (a) diverge from web for an account-less lead, whose name exists *only* in the snapshot column, and (b) cost a join for something a trigger already keeps fresh. Use `*_user_id` **only** for the "is this me?" edit check — never a name match. The web mapper encodes both halves: `lead: r.lead_name?.trim() ? {name, phone} : undefined` (an empty snapshot means "no lead", not "unknown lead") and `leadUserId: r.lead_user_id` carried separately.

Dinners differ slightly: `mapDinner` coerces a missing chef to `{name: "TBD"}` so the card always has a chef line, while a missing event lead renders no "In charge" block at all.

---

#### 10. RSVP, the dues calculator, and Pay

**`FestRsvp`** — the Family Fest attendance card, scoped to the **synthesized** event id `"family-fest-2026"`. ⚠️ Family Fest is deliberately not a row in `events`; the row is synthesized in `RESORT_EVENTS` (`lib/data.ts`) **from the `FAMILY_FEST` constant — NOT from `fest_config`.** Two consequences: (a) this card's window is the drifted constant one (Jul 26 – Aug 1), so on web the RSVP card vanishes a day *before* `FestStatus` flips to live — if iOS reads `fest_config` everywhere (and it should), expect a deliberate, visible difference from web here and say so rather than "fixing" it silently; (b) `fetchEvents` lets a real DB `events` row with slug `family-fest-2026` override the seed (`RESORT_EVENTS.filter(e => !e.slug || !dbSlugs.has(e.slug))`), so "not a row in `events`" is true today, not guaranteed. Going / Can't-make only — **no Maybe** (`hideMaybe`) — plus a horizontally scrolling per-day strip showing each day's going count, tapping through to the shared `EventSheet` day picker. Once you're going and there is more than one day, the card **collapses** to "You're in for Family Fest ✅" + "Here Mon, Tue" / "You're here all week", with a "Change ›" to re-expand. ⚠️ It returns nothing at all once `isLive || isWrap` — *"keeping this card around post-start would just be a stale 'are you coming?' nag during/after the thing you're already at."* ⚠️ And `event_attendance` is not publicly readable — 0081 locked it to members and **0183 tightened it further to `is_approved_member()`** — so a guest *and* a signed-in-but-unverified member both read zero rows. Show "🔒 Sign in to see who's coming" for a guest and the same kind of nudge (not a false "No RSVPs yet") for an unverified member, who per §1 *can* still see the whole schedule. Attendance mechanics themselves belong to the events section.

**`FestDuesCalculator`** — a `+`/`−` stepper per tier instead of a price list, which auto-fills the Pay screen's Amount and Note (and therefore the Venmo deep link) so "2 adults" needs no mental arithmetic. Two groups:

- **flat tiers** (`per_day = false`): `count × amount`
- **per-day tiers** (`per_day = true`, migration 0078): all of them share **one** "Number of days" stepper — `count × amount × days` — because a single payment assumes everyone in it is here the same span. A household with mixed day-counts runs the calculator once per group and taps Pay twice; **Reset** clears it.

`maxDays = max(1, getFestSeason(config.startDate, config.endDate).totalDays)` — so the day stepper cannot exceed the fest's actual length, which is another reason the season function has to be right. Steppers clamp counts to `0…99` and the day stepper to `1…maxDays`. The per-day block only renders when at least one per-day tier has a non-nil amount (`dailyHasPricing`), and a tier with a nil amount renders "TBD" **with no stepper at all** — you cannot add a quantity of an unpriced tier. The generated note is `"{noteLabel} — 2 Adult (high school & up); 3 days: 1 Per day"`, and `noteLabel`/`title` are props so the same component can serve a non-fest dues screen.

**`PayView`** — Amount + Note are **controlled by the parent** specifically so the calculator can drive them; typing directly still works. Per payee: a Venmo button (`https://venmo.com/{handle}?txn=pay&amount=&note=`, URL-encoded), a PayPal button (`https://paypal.me/{handle}[/{amount}]`, **only when the handle is not an email** — there is no pay-by-email deep link), and copy-to-clipboard rows for Zelle, Apple Cash, and an email-style PayPal handle. Brand colors are tokenized (`--color-venmo #3d95ce`, `--color-paypal #003087`). **No payment credentials live in the app** — every path hands off to the user's own app. The whole screen is inside a `SignInWall` ("Payment details … are kept private").

**Where iOS can beat the web app:** the Venmo/PayPal hop is a `UIApplication.open` to a *native app* if installed (`venmo://` deep links, with the https URL as the universal-link fallback) instead of a browser bounce; the copy rows get real haptics and a `UIMenu` "Copy / Share"; and the whole payee card can carry a rendered **Venmo QR** the way `MemberSheet` already does on web (`PayQRCode`, generated on-device with the `qrcode` package — never send a handle to a third-party QR API; note `PayView` itself does *not* show one today, so this is net-new, not parity). ⚠️ Remember `fest_payees` is public at the DB level, so **iOS must implement its own signed-in gate** on this screen.

---

#### 11. Where iOS genuinely beats the web app

Not padding — these are the four that matter for this specific week.

**Offline-first schedule (the big one).** Lake wifi is weak and cell coverage five miles out of Tomahawk is worse. The web already leans hard on a stale-while-revalidate cache (`lib/swrCache.ts`, key `festContent`, persisted to `localStorage`, 24h TTL) precisely so the fest hub paints instantly, and it seeds from an in-code copy of the schedule so *"the page never breaks pre-migration or offline."* iOS can do the thing a browser cannot: persist the whole bundle (config + schedule + dinners + dues + payees, plus the cover and any event photos) to disk on every successful fetch, render from it unconditionally at launch, and revalidate in the background — so the fest hub is **fully functional in airplane mode**, including phone numbers for every lead and chef. Pre-warm it during the `planning` phase (a `BGAppRefreshTask` in the 60 days before) so the cache is already full when someone drives up and loses signal. Show a quiet "last updated" line instead of a spinner; never block the schedule on the network.

**Live Activity + widget for "today at the fest".** During `live`, the single most valuable pixel in the family's day is "what's next and where". A Live Activity (ActivityKit) on the Lock Screen showing *Day 3 of 7 · next: 🍽️ Dinner · Thursday Dinner · 6:00 PM · Main Lodge*, updated from the same merged `dayTimeline`, is strictly better than opening a browser tab. Start it when `phase` flips to `live`, end it at `wrap`. Pair it with a Home Screen / Lock Screen widget (WidgetKit, timeline entries derived from today's items — a `TimelineProvider` with one entry per item start, so it advances with no refresh budget spent) and a countdown widget during `planning` that mirrors `Countdown`. ⚠️ Feed both from the shared on-disk cache in an App Group container, not a network call — a widget refresh on bad wifi that fails should show the cached schedule, not "unable to load".

**Calendar integration.** "Add the whole week to my calendar" is a one-tap `EventKit` write of every `fest_schedule_items` row (plus each dinner) as events in a dedicated *Family Fest 2026* calendar, with the location, the description, the "what to bring" as a note, and the lead's phone in the URL/notes. Alarms 30 minutes before. Then the family gets fest reminders through the OS they already trust, and a schedule change can update the existing events in place (store the `EKEvent` identifiers keyed by fest row id). The web cannot do this at all — its equivalent is a planned ICS feed that was never built (`lib/events.ts` `fetchGcalEvents()` still returns `[]`).

**Contacts, maps, and haptics.** Every lead/chef contact row is a `tel:`/`sms:` anchor on web. Natively: a contact sheet with "Add to Contacts", `CNContactViewController`, or a direct `CallKit`-adjacent hand-off; `📍 location` becomes an `MKMapItem.openInMaps` or an inline `Map` snapshot; the "Edit this dinner" pill gets `.sensoryFeedback(.success)` on save. Also: a **Shortcuts / App Intent** — "Hey Siri, what's happening at the fest today?" — reading straight off the cached timeline, and **Handoff** from the phone's schedule row to the master editor on a Mac for a committee member doing bulk edits.

---

#### 12. The Planner (`FestPlanner`) — the big one, with a v1 cut

`FestPlanner` is 99KB / ~2,530 lines of TSX and it is by far the largest thing in this section. Two variants from one component: `variant="tabs"` (`/family-fest/planner` — a pill nav across **Schedule · Dinners · Dues · Payees · Images · Details**, one section at a time) and `variant="page"` (`/family-fest/master` — every section stacked in one full-window document, "edit one master sheet", which is what the iOS "full editor on the web" link opens today). *(Home call-out editing used to live here and has moved to Admin → Alerts & Notifications; don't re-add it to the fest Planner.)*

Structure per section: an `AddButton` ("＋ Add an event"), a list of `RowCard`s (title / subtitle / Edit / 🗑 with a `window.confirm`), and a bottom sheet editor. The sheets:

- **`ScheduleSheet`** — grouped as *What & when* (emoji + title; an "Anytime (no set day)" checkbox that reveals/hides the day `<select>`; a "Set a time" checkbox revealing start/end; location), *Who's running it* (`LeadPicker` — link a real member **or** type a name for someone not in the app, plus an optional phone for tap-to-call; and a "Crew members" multi-picker whose members *also get editing rights*), *More details* (description, what to bring, a cover photo uploaded to the `site-assets` bucket, and a multi-link editor), the whole `SignupConfigEditor` block, and *Advanced* (the change-notify block, and the `Private` checkbox).
- **`DinnerSheet`** — day, emoji + title (auto-defaulted to `"{Weekday} Dinner"` when the title is blank and a day is picked), `LeadPicker` for head chef, the crew multi-picker, "Houses on crew (comma-separated)" **free text — house *names*, not member ids** (`houses.split(",").map(trim).filter(Boolean)`), menu, served time+location, prep time+location, change-notify.
- **`DuesSheet`** — label, amount (digits only → `parseInt`, blank = TBD/null), note, and a "Billed per day (multiply by days attending)" checkbox.
- **`PayeeSheet`** — name, role/label, Venmo (username, no `@`), Zelle, Apple Cash, PayPal, note.
- **`DetailsEditor`** — `fest_config` name, tagline, start, end. Validates `endDate >= startDate` and warns *"Changing the dates reshapes the week — the day pickers and countdown follow these."* Saves via **upsert on `fest_year`** (`{ onConflict: "fest_year" }`) so there is exactly one row.
- **`ImagesEditor`** — two keys today: `home_logo` and `fest_cover`, each with upload / reset-to-built-in.
- **`MemberPickerSheet`** (searchable single-pick, exported and reused by the sign-up slots UI and the notification test tool) and **`CrewPickerSheet`** (the multi-select sibling; toggle rows with a ✓ and a Done button — *not* exported).

Insert vs update is decided by presence of `id` (`writeRow`: `id` present → `update … eq("id", id)`, else `insert … select("id").single()` and **return the new uuid** so a caller can attach child rows to a just-created parent — that is how staged sign-up slots get flushed after the first save).

⚠️ **`updated_by` must come from the LOCAL session, never a network user lookup.** The web comment on `currentUid()` is a bug report: *"Read the uid from the LOCAL session, not `auth.getUser()` — `getUser()` makes a network round-trip to the auth server that can stall on a flaky/blocked mobile connection, hanging every fest write (the 'Saving…' button never resolves) even though reads work off the cached session."* In Swift: read `supabase.auth.currentSession?.user.id` synchronously; never `await supabase.auth.user()` on the write path. `updated_by` is an audit stamp — RLS is the real gate — so a nil is fine and a hang is not.

⚠️ **`is_private` is a DEAD SWITCH.** The Planner writes it, `fetchScheduleDrafts` reads it back, and **`mapSchedule` never maps it into the display model — nothing on web reads it for display.** (grep: the only consumers of `isPrivate`/`is_private` in the whole repo are `FestPlanner`'s checkbox, the `ScheduleInput` write, and the draft fetcher.) Guest masking comes from `Protected`/`PrivateName` applied *unconditionally* to locations and contacts. So do not build guest-hiding logic off `is_private` on iOS and assume it matches web; either mirror web (unconditional masking for guests, keep the column round-tripping so an admin's setting isn't lost) or raise it with Brian as a decision. Silently making the toggle *work* on iOS but not web is a drift you will pay for.

**Suggested v1 cut.** Ship, in order: **(1) every read surface** (hub, today, week, anytime, dinners, event/dinner detail, dues calculator, pay) — that is what 40 family members use; **(2) the two narrow self-edit sheets** (`updateDinnerDetails` / `updateScheduleDetails`) — small, and it is what chefs and event leads need on their feet during the week; **(3) `DetailsEditor` + `DuesSheet` + `PayeeSheet`** — three tiny forms, and they unblock a committee member setting prices without a laptop; **(4) `DinnerSheet`** and **(5) `ScheduleSheet`** last, since they are the biggest and the master editor on the web already covers them. **Do not port the `variant="page"` master editor to iOS at all** — it exists to break out of the phone column for bulk desktop editing. Keep the existing behavior: a "full editor" link that hands the session to the web `/family-fest/master`.

⚠️ **That hand-off already exists and iOS must keep it working.** `FestPlanner` reads `#mlr_at=…&mlr_rt=…` out of the URL fragment, calls `supabase.auth.setSession({access_token, refresh_token})`, and `history.replaceState`s the tokens out of the URL — so an iOS member opening the master editor is not asked to sign in twice. It also holds a `handoff` flag so it shows "Checking access…" instead of flashing the sign-in prompt while the session lands. If iOS changes how it opens that link, this breaks silently into "the website says I'm not signed in".

---

#### 13. "📣 Notify about this change"

Both `ScheduleSheet` and `DinnerSheet` mount `ChangeNotifyEditor` when `isAdmin && draft` (editing an existing item only). Toggling it on prefills the message via `changeMessageDefault(title, time)` → `"{title} is now at 6:00 PM"` or `"Update: {title}"`, then offers three independent channels — **📣 Banner + push** (on by default), **🔔 Activity tab** (on by default), **✉️ Email** (off). It sends **after** the save succeeds, via `sendActivityNotify()` in `lib/activityNotify.ts`, which reuses the existing broadcast primitives — no new backend:

- Activity tab → `send_broadcast_notification(p_title, p_body, p_url, p_audience, p_expires_at, p_event_id, p_exclude_not_attending)` with `p_audience = 'everyone'`, `p_event_id = 'family-fest-2026'`, `p_exclude_not_attending = true`.
- Banner and/or Email → one `insert` into `announcements` with `{author_id, title, body, severity: 'alert', notify_email, expires_at, show_banner, email_audience, event_id, exclude_not_attending}`. `show_banner = false` + `notify_email = true` is **email-only, no banner and no push**.
- The tap-through url is `/family-fest/schedule/{scheduleItemId}` (or `/family-fest` — which is what `DinnerSheet` sends, since it passes no item id), and the banner default lifetime is **3 hours** — a time-change notice should not still be at the top of the app tomorrow. ⚠️ That url means iOS needs a real destination for `/family-fest/schedule/{id}` (§6) or every one of these notifications dead-ends on tap.

⚠️ Targeting only ever *hides* the notice from someone who explicitly RSVP'd "Can't make it"; a no-response member still gets it (they might still come). ⚠️ A send failure returns `"Saved — but the notification didn't send: …"` and **blocks the sheet from closing without undoing the already-saved edit**, so the admin can retry the send. Mirror that: never roll back a successful content save because a notification failed.

---

#### 14. Demo date ("see the app as if it's this day")

`DemoDateProvider` is a device-local ISO-date override in `localStorage` (`mlr-demo-date`) set from Profile. When set, `now = new Date("{demoDate}T12:00:00")` (noon, so timezone slop can't shift the day) and every season computation, "today" filter and the countdown behave as if it were that date; the countdown goes **static** rather than ticking. With no override it refreshes hourly so a long-open tab rolls over days.

This is the only practical way to test the four phases without waiting a year, so **port it** — `UserDefaults`-backed, exposed in Settings, and threaded through the same `FestSeason` publisher so a phase change is observable. ⚠️ It must be strictly device-local and must never be sent to the server; a demo date that leaks into a write would stamp a fake day on a schedule row.

---

#### 15. What to audit in the iOS repo (verify each — the iOS source is not on this machine)

iOS has a `Tabs/FamilyFestTab/`, a `FestContentService` with the same seed-fallback model, `FestDinnersView`, a `FamilyFestPlannerView`, and per `docs/ios-parity-2026-07.md` the Cinzel font and the fest theme foundation. That is **not** the same as parity. Check each of these against the iOS repo:

1. **Anytime section still reads `fest_activities`** — confirmed drift, highest priority (§7).
2. **Season phases** — are all four implemented, with `isSoon`, `dayNumber`, `totalDays`, `wrapDaysLeft`? Is `PLANNING_LEAD_DAYS = 60` / `WRAP_TAIL_DAYS = 14`? Is it **recomputed** on foreground/day-change, or evaluated once at launch?
3. **Dates read from `fest_config`**, or from a bundled constant that has already drifted (§2)?
4. **`dayTimeline` merge** — do today's events and the dinner interleave by time, or is the dinner pinned last?
5. **The `formatEventTime` three-way string** — "TBD" vs "No specific time" vs "Specific time slots".
6. **`crew_user_ids`** on schedule items and dinners (0099/0110) — decoded at all? The `canEditThis` check requires it.
7. **`links` jsonb array** (0142) — or is iOS still reading the dropped `link_url`/`link_label` columns? Those **no longer exist**; a select naming them fails the whole request.
8. **`image_url`** cover photos on events (0134) — rendered? (They resolve to Supabase `site-assets`, so no media-token signing is involved — see §16.)
9. **`anytime`** (0139) — is it excluded from day lists *and* from "today"?
10. **`tournament_enabled`** / **`signup_*`** — the sign-up slots and tournament sections are separate features with no iOS parity yet; the *columns* still need decoding so the cards can gate on them.
11. **`signup_hide_names`** (0167) — a hidden roster leaking on iOS would be a real privacy regression.
12. **`per_day`** dues (0078) and the shared day-count stepper — or does iOS multiply per-day tiers as flat amounts?
13. **`lead_name`/`chef_name` snapshots rendered** (not a `profiles` join) — §9.
14. **Partial-update writes** for the self-edit sheets, not full-model saves — §8.
15. **Pay screen behind a sign-in gate** (RLS won't do it) — §10.
16. **`can_edit_fest()` cached/seeded** so Edit affordances don't pop in late; web persists it under `canEditFest.{uid}`.
17. **`app_images['fest_cover']`** honored, with the three-step fallback.
18. **The change-notify block** on the editors (§13) and the **iOS→web session hand-off** for the master editor (§12).
19. **The wrap-phase CTA** — does it point at the Drop Box album (`FEST_ALBUM_BOX_ID = 0000fe57-2026-4000-8000-000000000001`) or the old Feed target?
20. **`FestRsvp` hides during live/wrap**, no Maybe, guest sign-in nudge instead of zero counts — and the same nudge for a signed-in-but-unverified member (0183).
21. **The event drill-in** (`/family-fest/schedule/[id]` → `FestScheduleDetail`) — is there a screen for it, and does a change-notify push or a Home call-out's linked sign-up actually land somewhere? A dead deep link is the failure mode (§6, §13).

---

#### 16. ⚠️ Hard-won lessons — put every one of these in the code comments and iOS CLAUDE.md

These are the lines worth more than the schema.

⚠️⚠️ **NEVER parse a bare `"YYYY-MM-DD"` as a timestamp.** `new Date("2026-07-31")` is UTC midnight, which renders as **July 30** in Central. This produced two separate incidents: (a) every sign-up slot in the entire fest UI was **labeled a day early** — the Planner's day dropdown, the slot list, the schedule labels, all self-consistently wrong (weekday *and* date both said Thursday the 30th), and nothing revealed it until the server-side reminder fired off the real stored date; and (b) **the stored data was corrupted by the same bug**, because the broken label was feeding a `<select>` whose `value` was the true ISO day — picking the option that read "Thu, Jul 30" persisted `2026-07-31`. Ten rows had to be corrected by hand with `update fest_schedule_slots set day = (day::date - 1)::text where day is not null`. **Swift equivalent:** `ISO8601DateFormatter` with `.withFullDate` parses as UTC and will do exactly this. Use a `DateFormatter` with `dateFormat = "yyyy-MM-dd"`, `locale = Locale(identifier: "en_US_POSIX")`, and an explicit `timeZone` — and better still, **keep the day as a `String` and compare/group on the string**, the way `eventsForDay`/`dinnerForDay`/the day-card grouping all do. The two takeaways: *never hand a bare `YYYY-MM-DD` to a timestamp parser*, and *a display bug in a PICKER silently corrupts the data it writes* — when you fix a date-formatting bug, always check whether the bad label was also feeding a form.

⚠️⚠️ **The season phase must be computed from a live "now", never once.** A build-time evaluation freezes the phase at ship time; a launch-once evaluation freezes it for however long the app stays resident, which during fest week is days (§2).

⚠️⚠️ **The chef/crew self-edit narrowness is UI-only.** RLS is row-level; the 0099/0110 `with check` stops only a lead/crew member from handing their own row away, not from rewriting `day`, `title`, `location`, `is_private` or `position` on it. Never hand the full editor to someone whose `can_edit_fest()` is false (§8).

⚠️ **`fest_payees` is public-read.** The Pay screen's privacy is a client-side gate on both platforms. Forget it on iOS and payment handles ship to anonymous clients (§1).

⚠️ **`is_private` on `fest_schedule_items` is written but never read.** Don't build behavior on it without a decision (§12).

⚠️ **An empty fest table means "fall back to the seed"; an empty `home_callouts` means "no call-outs".** The web is deliberately asymmetric here — `fetchFestContent` keeps the in-code seed for schedule/dinners/payees/dues/activities on an empty result *so the page is never blank*, but call-outs degrade **only on error**, because *"the seed must not resurrect a card an editor deliberately deleted."* Copy both halves; getting it backwards either blanks the hub or resurrects deleted content.

⚠️ **`updated_by` from the cached session, never a network user fetch** — a flaky connection otherwise hangs every save forever (§12).

⚠️ **Partial updates from the narrow sheets** — a full-model save clobbers `position` and reorders the schedule (§8).

⚠️ **`can_edit_fest()` is `authenticated`-only and takes no params.** An anon call errors; treat any error as `false`. And it resolves against `committee_roster.linked_user_id` (0057), *not* `committee_members` — 0053's version is stale, and CLAUDE.md's "committee membership" wording is loose.

⚠️ **Never recreate a fest SQL function from an old migration's body.** This codebase has been bitten twice — `moderate_content_text()` (0128 recreated it from 0040 and silently dropped 0044's whole-word fix) and `run_signup_reminders()` (0168 explicitly recreates from the *current production* definition, not 0140's). If you ever touch `can_edit_fest()` or `sync_fest_lead_names()`, start from the live definition in `pg_proc`, not a file.

⚠️ **Enabling RLS with zero policies is not securing a table, it is deleting it from the client's point of view.** `committee_areas` was invisible to every client for weeks because RLS was switched on in the dashboard with no read policy (fixed by 0170) — and the codebase's seed-fallback idiom (used all over this section) *disguised it as normal empty-but-working behavior*. If a fest list reads empty but writes seem to succeed, check `pg_policies` before anything else.

⚠️ **Times are free text.** `start_time`, `end_time`, `served_time`, `prep_time` are `text` columns, not `time` — live values include `"18:00"`, `"6:00 PM"`, and `"TBD"`. Parse both formats defensively (the web's module-private `parseTimeParts` handles 24h and 12h and returns null otherwise), show an unparseable value **back as typed** rather than "Invalid Date", and treat empty as "TBD". Sorting uses `+Infinity` for unset so TBD items land last.

⚠️ **`day` is NOT NULL even for anytime items** and holds a meaningless parked value — never display it (§7).

⚠️ **Don't open a Realtime channel per schedule row.** Seven days of events with a tournament section each is a channel storm (§6).

⚠️ **Media tokens — and the fest is NOT affected, so don't block on this.** `MEDIA_AUTH` on the mini is currently `report`, **not `on`, specifically because the native app cannot sign media URLs yet** — three registered iOS devices across two members would 403 every photo *that lives on the mini*, which is `posts/`, `chat/` and `dropbox/` only. **No fest image is on that list.** An event's `image_url` and an admin-set `app_images['fest_cover']` are uploaded by `uploadSiteImage()` into **Supabase Storage's public `site-assets` bucket**, and `mediaSrc()` returns any non-mini URL untouched (`if (!isMediaUrl(url)) return url`); the one fest path that does resolve to the mini — `FestCover`'s `${MEDIA_URL}/assets/site/family-fest-2026.jpg` fallback — is skipped by `mediaSrc` (`if (url.includes("/assets/")) return url`) and exempted server-side by `media-auth.js`'s `isAlwaysPublic()` (`/assets/` + `/privacy`). CLAUDE.md says it outright: *"Guest-visible imagery is unaffected because none of it is on the mini … the fest cover and callout fliers live in Supabase Storage's `site-assets` bucket."* So fest photos will not break when `MEDIA_AUTH` is promoted to `on`, and nothing in this section waits on the signer. Do still route every image through one `mediaSrc`-equivalent (idempotent, no-op for non-mini URLs) so the *rest* of the app works, and ⚠️ **do not generate a fresh `MEDIA_TOKEN_SECRET` while testing** — the signing key falls back to `SUPABASE_SERVICE_ROLE_KEY`, so setting the secret for the first time is a **key rotation** that 403s every already-issued token.

⚠️ **Don't re-omit today from the week list** during the live week — it takes the row *and its edit button* away (§6).

⚠️ **Only fetch the Planner drafts + member directory once `can_edit_fest()` is true** — three extra round-trips on the busiest screen of the year otherwise (§8).

⚠️ **`houses` is family names, not member ids.** `fest_dinners.houses text[]` says which families are teaming up; `crew_user_ids uuid[]` says who specifically gets edit rights. They are not the same list and the dinners index shows only `houses` (it deliberately omits crew prep time/location — *"only the crew needs that logistics; still editable, just not shown to every reader"*).

⚠️ **`fest_dues.amount` is whole dollars as an `int`, nullable = TBD.** Never render `$0` for nil, and never offer a stepper on an unpriced tier.

⚠️ **`FEST_YEAR` is hardcoded to 2026** in one constant. Make it one constant on iOS too, or derive it (§1).
