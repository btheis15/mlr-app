# iOS SwiftUI Strategy — Muskellunge Lake Resort

## Overview

The strategy is a **clean platform split**: the existing Next.js PWA stays live on
Vercel as the web experience for Android users and unauthenticated browsing, while
a **native SwiftUI iOS app** is built from scratch against the same Supabase
backend. No wrapper, no React Native bridge — real UIKit/SwiftUI using every
native capability Apple exposes. The two apps share one database, one auth system,
and one media server; they diverge only at the UI layer.

The iOS app targets **iOS 26**, adopting the **Liquid Glass** design language, and
leans into the Apple ecosystem: **WidgetKit** widgets, **ActivityKit** Live
Activities, **App Intents** for Siri, and **WeatherKit** forecasts on events.

> ### The web app is not going away — iOS is additive, and they stay in sync
>
> This is the load-bearing constraint of the whole project:
>
> - **The Next.js PWA stays live and unchanged.** Android users, desktop
>   browsers, and anyone who hasn't installed the iOS app keep using it exactly as
>   today. No web features are removed.
> - **The iOS app is a second client, not a replacement.** A family member can use
>   the web on their laptop and the native app on their phone interchangeably.
> - **They are synced for free because there is only ONE backend.** Both clients
>   talk to the *same* Supabase project — same Postgres tables, same RLS policies,
>   same `security definer` RPCs, same Storage buckets, same realtime channels. The
>   Swift `supabase-swift` client points at the identical project URL + anon key as
>   the web app's `@supabase/supabase-js` client. An RSVP made on iPhone appears
>   instantly on the web; a photo posted on the web flows into the iOS feed's
>   realtime subscription. There is **no separate iOS database and no sync layer to
>   build or maintain** — a single source of truth means "sync" is inherent.
> - **The only backend *addition* (not a change)** is APNs delivery for iOS: a new
>   `apns_subscriptions` table + an `apns-sender.js` on the Mac mini, running
>   alongside the existing Web Push sender. Everything else is shared verbatim.

---

## Why Full Native (Not a Web Wrapper)

| Capability | PWA / WebView wrapper | Native SwiftUI |
|---|---|---|
| Push notifications | Requires Home Screen install; VAPID | APNs, works from first launch |
| Home Screen widgets | ❌ | WidgetKit (e.g. countdown to Fest) |
| Siri / Shortcuts | ❌ | App Intents |
| Share extension | ❌ | Share Extension (post photos from Photos app) |
| Live Activities | ❌ | ActivityKit (Fest countdown on Lock Screen) |
| App Clips | ❌ | Single-tap cabin-request onboarding |
| Background fetch | Limited | BGAppRefreshTask |
| Face ID / Touch ID | ❌ | LocalAuthentication |
| Haptic feedback | Limited | UIImpactFeedbackGenerator |
| Smooth scrolling | JS jank | Native list performance |
| App Store distribution | No | Yes — you're a paid member |
| Camera / Photos integration | Web API (limited) | PhotosUI, AVFoundation |
| Weather on events | ❌ (no first-party API) | WeatherKit forecasts on event dates |
| Design language | Web CSS approximation | Native Liquid Glass (iOS 26) |

---

## iOS 26 / Apple Ecosystem Features

The app targets **iOS 26** so it can use the latest platform capabilities as
first-class features (not "someday" extras). Scaffolding for all of these is
already in the repo under `ios/`.

### Liquid Glass design language
- `ios/MLRApp/Shared/Design/LiquidGlass.swift` — brand glass button styles
  (`.glassPrimary`, `.glassSecondary`, `.glassFest`, `.glassCircle()`), a
  `.glassCard()` surface modifier, and `PulsingLiveDot`, all built on the iOS 26
  `.glassEffect(_:in:)` API and `Glass` config (`.regular.tint(_:).interactive()`).
- System chrome (TabView, toolbars, sheets, navigation bars) adopts Liquid Glass
  **automatically** on iOS 26 — we don't restyle those. The custom styles are for
  our own CTAs, floating buttons, and layered cards so they match the system
  material. Prominent CTAs use glass; we deliberately don't glassify every button.

### WidgetKit (Home Screen + Lock Screen widgets)
- `ios/MLRWidget/` is a **Widget Extension target**. It ships:
  - **Family Fest Countdown** — `systemSmall`, `systemMedium`, plus Lock Screen
    `accessoryRectangular` / `accessoryCircular`. Recomputes the season phase on
    each timeline refresh from `FamilyFestConfig` (no network); shows "N days to
    go" → "Day n of N" during the live week.
  - **Next at the Resort** — the nearest upcoming event, read from the App Group
    snapshot the app writes (`SharedStore`), falling back to seed events offline.
