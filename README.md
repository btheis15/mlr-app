# Muskellunge Lake Resort (MLR)

The year-round resort app — activities, dining, an embedded Family Fest hub,
resort chat, and a signed-in **"Ask MLR" AI assistant** (answers from your resort
info — never private chats; see [`docs/ai-assistant.md`](docs/ai-assistant.md)) —
installable to your phone's home screen. **Light mode only**, built
around the official **forest-green** Muskellunge Lake Resort logo (cabin in the
pines, EST 1987) with vintage heritage from the original resort (Leo & Dorothy
Theis · Fishing · Hunting · Boating · Tomahawk, WI).

> **Live:** https://mlr-app-omega.vercel.app (Vercel) · https://btheis15.github.io/mlr-app/ (Pages)
>
> **Status: read-only launch.** The whole browse experience is live (Home,
> Activities, Dining & amenities, the Family Fest hub, reading Chat) against seed
> data in [`lib/data.ts`](lib/data.ts). Interactive features (sign-in, chat
> posting, RSVP, admin alerts) are gated behind a "coming soon" via the
> `READ_ONLY` flag in [`lib/features.ts`](lib/features.ts) until the Supabase
> backend lands — see [CLAUDE.md](./CLAUDE.md) "Backend seams" and
> [NEXT-STEPS.md](./NEXT-STEPS.md).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fbtheis15%2Fmlr-app)

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind v4** — light-mode-only theme tokens (forest-green primary) as CSS
  variables via `@theme` in [`app/globals.css`](app/globals.css); brush-script
  wordmark (Yellowtail) via `next/font`
- **Framer Motion** for interactions
- **PWA** — standalone manifest, "Add to Home Screen" hint on iOS
- **Hosting** — live on **Vercel** + **GitHub Pages** (Pages auto-deploys on
  push to `main`; Vercel is currently manual via `vercel --prod`)

## Quick start

```bash
npm install            # .npmrc already sets legacy-peer-deps
npm run dev            # http://localhost:3000
```

## Project layout

```
app/            App Router routes (page.tsx per tab) + layout + globals.css
components/     TabBar, InstallHint, shared UI
lib/            format.ts and other pure helpers
public/         manifest.webmanifest, icon.svg
media-server/   Mac-mini side: uploads, transcode, push + APNs senders, fm-service
ios/            Native SwiftUI app (see "iOS app" below) — shares this Supabase backend
docs/           ios-swiftui-strategy.md, ai-assistant.md, content-moderation.md
```

## iOS app (native SwiftUI) — additive, and synced with the web

The web PWA above is **not going away.** Alongside it lives a **native SwiftUI iOS
app** in [`ios/`](ios/), built from scratch for **iOS 26** with the **Liquid Glass**
design language. The full plan is in
[`docs/ios-swiftui-strategy.md`](docs/ios-swiftui-strategy.md).

**Two clients, one backend — synced for free.** The web app and the iOS app talk to
the **same Supabase project**: same Postgres tables, RLS policies, `security
definer` RPCs, Storage buckets, and realtime channels. There is **no separate iOS
database and no sync layer** — a single source of truth means an RSVP made on
iPhone shows on the web instantly, and a photo posted on the web flows into the iOS
feed's realtime subscription. Android + desktop keep using the web; iOS users get a
native app; everyone sees the same data.

