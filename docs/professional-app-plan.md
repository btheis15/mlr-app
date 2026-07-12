# MLR App — Professional Polish Plan

*Drafted July 12, 2026 from a full four-track audit of the codebase (UX/UI, security,
bugs/glitches, and admin-capability gaps). This is the roadmap to take the app from
"impressive family project" to "professional app the whole family trusts and enjoys" —
especially the least tech-savvy members.*

**The direction this plan assumes:** MLR is becoming the family's single home base —
the place everyone checks for what's happening, who's up north, photos, and how to
pitch in. That means three things must be true: (1) nothing embarrassing or broken
ever greets a family member, (2) private family info is actually private, and
(3) admins (not AI + a deploy) run the day-to-day content. The phases below are
ordered to deliver those three, then layer on delight.

---

## Phase 0 — Fix what's broken (bugs & glitches)

*Do these first. Every one is a real defect a family member can hit today.
Typecheck currently passes clean; these are runtime/logic issues.*

### P0 bugs (visible, everyday impact)

1. **Deleted chat messages still show as the conversation preview.**
   `components/FeedView.tsx:105-109` (committee) and `:127` (house) — the
   last-message query never filters `deleted_at`. Someone deletes a regrettable
   message; its text keeps sitting in everyone's Chats list. Add
   `.is("deleted_at", null)` to both queries.
2. **Unread badge doesn't clear after reading a chat.**
   `FeedView.tsx:230-236` — summaries only recompute on message INSERT, never on
   read-stamp changes or returning to the list. Recompute on `setActive("list")`
   and/or subscribe to `committee_area_reads` / `house_reads`.
3. **Deleted messages inflate the unread count.**
   `FeedView.tsx:111-113`, `:132-134` — same missing `deleted_at is null` filter
   on the unread count query. Phantom red badges.
4. **RSVP failure is silent.** `lib/hooks.ts:482` — `setAttendance()`'s error is
   ignored; the button highlights, then `reload()` quietly reverts it. Surface an
   inline "Couldn't save — try again" and keep the optimistic state until resolved.
5. **Double-tap RSVP race.** `AttendanceControl.tsx` + `lib/hooks.ts:458-486` —
   no in-flight lock, two rapid taps → two RPCs racing. Add a per-event busy flag.
6. **Guest deep-link to a house chat hangs on a permanent spinner.**
   `FeedView.tsx:88` returns early when `!user`, so `loaded` never flips and the
   boot gate at `:311-315` spins forever on `/posts?house=<slug>`. Fall through
   to the feed / sign-in prompt instead.
7. **Sign-in code copy contradicts itself (6 vs 8 digits).**
   `IdentityProvider.tsx:558` says "8-digit code", placeholder is 8 chars, but
   Verify enables at 6 (`:596`) and CLAUDE.md says 6. Pick the real Supabase OTP
   length, make copy + placeholder + validation + docs agree. This is the single
   most fragile screen for non-technical users.

### P1 bugs

8. **Reaction toggle sticks on fast double-tap** — `PostsView.tsx:488-493` (and
   chats): `current` is read from stale state, so tap-to-remove re-adds. Track
   in-flight reaction state locally.
9. **Half-finished posts** — `PostsView.tsx:428-448`: post insert → media inserts
   → tags are non-transactional; a mid-loop failure shows "Couldn't post" while
   the post is actually live with missing photos. Move to a single
   `create_post(...)` SECURITY DEFINER RPC that inserts post + media + tags
   atomically.
10. **WelcomeIntro can strand a dimmed overlay** — `WelcomeIntro.tsx:122`: the
    close animation runs but unmount depends on the network write; the 440ms
    timeout body is empty (leftover stub). Unmount locally on dismiss regardless
    of the write result.