- Widgets and the app share data via an **App Group**
  (`group.com.muskellungelakeresort.mlr`) — `ios/Shared/SharedStore.swift`.

### Live Activities (ActivityKit)
- `ios/Shared/FestActivityAttributes.swift` (shared with the widget target) +
  `ios/MLRWidget/FestLiveActivity.swift` (Lock Screen banner + Dynamic Island).
- During Fest week, a Live Activity shows "Day n of N" and the next scheduled
  event on the Lock Screen and in the Dynamic Island.
  `ios/MLRApp/LiveActivities/FestLiveActivityController.swift` starts/updates/ends
  it from the app, driven by `FestSeason` + the schedule. Requires
  `NSSupportsLiveActivities = YES` in Info.plist.

### App Intents (Siri + Shortcuts + Spotlight)
- `ios/MLRApp/Intents/` — `NextEventIntent` ("what's next at MLR"),
  `FestCountdownIntent` ("how many days until Family Fest"), and `AskForHelpIntent`
  (opens the ask-for-help flow), registered with spoken phrases via
  `MLRAppShortcuts: AppShortcutsProvider`. The two read-only intents answer from
  the App Group snapshot / local season math, so they work without launching the
  app or signing in (events + fest dates are public).

### WeatherKit (forecasts on events)
- `ios/MLRApp/Weather/WeatherService.swift` fetches the **daily forecast for an
  event's date**, anchored to the resort's fixed coordinate (so no location
  permission is needed). WeatherKit's daily forecast reaches ~10 days out, so:
  **upcoming events show a forecast; far-out events simply don't** — the badge
  hides itself when `forecast(for:)` returns nil.
- `ios/MLRApp/Weather/EventWeatherBadge.swift` — a compact badge (icon + hi/lo)
  for cards and a full badge (condition + precip %) for the event detail, plus
  `WeatherAttributionView` (Apple **requires** attribution on any screen showing
  WeatherKit data). Wired into `EventCard`, `UpcomingEventCard`, `EventSheet`, and
  the Family Fest day rows.
- **Setup:** enable the **WeatherKit** capability on the App ID
  (developer.apple.com) and on the Xcode target. No API key in code — entitlement-based.

### New capabilities checklist (Xcode → Signing & Capabilities)
- Push Notifications + Background Modes (remote notifications)
- App Groups (`group.com.muskellungelakeresort.mlr`) — app + widget targets
- WeatherKit
- Live Activities (Info.plist `NSSupportsLiveActivities = YES`)
- Associated Domains (Universal Links)
- Widget Extension target (`MLRWidget`) with the shared files' target membership
  checked: `FestActivityAttributes.swift`, `SharedStore.swift`, `FestSeason.swift`,
  `SeedData.swift`, `Colors.swift`, `LiquidGlass.swift`, `Formatters.swift`.

---

## What Stays on the Web

The Next.js PWA on Vercel **continues unchanged** as:

- The Android experience (Google Play isn't worth the investment for a handful of users)
- The desktop/laptop browsing path for anyone accessing from a computer
- The public-facing marketing surface (non-members can browse without installing anything)
- A fallback for iOS users who haven't yet installed the app

No features get removed from the web app. Both targets stay in sync at the Supabase
layer — schema migrations, RLS policies, and RPC functions apply to both.

---

## Technology Stack (iOS)

| Concern | Choice | Notes |
|---|---|---|
| UI framework | **SwiftUI** | **iOS 26 minimum** (Liquid Glass design language) |
| Backend | **supabase-swift** (`github.com/supabase/supabase-swift`) | Mirrors the TS client API; **same project as the web app** — auth + database + realtime + storage |
| Realtime | Supabase Realtime via supabase-swift | Chat, notifications, help requests — same channels as web |
| Push notifications | **APNs** via `UNUserNotificationCenter` | Device token stored in `apns_subscriptions` table (new) |
| Widgets | **WidgetKit** | Fest countdown + next-event, fed via App Group |
| Live Activities | **ActivityKit** | Fest day-of on Lock Screen + Dynamic Island |
| Siri / Shortcuts | **App Intents** | Next event, fest countdown, ask for help |
| Weather | **WeatherKit** | Forecast on event dates (≤10-day horizon) |
| Image loading/caching | **Kingfisher** | Async image loading + disk cache |
| Photo picker | **PhotosUI** (`PhotosPicker`) | iOS 16+ native, no permissions nag |
| Video playback | **AVKit** (`VideoPlayer`) | For transcoded uploads from the media server |
| State management | `@Observable` + `@Environment` (iOS 17 macros) | No third-party state lib needed |
| Navigation | `NavigationStack` + `TabView` | Matches the web app's tab + sheet mental model |
| Deep links | Universal Links + Custom URL scheme | `mlr://family-fest/schedule/123` |
| Networking | `URLSession` (async/await) | Wrapped in thin service objects |
| Persistence | `UserDefaults` (lightweight prefs) + Supabase | No Core Data needed given the backend |
| Testing | XCTest + Swift Testing | Unit tests for the season model, formatters |
| CI/CD | Xcode Cloud (free tier available with paid membership) | Build + TestFlight distribution |
| Distribution | **App Store** (paid membership ✓) + **TestFlight** for beta | |

---

## Supabase Integration

The Swift app talks to the **exact same Supabase project** as the web app. No
schema changes are required for the initial port; the one addition is APNs token
storage (see Phase 1).

```swift
// AppEnvironment.swift
import Supabase

let supabase = SupabaseClient(
    supabaseURL: URL(string: "https://YOUR_PROJECT.supabase.co")!,
    supabaseKey: "YOUR_ANON_KEY"
)
```

Authentication uses Supabase's **email OTP** flow (same as the web app — no
passwords, 6-digit code). The Swift SDK handles the session token, refresh, and
persistence in the iOS Keychain automatically.