- **Web (Android / desktop / not-yet-installed):** Next.js PWA on Vercel + Pages — unchanged.
- **iOS:** native SwiftUI via [`supabase-swift`](https://github.com/supabase/supabase-swift),
  pointed at the identical project URL + anon key.
- **Only backend *addition*:** APNs push for iOS — a new `apns_subscriptions` table
  + an `apns-sender.js` on the Mac mini, running beside the existing Web Push sender.

### Platform-native features (built into `ios/`)

The app leans into the Apple ecosystem, mapping what already exists in the data
model onto native capabilities:

| Area | Native integration | Where |
|---|---|---|
| **Design** | Liquid Glass buttons/cards; adaptive **light + dark** mode (System/Light/Dark in Profile) | `Shared/Design/LiquidGlass.swift`, `Colors.swift`, `AppearanceManager.swift` |
| **Push** | APNs, with **actionable notifications** — RSVP Going/Maybe, "On my way" to a help request, **inline text Reply** to chat mentions, and birthday "Send wishes / Send a gift" — all answered from the notification without opening the app | `Native/NotificationActions.swift` |
| **Widgets** | Home/Lock-Screen **Family Fest countdown** + **Next event** widgets | `MLRWidget/` |
| **Live Activities** | Fest week "Day n of N" + next event on Lock Screen / Dynamic Island | `MLRWidget/FestLiveActivity.swift`, `LiveActivities/` |
| **Siri / Shortcuts** | "What's next at MLR", "How many days until Family Fest", "Ask for help" | `Intents/` |
| **Weather** | **WeatherKit** forecast on each event's date (shows when within ~10-day horizon, hides otherwise) | `Weather/` |
| **Messages** | **In-app text composer** — text a member (or a dinner crew, or birthday wishes) prefilled, without leaving the app to find them in Messages | `Native/MessageComposer.swift` |
| **Calendar** | One-tap **Add to Apple Calendar** for events / Family Fest / a member's **birthday** (recurring, with a reminder) | `Native/CalendarService.swift` |
| **Contacts** | **Add to Contacts** card from a member's profile (phone, email, avatar) | `Native/ContactsService.swift` |
| **Maps** | **Directions** to the resort / local places; help requests with a GPS pin show a map + "navigate to whoever needs a hand" | `Native/MapsHelper.swift` |
| **Payments** | **Apple Cash via Messages** handoff for dues + Apple Pay (PassKit) scaffold for when dues move to a real processor; existing Venmo/Zelle/Cash App deep links stay | `Native/Payments.swift`, `FestPayView` |
| **Spotlight** | Events, members, and committees **searchable from the phone** (swipe-down) with deep links back into the app | `Native/SpotlightIndexer.swift` |
| **Polish** | Tasteful **haptics** on RSVP / reactions / votes / help responses; native **share sheet** for posts, photos, events | `Native/HapticsAndShare.swift` |

> **Distribution:** App Store + TestFlight (paid Apple Developer membership). Build
> from Xcode on a Mac. The Xcode-only setup (target memberships, capabilities like
> App Group / WeatherKit / Live Activities) is checklisted in the strategy doc.

### Ideas still on the table (creative, not yet built)
Apple Wallet **Family Fest pass** (add the week to Wallet like a ticket) ·
**Critical Alerts** for 🚨 Urgent help requests (bypass Do Not Disturb — ties into
the GA "Urgent goes to everyone" plan, needs an Apple entitlement) ·
**Communication Notifications** so chat/mention pushes render with the sender's
avatar like Messages · **interactive widget** RSVP buttons · **SharePlay** group
photo viewing · **iCloud Shared Photo Library** album for Fest photos ·
**Sign in with Apple**.

## Where to make changes

- **Colors / theme** — the `@theme` block in [`app/globals.css`](app/globals.css).
  Editing a token (e.g. `--color-primary`) flows through every `bg-*`/`text-*`
  utility automatically.
- **Navigation** — the `TABS` array in [`components/TabBar.tsx`](components/TabBar.tsx).
- **A tab's content** — its `app/<tab>/page.tsx`.
- **Local Places** — the nearby-businesses list at `/local-places` (linked from
  Home); add or edit spots in [`lib/places.ts`](lib/places.ts) and the page
  renders them. Inshalla hands off to the in-app `/tee-times` screen.
- **Events & attendance** — the resort calendar + RSVP at `/events`, with the
  nearest event spotlighted on Home. Admins create events; members tap
  Going / Maybe / Can't make (Family Fest has an optional per-day picker). Data
  flow is [`lib/events.ts`](lib/events.ts) + the `useEvents` hook in
  [`lib/hooks.ts`](lib/hooks.ts); backed by Supabase migrations
  [`0034_events.sql`](supabase/migrations/0034_events.sql) +
  [`0035_event_attendance.sql`](supabase/migrations/0035_event_attendance.sql)
  (run them in the Supabase SQL editor). See CLAUDE.md → **Resort events &
  attendance**.
- **Ask for Help (BETA)** — at `/help-requests`, a member who's at the resort posts
  a short request for a hand (moving, setup, a ride, supplies, or 🚨 urgent); willing
  members who are *also* at the resort get a push, tap **On my way**, and the request
  reads **✅ Covered** once enough are coming. A request can also carry an optional
  **"what to bring" checklist** (tables, chairs, coolers…) that helpers tick off as
  they commit to bringing each item. **Urgent** requests are an exception: they alert
  **every member app-wide** (and override per-category phone-push settings), since an
  emergency isn't really "help" — it's everyone's business. "At the resort" is derived
  from event attendance (±2 days) / approved cabin stays — no geolocation. Beta-gated
  behind `profiles.beta_tester` (urgent is open to everyone). Migrations
  [`0037_help_requests.sql`](supabase/migrations/0037_help_requests.sql) +
  [`0046_help_bring_items_and_urgent_broadcast.sql`](supabase/migrations/0046_help_bring_items_and_urgent_broadcast.sql);
  [`lib/helpRequests.ts`](lib/helpRequests.ts) + `useHelpRequests`. See CLAUDE.md →
  **Ask for Help (BETA)**.
- **Houses** — designate members into a house (e.g. "MJT House"); each member
  belongs to **one** house (`profiles.house_id`), admin-assigned in Profile → Admin
  → **Houses** ([`components/AdminHouses.tsx`](components/AdminHouses.tsx)). A house
  gets a **private chat** (a channel in the Feed tab,
  [`components/HouseChat.tsx`](components/HouseChat.tsx)) and its **own work items**.
  The Work Checklist ([`components/WorkChecklist.tsx`](components/WorkChecklist.tsx))
  is its own **collapsed-by-default expandable card** on Home, sectioned into an
  **MLR** section (resort-wide, everyone) + the viewer's **house** section. Each item
  has an **urgency rating** (🔴 ASAP · 🟡 This year · 🟢 Nice to have) and the list is
  **always sorted by importance**. Every work item can also carry **photo/video
  attachments** and a **plain-text comment thread with @mentions** (tap a row →
  detail sheet; comments follow the item's visibility, notify the creator + prior
  commenters). Migrations
  [`0064_houses.sql`](supabase/migrations/0064_houses.sql) …
  [`0071_house_calendar.sql`](supabase/migrations/0071_house_calendar.sql);
  [`lib/houses.ts`](lib/houses.ts) + [`lib/houseCalendar.ts`](lib/houseCalendar.ts)
  + [`lib/workItems.ts`](lib/workItems.ts). A house also has its own **calendar of
  stays** — one member marks when they're going up and who they're bringing (a free
  list of names, no account needed), everyone sees who's staying when, and
  resort-wide MLR events are overlaid so a house never misses a family-wide
  gathering. It comes together in a **House Hub** (a Home card → `/house`) gathering
  the house's calendar, chat, and to-do list; the full calendar (month grid +
  agenda) is `/house/calendar`. Now on **both** web and iOS (shared Supabase tables,
  so they sync). See CLAUDE.md → **Houses (scoped chat + work items)**.