11. **UTC day-stepping in `eventDays()`** — `lib/events.ts:33` uses
    `toISOString()` to step days; off-by-one for any device in a UTC+ timezone.
    Step with local date math (the file's own comment claims TZ-safety it
    doesn't have).

### P2 polish bugs

12. Expired announcement lingers until an unrelated re-render (`AnnouncementBanner.tsx:89`) — add a minute tick.
13. `mark_area_read`/`mark_house_read` stamp the *admin's* row while in "view as" preview (`CommitteeChat.tsx:312`, `HouseChat.tsx:245`).
14. Countdown flashes `00 / 00 / 00` pre-mount (`Countdown.tsx:25`) — render skeleton digits until `now != null`.
15. @mention substring collision: "Jo" matches inside "@John" (`PostsView.tsx:1123-1127`) — match on word boundaries.
16. Media-only chat preview reads as a bare `"Name: "` (`FeedView.tsx:114-118`) — show "📷 Photo" / "🎬 Video".
17. Blank display names render as generic "Member" in reactor lists/tags — fall back to first name from `full_name`.
18. `window.alert(error.message)` shown to ordinary members in `CommitteeJoin.tsx:129,143` — replace with the app's inline status pattern (admin panels can keep `confirm()` for now).
19. TabBar leaks a one-shot 300ms timer on visibilitychange (`TabBar.tsx:47`).

### Doc drift (fix alongside)

CLAUDE.md is stale in load-bearing places: `FamilyFestNav` + Crew/Photos routes
don't exist, `/activities` and `/dining` routes are gone, `HomeHelpPeople` is
unused (duplicated inside `HomeCommunication`), Home layout description doesn't
match `app/page.tsx`, OTP length says 6. Update CLAUDE.md + README in the same
PR as the fixes — doc drift is this repo's stated failure mode.

---

## Phase 1 — Security & privacy hardening

*The auth/admin model is genuinely solid (no self-grant paths, safe SECURITY
DEFINER RPCs, no XSS/command-injection, no committed secrets). The problem is
that the privacy wall is UI-only: the database itself hands family PII to any
anonymous visitor with the publishable key from the bundle.*

### P0 — RLS lockdown migrations

- **`profiles` is anonymous public-read** (`0001_profiles.sql:26-29`) and has
  accumulated full name, phone, contact email, home address, birthday, and
  Venmo/Zelle/CashApp/PayPal handles. Anyone can `GET /rest/v1/profiles?select=*`.
  Fix: `using (auth.uid() is not null)` at minimum, **plus** a
  `member_directory()` SECURITY DEFINER RPC (or view) that returns only
  display-safe columns to other members and full detail for self/admin — RLS is
  row-level, so column protection needs the view/RPC.
- **Posts, comments, media, reactions, tags, albums, comment-mentions are all
  anonymous public-read** (`0002:20`, `0003:19,44`, `0004:19,46,68`, `0022:17`,
  status-aware in `0040:49-60`). The whole family feed + photo URLs are on the
  open internet. Flip all to `auth.uid() is not null`.
- **`committee_roster` public-read** (`0056:31`) — real names + personal
  emails/phones. Same fix.
- **`event_attendance` public-read** (`0035:34`) — an anonymous reader can infer
  who is physically at the resort when (a "house is empty" signal). Gate it, and
  reconsider `events`, `houses`, MLR `work_items`, `cabins` (`0034:42`,
  `0064:35`, `0048/0066`, `0032:37`). Genuinely public static content
  (fest schedule, app images, announcements) can stay public.

### P1 — Get PII out of the client bundle

- `lib/data.ts:77-95,129,160-161` ships ~18 relatives' real names + personal
  emails (+ Brian's phone); `lib/help.ts:9-13` ships the help contact's phone +
  email — to every anonymous visitor, before any Supabase call. Move the
  committee seed + `HELP_CONTACT` behind an authenticated fetch (members-only
  table/RPC, seeded by migration); keep only non-PII placeholders static.
  Pair with the RLS work so the UI gate matches server enforcement.
  (`lib/places.ts` is fine — business numbers are public info.)

### P2 — Media server hardening (`media-server/server.js`)

- CORS falls open when `ALLOWED_ORIGINS` is unset (`:50` `origin: ... || true`) — fail closed.
- No rate limiting anywhere; any member can upload unlimited ~1 GB files
  (`MAX_MB` default 1024) — add `express-rate-limit` on `/upload`,
  `/moderate/text`, `/geocode`; lower `MAX_MB` to something sane (e.g. 256).
- `/geocode` (`:67-86`) is an unauthenticated proxy to Census/Nominatim — put it
  behind `requireUser`.
- Add `helmet`.
- (GA item, already documented) `request_help` trusts the client's presence
  snapshot (`0037:197-261`) — persist seed-event windows and re-derive presence
  server-side when Ask-for-Help leaves beta.

*Verified non-issues: `is_admin`/`house_id` not client-writable, upload requires
a valid Supabase token, uuid filenames + sanitized paths (no traversal), ffmpeg
via `spawn` arg arrays, mentions render through React, only `.env.example`
tracked.*

---

## Phase 2 — Admin self-serve content (no more "ask the AI to deploy")

*The insight from the audit: the app already solved this once. All Family Fest
content moved to Supabase (`0053_fest_content`) and is edited in-app by
`FestPlanner` (seed fallback → year-keyed table → public-read RLS +
`can_edit_fest()` writes → planner section, realtime to web + iOS). Every new
self-serve surface should copy that exact shape.*

### 2a. Admin-managed Home call-out cards (the t-shirt-card fix) — build first

Today the t-shirt card is a hard-coded component (`HomeSpotlight.tsx:12-36`)
with a committed image, hard-coded deadline constant, phone number, and dismiss
id. `CalloutStack` itself is already generic and needs **zero changes**.

1. **Migration `home_callouts`** (modeled on `fest_activities`): `id, title,
   body, image_url, link_href, link_label` (renders as tel:/mailto:/https
   button), `starts_on, ends_on` (visibility window), `dismiss_id`, `position`,
   `is_active`. Public-read; writes gated by `can_edit_fest()` (or a new
   `can_edit_home()` that's admin-or-fest-editor).
2. **Lib**: `fetchCallouts()/saveCallout()/deleteCallout()` in
   `lib/festContent.ts` (copy the ~15-line `fest_activities` functions); add the
   table to `useFestContent`'s realtime list. Images reuse the existing
   `site-assets` bucket + `uploadSiteImage()` (`lib/appImages.ts`).
3. **Home**: `HomeSpotlight` maps active rows → generic `<CalloutCard>` stack
   items (image, title, body, action button, "due" footer); the permanent
   `FamilyFestSpotlight` base stays last. Row's `dismiss_id` becomes the
   `StackItem.id` so versioned dismissals keep working.
4. **Editor**: a "Callouts" section in `FestPlanner`'s `SECTIONS` — list →
   add/edit Sheet → delete, with the image uploader already used by the Images
   section. Include a live preview of the card in the sheet.

Net result: any admin/fest-editor posts a flyer card with a photo, button, and
auto-expiry from their phone in under a minute. iOS syncs via realtime.

### 2b. Remaining hard-coded content → editors (in priority order)

| Dataset | Today | Move to |
|---|---|---|
| Help contact (`lib/help.ts`) | Code (and PII in bundle) | `resort_config` singleton table (pairs with Phase 1) |
| Resort info: address, wifi, check-in, phone, heritage (`RESORT` in `lib/data.ts`) | Code | Same `resort_config` table + small admin editor |
| Local Places (`lib/places.ts`) | Code | `places` table + planner-style editor (name, category, phone, menu/order/site URLs, note) |
| Committee definitions (slug/name/emoji/description in `COMMITTEES`) | Code (rosters already DB) | `committees` table already exists (`0012`) — extend + edit UI in `AdminCommittees` |
| Announcement seed (`lib/announcements.ts`) | Code seed | Post as a real DB announcement; delete the seed |
| Resort events seed (`RESORT_EVENTS`) | Code seed | Create as DB events (keep only the Family Fest synth in code — by design) |

### 2c. Admin experience consolidation

Admin tools are currently nine nested accordions inside Profile (`app/profile/page.tsx:231-268`),
plus FestPlanner living separately under `/family-fest/planner`. Create a single
**`/admin` dashboard** page: a clean grid of cards (Members · Callouts & Alerts ·
Events · Content review · Committees · Houses · Cabin requests · Sign-ins ·
Fest Planner link), each a full page instead of an accordion. Profile keeps one
"Admin dashboard" row. This is what makes admins *feel* like admins.

---

## Phase 3 — UX/IA redesign (the "professional feel")

### 3a. Un-bury the navigation (biggest single UX win)

Home currently hides People, Committees, Ask for Help, Events, Cabin Stay, and
Local Places inside **two collapsed accordions** (`HomeCommunication` /
`HomeAroundResort`, default-closed via `CollapsibleSection.tsx:19`). A
non-technical user sees Family Fest + one event + two gray bars.

Replace the two accordions with a **quick-actions grid**: a 2×3 (or 3×2) grid of
big, labeled, colorful tiles — Events · People · Photos/Feed · Cabin Stay ·
Ask for Help · Local Places — always visible, one tap each, 60px+ targets.
This is the pattern every professional consumer app (banking, airline, resort)
uses for its home hub. Keep "App & help" collapsed at the bottom; keep the
callout stack + upcoming event on top.

### 3b. One name per thing

- **Feed tab**: pick "Feed" everywhere. Tab label "Feed" → screen heading
  currently "Chats" (`FeedView.tsx:411`) → first row "Main Feed" → inner title
  "Posts" (`PostsView.tsx:556`). Rename: tab **Feed**, screen heading **Feed**,
  first row **Family Feed**, and drop the inner "Posts" title.
- **Help split**: rename `/help` surfaces to **"App Help"** (or "How-to") and
  `/help-requests` to **"Lend a Hand"** everywhere (Home tile, Profile row,
  notifications copy). Two features named "Help" is a guaranteed wrong-turn.
- **Activity vs Notifications**: pick one (suggest "Activity" tab + "Activity"
  page title).

### 3c. A real (but lightweight) design system

All of this stays inside the existing token architecture (`app/globals.css
@theme`) — no redesign of the palette, which is already distinctive and on-brand:

- **Icons**: replace emoji-as-icons with a small inline-SVG icon set (hand-rolled
  or lucide copied in — no CDN, consistent stroke weight, `aria-hidden`). Emoji
  render differently per device and ⚔️/📣 are opaque metaphors. Keep emoji where
  they're *content* (reactions, stickers).
- **Buttons**: one primary-button recipe (suggest `rounded-full` for pills /
  `rounded-xl` for full-width CTAs — currently all three radii ship ~40-60×
  each). Codify as a `Button` component or shared class.
- **Muted text tiers**: today `/40` through `/75` opacity all appear. Define
  three tokens — `--color-muted` (~60%), `--color-faint` (~50%, min 12px) — and
  sweep. Nothing user-readable below WCAG AA; the 11px/40% heritage line and
  timestamp styles are exactly what the older audience can't read.
- **Touch targets ≥ 44px**: contact chips are 28px
  (`CommitteeMemberContact.tsx:10`), callout ✕ is 28px (`CalloutStack.tsx:225`),
  steppers/calendar arrows 32px (`FestDuesCalculator.tsx:195`,
  `HouseCalendar.tsx:113`). Sweep with a `min-h-11 min-w-11` rule (visual size
  can stay smaller with padding).
- **Loading**: one idiom. `SkeletonList` everywhere (10 files still ship bare
  "Loading…" text — `FeedView.tsx:313`, `WorkChecklist.tsx:195`, etc.); add
  `role="status"` so it's announced.
- **Sheets**: `FeedView`'s hand-rolled member-list overlay (`:371`) and custom
  back buttons (`:356,397`) → shared `Sheet` + `BackLink`.
- **Un-tokenized hex**: `PayView.tsx:134,145` (Venmo/PayPal brand colors) →
  tokens (`--color-venmo`, `--color-paypal`).

### 3d. Family Fest section truth-up

Either build the documented-but-missing `FamilyFestNav` sub-nav (Schedule ·
Dinners · Pay as real sub-pages, room for Photos later) or embrace the
single-scroll page and fix the docs. Recommendation: **build the sub-nav** — the
section has enough content now that one long scroll buries Pay and the schedule,
and a fest **Photos** view (feed filtered to fest-week posts, or a fest album
tag) is a high-joy, low-effort addition that CLAUDE.md already promises.

### 3e. Small frictions

- Pull-to-refresh: overscroll is disabled globally (`globals.css:83-86`) and
  there's no refresh control anywhere. Add a lightweight in-app pull-to-refresh
  on the scroll container for Feed / Events / Notifications (or at minimum a
  refresh affordance) — it's the one gesture every user tries.
- iOS `InstallFirstNudge` sits in front of sign-in (`IdentityProvider.tsx:393-404`).
  Keep the concept, but soften: let "Sign in here anyway" be the visually primary
  action after the *first* time it's shown, so RSVP-intent taps aren't repeatedly
  hijacked.
- Profile de-cluttering: with admin tools moved to `/admin` (2c), flatten the
  remaining Profile page — identity card, Notifications, Contact & payment, Text
  size, Sign out — mostly un-accordioned.
- Empty states with personality: replace "nothing here yet" gaps with warm,
  branded empty states ("No posts yet — be the first to share a lake photo 🎣").

### Protect what already works (do NOT regress these)

1. Plain-language forgiving sign-in (`friendlyAuthError`, spam hint, resend cooldown).
2. Browse-first, sign-in-on-demand architecture.
3. 17px root + Text-size control + pinch zoom.
4. End-to-end reduce-motion support.
5. Human-first Help page ("Text/Call {name}" before any feature docs).

---

## Phase 4 — Ideas beyond the audit (the delight layer)

*Where I think you're headed: the app becomes the family's shared memory and
coordination hub, not just a fest-week tool. Ideas ranked by joy-per-effort;
each reuses existing infrastructure.*

**High joy, low effort**

1. **"Who's Up North" board** — the presence logic already exists for
   Ask-for-Help (approved cabin stays + event RSVPs ±2 days). Surface it
   positively: a Home card showing avatars of everyone currently at the resort
   ("🏕 4 family members are up north this week"). Members-only, opt-out flag.
2. **Birthdays** — `profiles.birthday` already exists. A "This month" birthday
   strip on Home or in Activity, and an automatic feed post/notification on the
   day. Families love this; costs almost nothing.
3. **Weather at the lake** — a small Home widget with Tomahawk, WI conditions
   (Open-Meteo, free, no key). "Lake day ☀️ 78°" is exactly what people check
   before driving up.
4. **On This Day** — resurface a photo post from a prior year ("One year ago at
   Family Fest…"). The posts table has timestamps; it's a query + a card.
5. **Polls** — the fest committee is literally named "Merchandise, Fundraising &
   Polling" but has no polling tool. A simple poll post type (question + options
   + one vote per member, live tally) slots into the existing feed + RPC pattern.
   Also replaces "call Tricia to order" flows eventually: a callout card whose
   button opens a poll/order form.

**Medium effort, high payoff**

6. **Photo albums & the yearly book** — group fest-week photos into an album
   view (by year), with a "download all" for whoever makes the photo book.
   Later: auto-generate a printable year-in-review PDF (the guide-PDF viewer
   pattern already exists).
7. **Cabin guest book** — a digital journal per stay: when a cabin stay ends,
   nudge the family to leave a note + photo ("caught a 32-inch muskie"). Over
   years this becomes the resort's living history — perfectly on brand for a
   place that's been in the family since 1959.
8. **Meal sign-ups beyond fest** — the dinners model (chef, menu, crew)
   generalized to any event/work weekend potluck.
9. **Offline read cache** — it's a Northwoods resort; cell service is spotty.
   `sw.js` deliberately doesn't cache today. Add a conservative offline layer:
   cache the app shell + last-fetched schedule/events/places so the app *opens
   and shows the schedule* with no signal (writes can stay online-only). This
   is a professional-app differentiator that matters exactly where the app is
   used.
10. **Recipes** — fest dinner recipes attached to dinner entries ("Grandma
    Kity's hotdish"), searchable later. Family history + utility.

**Bigger swings (later)**

11. **Family tree / household view** — households already exist loosely;
    a simple tree/grouping view helps the younger generation know who's who.
    Pairs with the People directory.
12. **Year-round fest countdown ritual** — the season model already has phases;
    lean in: a "days until Family Fest" share card people can post, themed
    app-icon badge during live week.
13. **Kiosk mode** — a tablet on the resort wall showing today's schedule,
    weather, who's up north, and latest photos (a read-only `/kiosk` route,
    auto-refreshing). Turns the app into physical resort infrastructure.
14. **Voice-friendly "Ask MLR" GA** — the assistant scaffold exists (beta,
    on-device FM). For the non-technical crowd, a big "Ask a question" box on
    the Help page that answers "what time is dinner Friday?" is the ultimate
    accessibility feature. Ship it when retrieval quality is trustworthy.

---

## Suggested sequencing

| Order | Work | Size |
|---|---|---|
| 1 | Phase 0 P0 bugs (chat previews/unread, RSVP failures, sign-in copy, house deep-link) | S–M |
| 2 | Phase 1 P0 RLS migrations + directory RPC (privacy is table stakes for "professional") | M |
| 3 | Phase 2a admin callout cards (kills the AI-per-flyer workflow before the July 15 t-shirt card even expires) | M |
| 4 | Phase 3a Home quick-actions grid + 3b naming unification | M |
| 5 | Phase 0 P1/P2 bugs + Phase 1 bundle-PII + media-server hardening | M |
| 6 | Phase 3c design system sweep (icons, buttons, text tiers, targets, loading) | M–L |
| 7 | Phase 2b/2c remaining editors + /admin dashboard | M–L |
| 8 | Phase 3d fest sub-nav + photos; Phase 4 quick wins (birthdays, weather, who's-up-north, on-this-day, polls) | M each |
| 9 | Phase 4 medium/bigger items as appetite allows | — |

**Working agreements while executing:** keep CLAUDE.md/README in sync per
commit (fix the drift found in this audit first); light mode only; no dark
translucent surfaces; every new editable dataset copies the FestPlanner pattern
(seed fallback → table → RLS → lib module → planner/admin section); verify on a
real phone (iOS standalone) before calling anything done.