---

## Push Notification Strategy

The web app uses **Web Push / VAPID** stored in `push_subscriptions`. iOS native
apps use **APNs**, which is a different token format and delivery pipeline. The
plan:

### New table: `apns_subscriptions`

```sql
create table apns_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  device_token text not null unique,
  environment text not null default 'production', -- or 'sandbox'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- RLS: own rows only
```

### Media server extension

Add an `apns-sender.js` alongside `push-sender.js` that watches the same
Supabase Realtime channels and delivers to APNs via the `apns2` npm package
using your Apple Push Notification Auth Key (`.p8` file from developer.apple.com).
It reads `apns_subscriptions` filtered by `push_types` just like the web sender
reads `push_subscriptions`. A paid membership means you can generate the APNs
Auth Key from the Certificates, Identifiers & Profiles portal.

### Summary

| Target | Table | Sender | Token format |
|---|---|---|---|
| Android / desktop PWA | `push_subscriptions` | `push-sender.js` (existing) | VAPID endpoint |
| iOS native app | `apns_subscriptions` | `apns-sender.js` (new) | APNs device token hex |

---

## Project Setup

### Xcode project

1. **New project → App** in Xcode, target iOS 17+
2. Bundle ID: `com.muskellungelakeresort.mlr` (register in the developer portal)
3. Capabilities to enable from the start:
   - Push Notifications
   - Background Modes → Remote notifications + Background fetch
   - Associated Domains (for Universal Links: `applinks:mlr-app-omega.vercel.app`)
   - Sign in with Apple (optional, for future)
4. Swift Package dependencies to add:
   - `https://github.com/supabase/supabase-swift` (`.upToNextMajor(from: "2.0.0")`)
   - `https://github.com/onevcat/Kingfisher` (`.upToNextMajor(from: "8.0.0")`)

### Folder structure