- **Home call-out stack** — temporary Home call-outs (future
  news/alerts) stack as **swipe-away cards on top of** the permanent Family Fest
  spotlight ([`components/HomeSpotlight.tsx`](components/HomeSpotlight.tsx) →
  [`components/CalloutStack.tsx`](components/CalloutStack.tsx)), Robinhood-style:
  swipe (or ✕) to dismiss, the next slides up, and the spotlight base can't be
  swiped — so the slot stays one card tall and Ask for Help below stays in view.
  Dismissals are session-scoped (`sessionStorage`): a swiped card stays gone
  while moving between tabs but comes back the next time the app is opened. See
  CLAUDE.md → **Home call-out stack**.
- **New-member onboarding** — the first time a brand-new member verifies their
  sign-in code (and their profile is still empty), a guided two-step Welcome sheet
  ([`components/WelcomeIntro.tsx`](components/WelcomeIntro.tsx)) collects the basics
  (phone, birthday, preferred payment) and then the push-notification settings, so
  newcomers set up without hunting through Settings. Gated by `IdentityProvider`
  `needsIntro`; backed by migration
  [`0045_member_intro.sql`](supabase/migrations/0045_member_intro.sql)
  (`profiles.intro_seen` — run it in the Supabase SQL editor). See CLAUDE.md →
  **Non-technical / accessibility UX**.
- **Content safeguards (feed moderation)** — layered checks on the Posts feed so
  sensitive/inappropriate/illegal content doesn't sit in front of the family.
  The mini rejects non-image/video uploads by magic bytes; an admin-managed
  blocklist + member **Report** auto-hold flagged posts/comments for an admin
  review queue (Profile → Admin → Content review); on-device Apple nudity/text
  checks on the mini are the planned next layer. Migration
  [`0040_content_moderation.sql`](supabase/migrations/0040_content_moderation.sql);
  [`lib/moderation.ts`](lib/moderation.ts). Full writeup in
  [`docs/content-moderation.md`](docs/content-moderation.md) and CLAUDE.md →
  **Content safeguards**.

See [CLAUDE.md](./CLAUDE.md) for the operating manual for AI sessions.