```
MLRApp/
├── App/
│   ├── MLRApp.swift              # @main entry, AppDelegate for APNs token
│   └── AppEnvironment.swift      # Supabase client, shared services
├── Auth/
│   ├── AuthService.swift         # sign in, sign out, session watch
│   ├── SignInView.swift          # email entry + OTP code entry
│   └── WelcomeIntroView.swift    # first-run onboarding (mirrors WelcomeIntro)
├── Models/
│   ├── Profile.swift             # User, AdminRole, PushType, NotifType
│   ├── Post.swift
│   ├── Event.swift               # ResortEvent, EventAttendance
│   ├── Cabin.swift               # CabinBooking
│   ├── Notification.swift
│   ├── HelpRequest.swift
│   ├── Committee.swift
│   └── FestSeason.swift          # Port of lib/festSeason.ts
├── Services/
│   ├── PostsService.swift
│   ├── EventsService.swift
│   ├── NotificationsService.swift
│   ├── HelpService.swift
│   ├── CabinService.swift
│   ├── CommitteeService.swift
│   ├── PushService.swift         # APNs token registration
│   └── MediaService.swift        # Upload to media server / Supabase storage
├── Tabs/
│   ├── HomeTab/
│   │   ├── HomeView.swift
│   │   ├── FamilyFestSpotlight.swift
│   │   ├── UpcomingEventCard.swift
│   │   └── AskForHelpHomeCard.swift
│   ├── FeedTab/
│   │   ├── PostsView.swift
│   │   ├── PostCard.swift
│   │   ├── PostComposer.swift
│   │   └── CommentsView.swift
│   ├── FamilyFestTab/
│   │   ├── FestOverviewView.swift
│   │   ├── FestScheduleView.swift
│   │   ├── FestDinnersView.swift
│   │   ├── FestCrewView.swift
│   │   ├── FestPhotosView.swift
│   │   ├── FestPayView.swift
│   │   ├── ShirtVoteView.swift
│   │   └── FestStatus.swift
│   ├── ActivityTab/
│   │   ├── NotificationsView.swift
│   │   └── NotificationRow.swift
│   └── ProfileTab/
│       ├── ProfileView.swift
│       ├── NotifPrefsView.swift
│       ├── PushToggleView.swift
│       ├── Admin/
│       │   ├── AdminView.swift
│       │   ├── AdminMembersView.swift
│       │   ├── AdminAlertComposer.swift
│       │   ├── AdminModerationView.swift
│       │   └── AdminCabinBookings.swift
│       └── BetaView.swift
├── Shared/
│   ├── Design/
│   │   ├── Colors.swift           # MLR color tokens (mirrors CSS variables)
│   │   ├── Typography.swift       # Font scale, Yellowtail script font
│   │   └── Theme.swift            # Environment-injected theme
│   ├── Components/
│   │   ├── MLRSheet.swift         # Native .sheet with grab handle styling
│   │   ├── SkeletonView.swift     # Loading placeholder
│   │   ├── AvatarView.swift
│   │   ├── AttendanceControl.swift
│   │   ├── GuardView.swift        # Inline sign-in gate
│   │   ├── AnnouncementBanner.swift
│   │   ├── PrivateName.swift
│   │   └── MentionText.swift      # @name highlight rendering
│   └── Utilities/
│       ├── Formatters.swift       # Port of lib/format.ts
│       ├── FestSeason.swift       # Port of lib/festSeason.ts
│       └── Events.swift           # Port of lib/events.ts merge logic
├── People/
│   ├── PeopleDirectoryView.swift
│   └── MemberSheetView.swift
├── Events/
│   ├── EventsView.swift
│   ├── EventCard.swift
│   ├── EventSheet.swift
│   └── EventComposer.swift
├── Activities/
│   └── ActivitiesView.swift
├── Cabins/
│   ├── CabinRequestSheet.swift
│   └── CabinBookingsView.swift
├── HelpRequests/
│   ├── HelpRequestsView.swift
│   └── AskForHelpSheet.swift
└── Committees/
    ├── CommitteesView.swift
    ├── CommitteeDetailView.swift
    └── CommitteeChatView.swift
```

---

## Feature Mapping: Web → SwiftUI

### Navigation

The web app uses a bottom `TabBar` with 5 tabs. Map directly to `TabView`:

```swift
TabView(selection: $selectedTab) {
    HomeView().tabItem { Label("Home", systemImage: "house.fill") }.tag(Tab.home)
    PostsView().tabItem { Label("Feed", systemImage: "rectangle.stack.fill") }.tag(Tab.feed)
    FestOverviewView().tabItem {
        Label("Family Fest", systemImage: "star.fill")
    }.tag(Tab.fest)
    // Live dot: overlay a badge/circle on the tab during live phase
    NotificationsView().tabItem { Label("Activity", systemImage: "bell.fill") }.tag(Tab.activity)
    ProfileView().tabItem { Label("Profile", systemImage: "person.fill") }.tag(Tab.profile)
}
```

The Family Fest tab gets a colored indicator during `live` + `wrap` phases — use
`.badge` with a colored dot or a custom `tabItem` label overlay.

### Authentication (IdentityProvider → AuthService)

```swift
// AuthService.swift
actor AuthService: ObservableObject {
    func sendOTP(email: String) async throws
    func verifyOTP(email: String, token: String) async throws -> Session
    func signOut() async throws
    var currentUser: User? // @Published
    var isAdmin: Bool
}
```

The `SignInView` mirrors `SignInGate`: email field → 6-digit code entry with a
30-second resend cooldown and a friendly error display. On iOS there's no "Install
First Nudge" (the app is already installed), so that flow is skipped entirely.

### Family Fest Season Model (festSeason.ts → FestSeason.swift)

This is a pure port — no UI, just logic. The TypeScript is already side-effect-free:

```swift
// FestSeason.swift
struct FestSeason {
    enum Phase { case offSeason, planning, live, wrap }
    
    let phase: Phase
    let isLive: Bool
    let isPlanning: Bool
    let isWrap: Bool
    let isTakeover: Bool
    let daysUntilStart: Int
    let isSoon: Bool
    let dayNumber: Int?
    let totalDays: Int
    let daysSinceEnd: Int
    let wrapDaysLeft: Int
    
    static let planningLeadDays = 60
    static let wrapTailDays = 14
    
    static func compute(start: Date, end: Date, now: Date = .now) -> FestSeason
}
```

Use an `@Environment` key or an `@Observable` singleton so every view that reads
phase (Home spotlight, Tab live-dot, Fest hub status) stays in sync without
prop-drilling.

### Posts / Feed (PostsView)

SwiftUI's `LazyVStack` inside a `ScrollView` gives smooth infinite scroll. The
Supabase realtime channel `.on("posts")` feeds new items via `AsyncStream`. Photo
upload uses `PhotosPicker` → `UIImage` → multipart POST to the media server's
`/upload` endpoint (same URL as the web app). `@mention` autocomplete in the
composer uses a `TextEditor` with an overlay suggestion list watching for the `@`
character.

### Committee Chat (CommitteeChat)

Port the existing pattern: realtime subscription on `committee_chat_messages`
filtered by `committee_id`, soft-deleted messages show tombstone rows, 24-hour
edit/delete window for the author enforced by the existing RLS (same rules, no
changes needed). `@mention` autocomplete scoped to that committee's roster.

### People Directory

`List` + `.searchable` — smooth native search that the web's `input[type=search]`
can't match. Each row: avatar, name (masked for guests via `PrivateName`), quick
action buttons (phone call via `tel://`, text via `sms://`, Venmo deep link).
`MemberSheetView` uses `.sheet` for the full profile.

### Events & Attendance

`List` grouped by month, `EventSheet` uses `.sheet(isPresented:)`. `AttendanceControl`
is a three-segment picker (`going / maybe / can't make it`) that fires the
`upsert_event_attendance` RPC. The per-day drill-down for Family Fest uses a
`ScrollView` of weekday chips.

### Help Requests (BETA)

Mirrors the web exactly: beta-gated behind `profiles.beta_tester`. Location pin
is **better** on native — `CoreLocation` gives a real GPS coordinate without any
browser permission dance.

### Cabin Booking

`CabinRequestSheet` as a native `.sheet`. The booking status (pending / approved /
denied) maps to a SwiftUI `Label` with `systemImage` icons.

### Admin Tools

All admin composites (members, alerts, moderation queue, cabin bookings, sign-ins)
live under `ProfileView` behind an `isAdmin` guard — same as the web. The
geolocated sign-in log is easier on native (no IP-geolocation third-party needed;
CoreLocation can supply the reviewer's location for the audit trail).

### AI Assistant

The `AssistantChat` sheet is a natural SwiftUI conversation UI. The same
`/api/assistant` endpoint works unchanged (the Swift app just POSTs to it). Beta
testers with the toggle on see the ✨ button as a floating `ZStack` overlay.

---

## Design Token System (Colors + Typography)

The web app uses CSS custom properties mapped to Tailwind utilities. iOS equivalent:

```swift
// Colors.swift
extension Color {
    static let mlrPrimary   = Color(red: 0.082, green: 0.314, blue: 0.227) // #15503a forest green
    static let mlrAccent    = Color(red: 0.502, green: 0.251, blue: 0.118) // vintage chestnut
    static let mlrFest      = Color(red: 0.502, green: 0.110, blue: 0.196) // heraldic wine
    static let mlrSurface   = Color(.systemBackground)
    static let mlrCard      = Color(.secondarySystemBackground)
}
```

The Yellowtail script font (`.font-script` in the web) is available as a Google
Font — embed it in the app bundle for the resort wordmark. Cinzel (Family Fest
serif) also embeds for the `.ff-section` equivalent. Both are free and OFL-licensed.

**Light mode only** — the app sets `overrideUserInterfaceStyle = .light` at the
window level, mirroring the web app's design decision.

---

## App Store Considerations

You are a paid Apple Developer Program member, so:

- You can publish to the **App Store** (consumer, not just enterprise)
- You can use **TestFlight** for beta distribution — use this heavily before launch
- You can generate **APNs Auth Keys** (the `.p8` file) from the portal — needed for push
- You can create **App Clips** — a great fit for a cabin-request or check-in
  experience reachable from an NFC tag at the resort

**App Store metadata:**
- Category: **Lifestyle** or **Travel**
- Age rating: 4+ (the app is a family resort tool)
- Privacy nutrition label: Collect name + email + location (optional, for Help
  Requests) — disclose in App Privacy section
- Screenshot requirement: 6.7" (iPhone 15 Pro Max), 6.1" (iPhone 15), iPad if
  you include iPadOS

**Bundle ID strategy:**
- `com.muskellungelakeresort.mlr` — main app
- `com.muskellungelakeresort.mlr.widget` — WidgetKit extension
- `com.muskellungelakeresort.mlr.shareextension` — Share Extension (Phase 3+)

---

## Implementation Phases

---

### Phase 0 — Foundation (Week 1–2)

**Goal:** Xcode project compiles, talks to Supabase, authenticates a user.

- [ ] Create Xcode project, set bundle ID, configure signing
- [ ] Add `supabase-swift` and `Kingfisher` via SPM
- [ ] Implement `AuthService` (email OTP send + verify)
- [ ] `SignInView` — email entry, code entry, resend cooldown, error messages
- [ ] `AppEnvironment` singleton with the Supabase client
- [ ] `ProfileService` — fetch `profiles` row on sign-in, map to `User` model
- [ ] Register for remote notifications in `AppDelegate`, save APNs token to
  `apns_subscriptions`
- [ ] Stub `TabView` with placeholder tabs
- [ ] Add `Colors.swift` and `Typography.swift` with design tokens
- [ ] Embed Yellowtail + Cinzel fonts
- [ ] Force light mode at window level

**Deliverable:** Sign in with email OTP works. APNs token saves to DB.

---

### Phase 1 — Core Tabs (Week 3–6)

**Goal:** Home, Feed, and Profile tabs are functional end-to-end.

**Home tab:**
- [ ] MLR cabin logo hero (centered, same visual weight as web)
- [ ] `FestSeason.swift` — pure port of `festSeason.ts`
- [ ] `FamilyFestSpotlight` — phase-aware banner (off-season quiet card →
  planning takeover → live hero → wrap photo nudge)
- [ ] `UpcomingEventCard` — nearest event with attendance control
- [ ] `AnnouncementBanner` — reads `announcements` table, dismissible per-device
  (`UserDefaults` stores dismissed IDs)
- [ ] Get Involved tiles (Events, Work Weekends, Committees)
- [ ] Around the Resort tiles (Cabin Stay, Local Places, Activities)

**Feed tab:**
- [ ] `PostsView` — `LazyVStack` list with realtime Supabase subscription
- [ ] `PostCard` — avatar, name (`PrivateName` masking), text, image (Kingfisher),
  reactions, comment count
- [ ] `PostComposer` — text + `PhotosPicker`, `@mention` autocomplete
- [ ] `CommentsView` — sheet with comment list + composer, `@mention` support
- [ ] Report button → `report_content` RPC

**Profile tab:**
- [ ] Avatar display + `PhotosPicker` crop + upload
- [ ] Edit name, phone, birthday, bio
- [ ] `NotifPrefsView` — checkboxes for `notif_types`
- [ ] `PushToggleView` — APNs permission request + `push_types` prefs
- [ ] Sign out
- [ ] Admin section (gated by `isAdmin`) — stub with placeholder views

**Deliverable:** A real member can sign in, browse the feed, post a photo, and
update their profile. Push notifications arrive for chat mentions.

---

### Phase 2 — Family Fest & Events (Week 7–10)

**Goal:** The Family Fest tab is fully functional, plus the Events calendar.

**Family Fest tab:**
- [ ] `FestOverviewView` — poster + `FestStatus` + next-up event
- [ ] In-section sub-nav (horizontal `ScrollView` of chip buttons — Schedule /
  Dinners / Crew / Photos / Pay / Shirts) — mirrors `FamilyFestNav`
- [ ] `FestScheduleView` — grouped list of schedule items + `THINGS_TO_DO`
- [ ] `FestScheduleDetailView` — single event, location (gated for guests),
  leads/crew contacts
- [ ] `FestDinnersView` — dinner cards with chef, menu blurb
- [ ] `FestDinnersDetailView` — crew list, location (gated)
- [ ] `FestCrewView` — households signed up, `CrewSignupSheet`
- [ ] `FestPhotosView` — photo grid (Supabase storage), upload via `PhotosPicker`
- [ ] `FestPayView` — Venmo/Zelle/Apple Cash buttons (deep links)
- [ ] `ShirtVoteView` — design gallery, lightbox, link out to Google Form

**Events calendar:**
- [ ] `EventsView` — grouped by date, DB rows merged with seed events (Family
  Fest synthesized from `FAMILY_FEST` dates in code — same logic as `lib/events.ts`)
- [ ] `EventSheet` — who's going, per-day RSVP picker for multi-day events
- [ ] `AttendanceControl` — three-way segmented control, fires `upsert_event_attendance`
- [ ] `EventComposer` (admin only) — create/edit DB events

**Deliverable:** A complete Family Fest section that reacts to the current phase.
Members can RSVP to events.

---

### Phase 3 — Social & People (Week 11–13)

**Goal:** Committee chat, people directory, notifications feed, Help Requests.

**Activity tab:**
- [ ] `NotificationsView` — feed from `notifications` table, realtime
- [ ] Per-item actions: navigate to the referenced post / event / chat message
- [ ] Unread badge on tab icon via `UNUserNotificationCenter` + Supabase realtime
- [ ] Mark-as-read on tab open

**People:**
- [ ] `PeopleDirectoryView` — `List` + `.searchable`, avatar, name, quick actions
- [ ] `MemberSheetView` — full profile, contact buttons, Apple Cash / Venmo links
- [ ] Email group composer (admin or all-member, same as `EmailMembersSection`)

**Committees:**
- [ ] `CommitteesView` — list, join request flow
- [ ] `CommitteeDetailView` — roster, description, admin approve/decline
- [ ] `CommitteeChatView` — realtime chat, `@mention` scoped to committee roster,
  edit/delete within 24h, tombstone for deleted messages

**Help Requests (Beta):**
- [ ] `AskForHelpSheet` — category picker, description, people count, location
  (native `CoreLocation` GPS pin — much cleaner than the web)
- [ ] `HelpRequestsView` — open requests log, On My Way button
- [ ] `WillingToHelpToggle` in Beta section of Profile

**Deliverable:** Full social layer functional. Committees chat works. Help Requests
beta works with real GPS.

---

### Phase 4 — Admin, Moderation & Polish (Week 14–16)

**Goal:** Admins can do everything from the iOS app.

- [ ] `AdminMembersView` — promote/remove admin, toggle beta tester, remove member
- [ ] `AdminAlertComposer` — post announcement with expiry picker
- [ ] `AdminNotificationComposer` — broadcast to Everyone / Beta / Admins
- [ ] `AdminModerationView` — content review queue, approve/remove
- [ ] `AdminCabinBookings` — approve/deny stay requests
- [ ] `AdminSigninsView` — recent sign-ins with location
- [ ] `PreviewAs` — view-as-member/guest mode (device-local UI only)
- [ ] `WelcomeIntroView` — first-run onboarding sheet for new members
  (mirrors `WelcomeIntro`): collect phone + birthday + payment handle, push
  prefs, land on Home
- [ ] `CabinRequestSheet` — full booking request form

**Polish:**
- [ ] `SplashIntro` — branded launch animation (replace the default Xcode splash
  with the green MLR logo animating into the header, using a SwiftUI transition)
- [ ] Haptic feedback on attendance control, post reactions, help requests
- [ ] `.refreshable` (pull-to-refresh) on Feed, Notifications, Events
- [ ] Empty states for every list
- [ ] Error states with retry
- [ ] Skeleton loading placeholders mirroring `SkeletonList`
- [ ] Reduce Motion support (`UIAccessibility.isReduceMotionEnabled`)

**Deliverable:** Feature-complete app ready for TestFlight beta.

---

### Phase 5 — TestFlight Beta (Week 17–18)

**Goal:** Real family members test the app before App Store submission.

- [ ] Create App Store Connect record
- [ ] Configure APNs Auth Key in the developer portal, wire into `apns-sender.js`
  on the Mac mini
- [ ] Build + archive in Xcode Cloud (or locally), upload to TestFlight
- [ ] Invite iOS family members as external testers
- [ ] Collect feedback via TestFlight crash logs + feedback
- [ ] Fix critical issues, re-distribute
- [ ] Write App Store copy (name, subtitle, description, keywords)
- [ ] Capture screenshots (iPhone 15 Pro Max, iPhone SE, iPad optional)

---

### Phase 6 — App Store Submission (Week 19–20)

**Goal:** App live on the App Store.

- [ ] Submit for App Review (expect 1–3 business days for a straightforward app)
- [ ] Address any review rejections (common: missing privacy policy URL, unclear
  permission request strings in Info.plist)
- [ ] Publish
- [ ] Announce to the family with a TestFlight → App Store migration path
- [ ] Monitor crash reports in Xcode Organizer / App Store Connect

---

### Phase 7 — Native Extras (Post-launch, opportunistic)

These aren't blockers but are easy wins that a native app enables:

- [ ] **WidgetKit:** "Days until Family Fest" countdown widget for the Home Screen
  (small + medium sizes). Reads `FAMILY_FEST.startDate` from a shared App Group
  `UserDefaults`.
- [ ] **Live Activities:** During the Fest week, a Lock Screen / Dynamic Island
  activity showing "Day 3 of 6 — Today: Fish Fry at 6pm" — updated from the
  schedule data.
- [ ] **App Clip:** An NFC tag at the resort office opens a lightweight App Clip
  for cabin check-in / stay request — no full install required for a first-time
  guest.
- [ ] **Share Extension:** "Post to MLR" appears in the iOS share sheet when
  sharing a photo from the Photos app.
- [ ] **Siri App Intent:** "Hey Siri, what's happening at the resort?" →
  `UpcomingEventsIntent` reads the next event and speaks it.
- [ ] **iPad support:** The SwiftUI layout needs a sidebar/column split (replace
  `TabView` with `NavigationSplitView` on iPad) — low effort with SwiftUI.

---

## Media Server Changes

The Mac mini's `media-server/` needs two additions:

1. **`apns-sender.js`** — Listens to the same Supabase Realtime channels as
   `push-sender.js` but reads `apns_subscriptions` and delivers via APNs using the
   `apns2` npm package + your `.p8` key. The filter-by-`push_types` logic is
   identical; only the delivery mechanism changes.

2. **Environment variables to add:**
   - `APNS_KEY_ID` — from developer.apple.com
   - `APNS_TEAM_ID` — your Apple team ID
   - `APNS_KEY_PATH` — path to the `.p8` file on the mini
   - `APNS_BUNDLE_ID` — `com.muskellungelakeresort.mlr`

No changes to the upload server, transcoder, mailer, or existing push sender.

---

## Key Ports: TypeScript → Swift

These are the non-UI modules that need a clean port (no UI dependency, pure logic):

| TypeScript file | Swift equivalent | Notes |
|---|---|---|
| `lib/festSeason.ts` | `FestSeason.swift` | Byte-for-byte logic port |
| `lib/format.ts` | `Formatters.swift` | Use `DateFormatter`, `NumberFormatter` |
| `lib/events.ts` | `EventsService.swift` | DB+seed merge, `effectiveStatus()` |
| `lib/helpRequests.ts` | `HelpService.swift` | `helpTargeting()`, presence logic |
| `lib/privacy.ts` | `PrivacyHelpers.swift` | `PrivateName`, `Protected` views |
| `lib/data.ts` | `SeedData.swift` | Committees, dinners, activities, places |
| `lib/places.ts` | `SeedData.swift` (extend) | Local places |
| `lib/moderation.ts` | `ModerationService.swift` | Client-side text checks |

---

## What You Do Not Need to Port

| Web-only concern | Why skip it |
|---|---|
| `public/sw.js` service worker | iOS handles push natively; no SW needed |
| Web Push / VAPID (`lib/push.ts`) | Replaced by APNs in `PushService.swift` |
| `InstallHint` / `InstallButton` | App is already installed |
| `InstallFirstNudge` | iOS PWA double-sign-in issue is gone |
| `WelcomeCard` (browse-first nudge) | Less relevant in a native app context |
| `next/font` / Tailwind CSS | Replace with embedded font files + `Colors.swift` |
| `app/globals.css` CSS variables | Replace with `Colors.swift` + SwiftUI tokens |
| `SplashIntro` FLIP animation | Rebuild as a SwiftUI transition, same idea |
| `/api/assistant` Next.js route | iOS app hits the Vercel URL directly |
| `output: export` / Pages build | Web concern only |
| `DemoDateProvider` | Keep for testing (inject `now:` param into `FestSeason.compute()`) |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Two codebases diverging on features | Any Supabase migration that adds a column or table must be reflected in both Swift models and TS types in the same PR. Add a checklist item to the migration template. |
| APNs token rotation | `reconcilePush()` equivalent: on every app foreground, re-register and upsert the token — Supabase's `unique` constraint on `device_token` handles duplicates cleanly. |
| App Store review rejection | Common causes: missing `NSPhotoLibraryUsageDescription` / `NSLocationWhenInUseUsageDescription` in Info.plist, missing privacy policy URL. Add these early. |
| Family Fest dates in both repos | `FAMILY_FEST.startDate` / `.endDate` in `lib/data.ts` (web) and `SeedData.swift` (iOS) are the two sources. A comment in both files pointing to the other is the minimum; a YAML/JSON config read by both would be the clean solution later. |
| Media server availability | If the mini is down, uploads fail gracefully (error state + retry). Reads (posts, profiles) go directly to Supabase and are unaffected. |
| Supabase RLS for APNs table | New `apns_subscriptions` table needs RLS from day one: `own rows only` for reads/writes, service role for the mini's APNs sender. |

---

## Success Metrics

- A family member on iPhone can sign in, RSVP to the next event, post a photo to
  the feed, and receive a push notification when someone comments — without ever
  visiting a browser.
- Family Fest week: the Live Activities / Lock Screen shows today's schedule item.
- All existing Supabase data is identical between the web and iOS apps — no forks,
  no parallel databases.
- Android users and desktop users have zero degraded experience on the web PWA.
