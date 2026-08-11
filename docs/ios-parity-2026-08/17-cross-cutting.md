<!-- generated from the ios-parity workflow; source of truth is mlr-app @ main -->

[← back to the index](../ios-parity-2026-08.md)

> ⚠️ **NOT fact-checked.** The verification pass for this section did not run (session limit). Treat every table/column/RPC name as needing confirmation before you build against it.

### Cross-cutting UX, caching and routing

This is the section that decides whether the native app *feels* like the flagship or like a
port. None of it is a feature a family member would name, and all of it is what they notice:
whether the app opens already showing their stuff, whether tapping a notification lands on the
thing the notification was about, whether an unverified newcomer sees an explanation or a screen
full of empty lists.

**No backend change is needed anywhere in this section.** Every gate, flag and deep-link string
already exists in Supabase and is already produced by shipped triggers/RPCs. The one thing that
is genuinely absent server-side is a minimum-app-version signal (see §9) — and the recommendation
there is to skip it for v1 rather than add a table.

---

#### 1. The privacy wall — THREE viewer states, not two

The web app is **public to browse**. Identity is required only to *do* something, and a
"signed-in" account is not automatically a member. There are three states, and iOS needs all
three or the middle one produces a broken-looking app.

| State | Web source of truth | What the viewer sees |
|---|---|---|
| **Guest** (no session) | `user == nil` | Browsable content; sensitive bits replaced with a tappable "🔒 Sign in" affordance; whole-screen walls on `/posts`, `/polls`, `/people`, `/pay` |
| **Signed in, NOT admin-verified** | `profiles.approved = false` | **Treated exactly as a guest**, plus an explicit "You're signed in — almost there" explanation that an admin must okay them and there is nothing more to do on their end |
| **Verified member** | `profiles.approved = true` (or `is_admin`) | Everything |

The one hook that answers this is `useGuest()` in `components/Guard.tsx`:

```ts
// components/Guard.tsx — the exact returned shape
{ guest, signedIn, resolving, awaitingVerification, promptSignIn }

const awaitingVerification = isSupabaseConfigured && !!user && !verified;
const guest               = isSupabaseConfigured && (!user || !verified);
const resolving           = isSupabaseConfigured && !authReady && !user;
```

Three UI primitives consume it and are worth mirroring one-for-one, because the copy differences
between them are the whole point:

- `SignInWall({ title, note, children })` — whole-screen gate. Renders a **skeleton** while
  `resolving`, the "almost there" card while `awaitingVerification`, the sign-in card for a
  guest, the children for a member.
- `Protected({ children, label })` — inline gate for one phone number / email / location.
  A guest gets a tappable `🔒 {label}` chip; an unverified member gets a **non-interactive**
  `🔒 Waiting to be approved` chip.
- `PrivateName({ name })` — full name for members, **first name only** for guests
  (`firstName()` in `lib/privacy.ts`: `name.trim().split(/\s+/)[0]`).

**Database side (already live).** Migrations `0181_member_approval`, `0182_auto_approve_preregistered`,
`0183_verified_member_reads`, `0184_approve_gate_email_directory`:

- Columns: `profiles.approved boolean not null default false`, `profiles.approved_at timestamptz`,
  `profiles.approved_by uuid references profiles(id) on delete set null`.
- `is_approved_member()` — `SECURITY DEFINER`, `stable`, granted to `authenticated, anon`. Returns
  true when the caller's own profile has `approved is true OR is_admin is true`.
- `set_member_approved(p_user uuid, p_value boolean)` — admin-only; the ONLY write path
  (`approved` is not in any client update grant).
- `is_preregistered_email(p_email text)` + an `auto_approve_preregistered()` signup trigger:
  12 emails already on a roster are approved automatically at signup.
- 0183 rewrote **29 SELECT policies** onto `is_approved_member()`.

**RLS read rules that matter to this section, one line each:**

- `profiles` — readable by an approved member, **plus your own row unconditionally**
  (`is_approved_member() or id = auth.uid()`). Without that escape hatch an unverified member
  couldn't read their own profile, so you couldn't even *detect* that they need the waiting
  screen. An empty result here means the session is gone, not that the person has no profile.
- Everything members-only (`posts`, `post_comments`, `post_media`, `committee_roster`,
  `event_attendance`, `work_items`, `houses`, `polls`, `drop_boxes`, …) — approved members only.
  **An empty array from any of these is "not permitted", not "no data."**
- Public-read regardless of session: `events`, `cabins`, `announcements`, `committees`,
  `committee_areas`, `app_images`, the `fest_content` tables, `resort_config`. An empty result
  there really does mean no rows.

**Swift shape.** Model it as one enum, resolved in one place, and never re-derive it from a raw
session lookup:

```swift
enum ViewerState: Equatable {
    case resolving          // session read hasn't settled AND no cached identity
    case guest              // no session
    case awaitingApproval   // session, profiles.approved == false
    case member(isAdmin: Bool)

    var isGated: Bool { self == .guest || self == .awaitingApproval }
}
```

`approved` is a nullable/possibly-absent column in Swift terms, so decode it as `Bool?`:

```swift
struct ProfileGateRow: Decodable {
    let intro_seen: Bool?
    let phone: String?
    let birthday: String?          // "YYYY-MM-DD" — do NOT parse with a UTC formatter, see §6
    let pay_preferred: String?
    let invited_via: String?
    let approved: Bool?            // nil == pre-migration == TREAT AS APPROVED
}
```

⚠️ **`approved == nil` and any read error MUST resolve to APPROVED.** The web client defaults
`verified` to `true` in three separate places — initial state, read error, and column-absent —
because defaulting the other way locks real members out of their own app over a transient network
blip. Do the same, and write the reason in the code comment or someone will "fix" it later.

⚠️ **The DB column is `approved`; every string a human sees says "Verified."** Deliberate:
Supabase already owns the word "verified" for email confirmation. Do not unify them.

⚠️ **"Sign in" is the wrong call to action for an unverified member.** They already signed in
successfully. Web shipped this wrong-ish first and it produced people retrying a thing that had
worked. The unverified state gets its own copy and **no button at all**.

⚠️ **The client is not the enforcement boundary.** This is a Supabase-token app: anyone can hit
the REST API directly with their own JWT. The UI wall exists so the screen is coherent, not to
secure anything. Never "optimise" a gated fetch by skipping RLS-covered filters client-side.

⚠️ **Admin "view as" forces `verified: true` and `needsIntro: false`.** An admin checking the
guest view must not appear unverified to themselves.

**Where iOS can beat the web app.** The web's `resolving` state exists mostly because the
prerendered HTML always ships the guest view, so a returning member can flash the sign-in wall on
a cold open. On iOS the session comes out of the Keychain synchronously at launch, so the very
first frame can already be the member layout — `resolving` shrinks to "the first launch on this
device only". Keep the state (the `approved` flag still needs a network read), but expect it to be
invisible in practice.

---

#### 2. First-run onboarding (`WelcomeIntro`)

A guided sheet that pops **once**, the first time a brand-new member verifies their code.

**The gate** (`IdentityProvider.needsIntro`) is computed in a **separate, guarded** query — a
`try/catch` around a second `select` — precisely so a pre-migration column can never break
sign-in:

```ts
const sparse  = !e.phone?.trim() && !e.birthday && !e.pay_preferred;
const needsIt = !e.intro_seen && sparse;      // profiles.intro_seen — migration 0045
```

So it shows only for someone whose profile holds nothing but the name they typed. Existing members
were backfilled `intro_seen = true` by 0045 and are never re-onboarded.

**Step order is push FIRST, basics second** — deliberately, so the very first thing a newcomer
sees after verifying is "turn on notifications", not a form. Steps in `WelcomeIntro.tsx` are
`"confirm" | "push" | "basics"`:

1. **`confirm`** — shown **only** when `invitedViaLink` (`profiles.invited_via = 'invite_link'`).
   An admin invite-link email signs in *whoever clicks it*, with no code and no password, so a
   forwarded invite would silently drop the forwardee into the original invitee's account.
   ⚠️ **The step never displays the target email — the member has to type it blind**, because
   glancing at a displayed address and tapping Continue verifies nothing. After **3** wrong
   attempts it calls `signOut()` rather than ever revealing whose account it almost was, and the
   step has **no close button** — Continue or sign out are the only exits.
2. **`push`** — mounts the real `PushToggle` settings (master on by default, untick what you don't
   want), not a fake preview. Reaching it stamps `profiles.push_prompted = true` so the standalone
   `PushPrompt` never asks twice — but only `if (isPushSupported() && !(isIos() && !isStandalone()))`,
   i.e. web skips the stamp where push can't work yet. **On iOS native, always stamp it.**
3. **`basics`** — name, phone, birthday, preferred pay method. All optional; an empty form is a
   valid skip. Writes: `phone`, `birthday`, and for pay **two columns at once** —
   `row[payMethod] = handle` plus `row.pay_preferred = payMethod`, where `payMethod` ∈
   `venmo | zelle | cashapp | paypal`. The name goes through `updateUser({ name })` so the rest of
   the app picks it up.

⚠️ **`await` the name write before navigating.** An unawaited write got cut off mid-flight and
rolled the member back to the email-prefix default display name (`motu42`). The code comment says
this explicitly; keep it in the Swift port (`try await`, not a detached `Task`).

⚠️ **Dismissing (✕ / backdrop) counts as finishing the step you're on** so it never re-nags, and
the sheet hides via a local `dismissed` flag independent of the network write — otherwise a slow
`completeIntro()` strands a dimmed overlay over the app.

`completeIntro()` sets `profiles.intro_seen = true` inside a `try/catch` (a no-op pre-migration) and
clears the flag locally first.

**Where iOS can beat the web app.** Step 2 becomes a real `UNUserNotificationCenter`
`requestAuthorization` at the one moment the person actually wants notifications — a far better
prompt-conversion position than a web push permission dialog, and there is no
"add-to-home-screen-first" caveat to explain at all (§9). Birthday uses a native `DatePicker`
wheel instead of the hand-rolled `BirthdayPicker`; phone uses a `.keyboardType(.phonePad)` field
with `PhoneInput`'s formatting; the pay handle can offer paste-from-clipboard detection.

⚠️ **Do NOT port `InstallFirstNudge`.** It exists solely because iOS Safari and an installed iOS
PWA keep *separate* logins, so a guest who signs in in Safari has to sign in a second time in the
icon app. That problem does not exist for a native app. Same for `InstallHint` / `InstallButton`.

---

#### 3. The stale-while-revalidate cache and its four rules

`lib/swrCache.ts` is the single loading-stability primitive; ~20 hand-rolled per-component caches
collapsed into it. Exact surface:

```ts
useCachedResource<T>(
  key: string | null,                 // null ⇒ hook is fully INERT (no seed, no fetch, data = empty)
  empty: T,
  fetcher: () => Promise<T>,
  opts?: { persist?: "local" | "session"; ttlMs?: number },
): { data: T; loading: boolean; reload: () => Promise<void>; mutate: (next: T | ((prev: T) => T)) => void }

// also exported
readPersisted<T>(key, ttlMs?, which?) / writePersisted<T>(key, data, which?) / removePersisted(key, which?)
clearAllCaches()
```

Constants that are part of the contract: prefix `"mlr.cache.v1."` (bump to invalidate everything),
`MAX_PERSIST_BYTES = 200_000` (oversized snapshots stay memory-only, silently),
`DEFAULT_TTL_MS = 24h`, envelope `{ ts: number, data: T }`.

Semantics worth copying exactly:

- **Two layers.** A module-level memory `Map` (survives in-session screen remounts) and an optional
  persisted copy (paints the last known data on the *next* app open).
- `loading` is `true` **only when nothing could seed**. A warm seed serves stale immediately with
  `loading: false` while the background revalidate runs.
- **In-flight dedup per key** — two screens mounting the same key join one request.
- A rejected fetch **never sticks on loading** (`setLoading(false)`, keep the stale data).
- `commit()` writes the memory/disk copy **even if the component unmounted** — "don't lose the fetch".
- `reload()` *replaces* any stale in-flight entry; `mutate()` writes state + memory + disk in one
  call and is the optimistic-update path.
- `markPending(key)` fires **only on a cold load** (see §4).

**The four rules.**

**Rule 1 — memory seeds synchronously, storage seeds post-mount. ⛔ WEB-ONLY; do not port.**
The reason is React hydration: the prerendered HTML is always the guest/empty view, so the first
client render must match it byte-for-byte. Module memory is empty at cold boot so it's safe in a
`useState` initializer; a persisted snapshot is read **only inside an effect**. SwiftUI has no
hydration, no server-rendered HTML, and no mismatch to make. **On iOS, read the disk snapshot
synchronously before the first frame** — that is strictly better, and it is the native version of
the property this rule was fighting to get. (Same for `useUrlParam` being effect-only, and
`FeedView`'s `useIsoLayoutEffect` — both are hydration accommodations. See §9.)

**Rule 2 — user-scoped keys embed the auth uid.** These are the real keys in the web app; keep the
same shapes so the two apps are debuggable side by side:

```
identity.<uid>                      myHouse.<uid>            feed.<uid>
events.<uid|guest>                  unread.<uid>             notifFeed.<uid>
postsFeed.<uid>                     people.<uid>             polls.<uid>
activePoll.<uid>                    calloutsDone.<uid>       workChecklist.<uid|guest>
helpRequests.<uid>                  festMember.<uid>         dropBoxes.<uid>
dropBox.<uid>.<boxId>               privateActivities.<uid>  tournament.<uid>.<hostId>
chatRoom.<uid>.<slug>|<area>        houseChatRoom.<uid>.<slug>
chatPolls.<uid>.<roomKey>           meetings.<uid>.<roomKey>      # roomKey = c:<slug>|<area> or h:<houseId>
resolvedHouse.<uid>.<slug|"mine">.<isAdmin>                   chatEntry.<uid>.<slug>
managedCommittee.<uid>.<slug>.<isAdmin>
houseCalendar.<houseId>             houseLists.<houseId>
whosUpNorth.<uid>.<date>            birthdays.<uid>.<date>       onThisDay.<uid>.<date>
festContent   appImages   weather                            # public, unscoped
```

⚠️ **Pass `key = nil` while the uid is unresolved.** The hook stays inert, so another account's
rows can never seed into the current viewer's screen. In Swift this is `key: String?` on the
loader, not an `if let` around the call site — the call must still happen so the view's state
machine is consistent.

⚠️ **Day-fresh data embeds the local date** (`birthdays.<uid>.<today>`), so a stale day never
paints. The web computes that day key from **local** date parts, never `toISOString()`. In Swift
use `Calendar.current` components, not an ISO8601 UTC formatter — this app has already been bitten
once by UTC/date-string skew (§6).

**Rule 3 — preview mode never persists.** While an admin is "viewing as" someone, the caller
passes `persist: undefined` *and* puts the preview id in the (memory-only) key:

```ts
// components/HouseHubCard.tsx — the reference pattern
const key = user && userId ? (previewAsId ? `myHouse.preview.${previewAsId}` : `myHouse.${userId}`) : null;
useCachedResource(key, null, () => fetchMyHouse(previewAsId ?? userId),
                  { persist: previewAsId ? undefined : "local" });
```

Same for `activePoll.preview.<id>`, `chatEntry.preview.<id>.<slug>`, `resolvedHouse.preview.…`.
⚠️ If a preview snapshot ever lands on disk, the admin's *next* real cold open paints the previewed
member's data as their own.

**Rule 4 — `signOut()` calls `clearAllCaches()`.** It wipes the memory map, the in-flight map, and
**every `mlr.cache.*` key in both storages**, so nothing outlives an account switch on a shared
device. `signOut()` additionally calls `clearMediaToken()` and clears the preview key.
Uid-scoped keys are the *second* line of defence for the token-expiry path where `signOut()` never
runs — leftover entries are inert without a session.

⚠️ **Deliberately NOT cleared on sign-out** (device preferences, not account data): `mlr-text-scale`,
`mlr-welcomed`, `mlr-dismissed-announcements`, `mlr.callouts.dismissed`, `mlr.callouts.wiggled`,
`mlr.installNudge.seen`, `mlr.dropbox.sort`, `mlr.flaggedPosts`, `mlr-demo-date`,
`mlr.chunkRecovery.lastReload`. Port that split intentionally: text size and "I've seen the
welcome card" belong to the device; feed snapshots belong to the account.

⚠️ **Two entries are TRIMMED snapshots, not full data**, because of the 200 KB cap:
`postsFeed.<uid>` keeps roughly the **top ~15 posts** with their comments/reactions/members, and
`chatRoom.*` / `houseChatRoom.*` keep the **last ~30 messages** plus access/roster. Never persist
full history. On iOS the cap is yours to choose — but keep a cap, or a big album's snapshot turns
a launch into a multi-megabyte JSON decode on the main thread.

⚠️ **Caching a chat room's messages on disk was an owner-approved trade-off**, on the grounds that
the member can already read that room. It is uid-scoped and wiped on sign-out. Do not extend that
reasoning to anything the viewer *can't* already read.

**Swift shape.** An `actor` cache plus a small `@Observable` loader per resource:

```swift
struct Envelope<T: Codable>: Codable { let ts: Date; let data: T }

actor CacheStore {
    private var memory: [String: Any] = [:]
    private var inFlight: [String: Task<Any, Error>] = [:]   // dedup, mirrors `inflight`
    // Disk: Application Support/mlr.cache.v1/<sha256(key)>.json — NOT Caches/,
    // which iOS may purge under pressure and would silently reintroduce cold opens.
}
```

- Use `Task` cancellation instead of the web's `cancelled` boolean: `.task(id: key)` on the view
  cancels the previous load when the key changes, which is exactly what
  `useCachedResource`'s `[key]` effect dependency does. ⚠️ Still write the fetched value into the
  cache on cancellation (`commit` before the cancellation check) — the web comment "cache even if
  unmounted — don't lose the fetch" is a real perf property.
- `mutate` is the optimistic path (`await store.set(key, value)` then update the published state);
  `reload` replaces the in-flight task rather than joining it.
- Never store a `Date` as an ISO8601-UTC string in the *key*; the payload is fine.

**Where iOS can beat the web app.**
- No 200 KB quota and no synchronous localStorage — the snapshot can be the full feed, decoded off
  the main actor.
- `URLCache` handles media/HTTP caching for free, which the web only gets because the media token
  is *stable per 24h window* (a per-request token would bust every image cache). On iOS you can go
  further: send the media token as `Authorization: Bearer <mediaToken>` — the mini's
  `requireMediaToken` accepts **either** `?t=` or a Bearer header — so `URLCache` keys on the clean
  URL and the token never appears in a URL, a log line, or a shared screenshot.
- Real offline reads: the disk snapshot plus `URLCache` means an iPhone with no signal at the lake
  (which is the actual physical situation) can still show the feed, the schedule and cached photos.
  The web app cannot, because its service worker deliberately caches nothing.

---

#### 4. The readiness registry behind the launch hold

`lib/appReady.ts` is 70 lines of plain module state, no React:

```ts
markPending(key: string): () => void   // called by useCachedResource ONLY when nothing seeded
isQuiet(): boolean
onQuietOnce(capMs: number, cb: () => void): () => void   // returns a cancel fn
```

`SplashIntro` holds the app-open overlay until **`authReady`** (the session read settled) and then,
on a cold open, up to **`EXTRA_QUIET_MS = 700`** more while cold data loads land. Other constants:
`HOLD_MS = 1300` minimum hold, `FLY_MS = 720`, and **`MAX_WAIT_MS = 4500` which always wins**.
On a warm open every screen seeds instantly, nothing registers, and the hold adds ~0 ms.

⚠️ **`onQuietOnce` defers its first "am I already quiet?" check by a microtask** so loads registered
in the same commit are counted first. Without that it concludes "quiet" before anything registered
and the hold does nothing. In Swift the equivalent is a `Task.yield()` (or one run-loop hop) before
the first check — this is the single easiest thing to get subtly wrong.

⚠️ **The cap is not optional.** Every path out of the hold must be bounded, and the web has *two*
independent safety nets: the JS `MAX_WAIT_MS` timer and a pure-CSS `splash-wash` animation
(6000 ms) that clears the overlay even if JS never runs. A launch gate with no ceiling is an app
that won't start on a bad network.

**Do not port the splash animation itself.** The web splash pops the green logo centre-screen and
then FLIP-translates/scales it into the header's `#app-logo` slot, with the header copy held at
`opacity: 0` via `html[data-splash] #app-logo` so there's no second copy to blur against. That
whole mechanism exists because the web has no launch screen. iOS has one: use a `LaunchScreen`
storyboard/asset with the same green mark, then `matchedGeometryEffect` (or a simple scale/position
transition) into the Home header if you want the same "placed there" feel. Reduce-motion
(`UIAccessibility.isReduceMotionEnabled` / `@Environment(\.accessibilityReduceMotion)`) must skip
straight to the app — web checks `prefers-reduced-motion` in three places for this.

Also: a "bare route" concept exists (`lib/bareRoutes.ts`, `["/family-fest/master"]`) so the fest
master editor, when opened *from the iOS app*, drops straight in with no splash/install nag. If
iOS still opens that editor in a web view, keep passing that route.

**Where iOS can beat the web app.** The readiness registry is worth keeping as a real concept
(`LaunchGate` with `register(key:)` / `awaitQuiet(cap:)`), because "hold the launch screen until
the first screen is actually complete" is exactly what a premium native app does — and on iOS you
can hold the system launch screen rather than paint a fake one over the app.

---

#### 5. Deep-link routing, and the flash-the-target behaviour

Every notification row carries a ready-made in-app path in `notifications.url`, built server-side
by the fan-out triggers. **The same string arrives in the APNs payload**, so iOS must parse the
identical set. This is the complete inventory as built by the migrations:

| Path | Produced by | Lands on |
|---|---|---|
| `/posts?post=<postId>` | `new_post`, `post_reaction`, `post_mention` | Main Feed, scrolled to that post |
| `/posts?post=<postId>&comment=<commentId>` | `post_comment`, `post_reply`, `post_mention` (0164) | …and scrolled to that **comment** |
| `/posts?c=<committeeSlug>&m=<messageId>[&area=<areaName>]` | `chat_mention` (0063) | Committee/area room, scrolled to that message |
| `/posts?house=<houseSlug>&m=<messageId>` | house `chat_mention` (0065) | House room, scrolled to that message |
| `/posts?c=<slug>[&area=…]&poll=<pollId>` | `chat_poll_created` (0149) | Room, at the inline poll card |
| `/posts?feed=main` | fest wrap CTA | Main Feed, no particular post |
| `/?work=<workItemId>` | `work_item_created`, `work_item_comment`, `work_item_mention` | Home, opens the work-item sheet |
| `/events?open=<eventId>` | event notifications | Events, opens that event |
| `/events?activity=<privateActivityId>` | `private_activity_invite`, tournament pings for a private activity | Events, opens that activity |
| `/events?meeting=<meetingId>` | `meeting_proposed`, `meeting_scheduled` (family scope) | Events, opens the scheduler |
| `/house/calendar?house=<houseSlug>` | `house_stay_created` | House calendar |
| `/people?member=<userId>` | directory links | Opens that member's sheet |
| `/family-fest/schedule/<itemId>` | `signup_reminder`, callout "Sign up" | Schedule item detail |
| `/drop?box=<boxId>` | callout `drop_box_id` (0172) | Drop box folder |
| `/request-stay` | `cabin_message`, cabin decisions | Cabin bookings |
| `/admin/cabins?booking=<id>`, `/admin/committees?committee=<slug>` | admin notifications | Admin sub-pages |

⚠️ **`/chat?m=<id>` is LEGACY** (migration 0030) and was superseded by the `/posts?c=…&m=…` form in
0063. Older notification rows may still carry it. Handle it as an alias, not a live shape.

⚠️⚠️ **Never route to `/committees/<slug>/chat`.** In the installed PWA that navigation dies in the
app container *before React runs* — WebKit's own "This page couldn't load" screen — while opening
the same room through the Feed works. Every server-side check comes back healthy (HTML 200, RSC
200, clean console), so it is invisible outside a real installed PWA; three fixes failed before the
cause was found. On iOS native this specific failure won't reproduce, but the **URL contract still
matters**: notification rows in the database use the Feed form, so parse `/posts?c=…&area=…&m=…`
and open your committee room from it. Also honour `&from=<slug>` — web uses it to make Back return
to the committee page instead of the chats list.

**The two-hook web mechanism, and what it's compensating for:**

- `useUrlParam(name)` (`lib/hooks.ts`) — reads one query param **reactively**. It one-time
  monkey-patches `history.pushState`/`replaceState` to dispatch a custom `mlr:locationchange` event,
  and also listens to `popstate`. Reason: Next doesn't remount on a `router.push()` to the *same*
  route, so tapping a second notification while already on `/posts` would otherwise be a no-op —
  and `useSearchParams` would force a Suspense boundary around the whole page.
- `useDeepLinkFlash(idPrefix, target, ready)` — once `target` and `ready` are both set, polls for
  `document.getElementById(idPrefix + target)` **every 150 ms up to 20 attempts (~3 s)**, then
  `scrollIntoView({ block: "center" })` and sets a flash id that a ring class reads, cleared after
  **2200 ms**. Two behavioural details are deliberate and should survive the port:
  - The **first** landing in a mount snaps (`behavior: "auto"`), because the viewer hasn't been
    shown anything to scroll *from* yet and an animated scroll reads as an extra hop. A **later**
    deep-link (second notification, no remount) scrolls **smoothly**, because there the motion is
    the useful cue that the view moved.
  - It re-arms whenever `target` changes, and `PostsView` runs **two independent instances**
    (`"post-"` and `"comment-"`) side by side.

⚠️ **The polling exists because the DOM node may not exist yet** — a long list still rendering, or
a trimmed cold-open snapshot that doesn't contain an older item the full fetch hasn't landed yet.
Whatever you do on iOS, handle "the target isn't in the data yet": await the real fetch, and if the
id still isn't present, land on the screen rather than nowhere.

⚠️ **`FeedView` holds a "Loading…" instead of flashing the chats list** while a `?c=`/`?house=`
deep-link resolves (`bootChannelKey` / `bootHouseSlug`, captured at mount). Without it a member who
*is* in a house/committee sees the plain chats list for a beat and then gets "hopped" to the room —
the deep link works but reads as broken. Reproduce that: a deep-linked launch should never paint the
list state at all.

**Swift shape — parse into a type, never route on strings:**

```swift
enum DeepLink: Equatable {
    case post(id: String, comment: String? = nil)
    case mainFeed
    case committeeRoom(slug: String, area: String?, message: String?, poll: String?, from: String?)
    case houseRoom(slug: String, message: String?)
    case workItem(id: String)
    case event(id: String)
    case privateActivity(id: String)
    case meeting(id: String)
    case houseCalendar(houseSlug: String?)
    case member(id: String)
    case scheduleItem(id: String)
    case dropBox(id: String)
    case cabinBookings
    case admin(AdminDestination)

    init?(path: String)   // accept the LEGACY /chat?m= alias here, in one place
}
```

Drive it into a single `@Observable` router (`var pending: DeepLink?`) consumed by the tab
container, so the same code path serves: a cold launch from a notification
(`UNNotificationResponse` in `didFinishLaunching`), a tap while running
(`userNotificationCenter(_:didReceive:)`), a Universal Link, and an in-app tap.

⚠️ **A cold launch from a notification must not lose the link while auth resolves.** Queue it and
replay it after the viewer state settles — this is the native analogue of the bug `PushDeepLink`
was written to fix (the SW's `client.navigate()` rejecting in an installed PWA, swallowing the
error, and just focusing the app on whatever page it already showed).

**Where iOS can beat the web app — this is the biggest win in the section.**
- `ScrollViewReader.scrollTo(id, anchor: .center)` over a `List`/`LazyVStack` with stable ids
  replaces the 3-second DOM poll entirely: await the fetch, then scroll. No retries, no race.
- The flash becomes a real transition (`.overlay` ring with `withAnimation`) plus
  `UIImpactFeedbackGenerator` — a native "here it is" cue the web can't produce.
- **Actionable notifications**: `UNNotificationCategory` actions let "On my way" (Ask for Help),
  RSVP Going/Can't-make, and Approve/Remove (moderation) happen from the lock screen without
  opening the app. Every one of those already has an RPC.
- **App icon badge** from the same unread count the tab badge uses (§7).
- **`NSUserActivity`** on each screen gives Handoff and Spotlight for free, and the same
  `DeepLink` enum backs **App Intents / Shortcuts** ("Hey Siri, who's up north?").
- **Universal Links** make the shareable web URLs (`/drop?box=<id>`, `/posts?post=<id>`) open the
  native app instead of Safari — worth doing, since the family shares those links in iMessage.

---

#### 6. Text size

Web: `TextSizeControl` writes `localStorage["mlr-text-scale"]` ∈ `normal | large | largest` and sets
`document.documentElement.style.fontSize` to **17 / 19 / 21 px**. A blocking inline script in
`app/layout.tsx` re-applies the saved choice **before first paint** so there's no flash of small
text. `body { font-size: 1rem }` and everything else being rem-based is what makes one knob scale
the whole app.

```
⚠️ globals.css: "don't re-pin a px font-size on body/html or you break it."
```

⛔ **Do NOT port the three-button control.** It exists only because the web has no access to the
OS text-size setting. **iOS gets this for free and better**: use Dynamic Type
(`.font(.body)` etc., `@ScaledMetric` for spacing, `UIFontMetrics` for anything custom) and honour
the system size the person already chose in Settings, including the accessibility sizes the web's
21 px ceiling can't reach.

⚠️ **Layout must survive the largest accessibility sizes.** The web control caps at 21 px; iOS
Dynamic Type goes far past that. Audit every card, chip and tab label at `AX5`, and prefer
`ViewThatFits` / wrapping over truncation for member names and event titles.

⚠️ **The readability floor is a hard product rule, not a style preference.** `--color-muted`
(`#4b5b52`) and `--color-faint` (`#64716a`) exist because `text-foreground/40` reads too faint for
older eyes, and ~40 components were swept onto them. **Never express secondary text as an opacity
on the foreground colour** — define `Color.mlrMuted` / `Color.mlrFaint` as real semantic colours
with their own dark-mode values.

⚠️ **Doc drift to verify:** `CLAUDE.md` says pinch-zoom is now allowed (`userScalable: true`), but
`app/layout.tsx` currently ships `maximumScale: 1, userScalable: false` with a comment saying zoom
was turned off because stray pinches were zooming the layout. The code is authoritative; the doc is
stale. On iOS this is moot (no page zoom), but it tells you the *intent*: text scaling is the
supported path, not zoom.

---

#### 7. Navigation shell: tabs, badges, and the scroll/overlay rules

`components/TabBar.tsx`'s `TABS` array is the single source of truth for routes + labels + icons:

```
/            Home         icon "home"
/posts       Feed         icon "feed"
/family-fest Family Fest  icon "fest"     (tent)
/notifications Activity   icon "bell"
/profile     Profile      icon "person"
```

Active detection: `tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href)`.
Two live decorations ride on it, both worth porting:

- **Unread badge on Activity** — `useUnreadNotifications()`, rendered as a count pill,
  `> 99` shows `99+`, animated via `AnimatedNumber`. Cache key `unread.<uid>`.
- **Live dot on Family Fest** — a pinging dot whenever `getFestSeason(...)` is `isLive || isWrap`,
  and the tab wears `--color-fest` (heraldic wine `#8b2e2e`) rather than forest green, so the fest
  reads as its own theme from anywhere in the app.

⚠️ **`People` is NOT a tab** (it moved to a Home tile) and `Profile` IS the last tab (it moved back
from a header avatar). This has been reversed before — don't "improve" it without asking.

⛔ **Three shell mechanisms are pure WebKit workarounds. Do not port any of them:**

1. **The single scroll container.** `html, body { height: 100%; overflow: hidden }` and `#app-scroll`
   (the `<main>`) is the app's one and only scroller, with `overscroll-behavior-y: contain`. This
   buys real iOS rubber-band bounce *without* the classic WebKit bug where dragging past the
   document's top/bottom drags `position: fixed` elements (the TabBar) along with it — the TabBar is
   a **sibling** of `#app-scroll`, not a descendant. SwiftUI's `TabView` + `ScrollView` has none of
   this. Related: `ScrollReset` resets `#app-scroll` to top on every navigation because it lives in
   the persistent layout and doesn't remount — `NavigationStack` does this for free.
   ⚠️ One real lesson survives: the bottom clearance for the tab bar is padding on an **inner
   content wrapper**, not `padding-bottom` on the scroller, because iOS Safari drops the latter. The
   native analogue is `safeAreaInset(edge: .bottom)` — use it rather than hardcoded padding.
2. **`ModalPortal`.** Any full-viewport overlay that isn't a `Sheet` must portal to `<body>`, because
   `.page-enter`'s slide-in transform makes the route wrapper a **permanent** containing block and
   stacking context for `position: fixed` descendants on iOS Safari — even after the animation ends
   (the `backwards` fill removes the transform at rest, which is exactly why it looks fine on
   desktop and in dev). An inline `fixed inset-0` overlay gets clipped to the page box and confined
   below the TabBar's `z-40`. **On iOS use `.sheet` / `.fullScreenCover` and this class of bug
   cannot occur.**
3. **`KeyboardInset` + the TabBar's keyboard hide.** The iOS software keyboard *overlays* the layout
   viewport instead of shrinking it, so web has to measure `visualViewport` and feed a
   `--keyboard-inset` custom property, and slide the fixed TabBar off-screen when the keyboard
   opens. ⚠️ There's a real bug recorded in `TabBar.tsx`: iOS fires a `visualViewport` resize with
   *wrong* dimensions during the background→foreground transition, which locked the bar off-screen
   — so it resets on `visibilitychange` and re-checks after 300 ms. SwiftUI handles the keyboard
   safe area natively; none of this transfers.

Also web-only: the **file-input rule** from the chat-attachment incident — a file input and its
trigger must both be plain, always-mounted siblings, never inside a popup/menu, or an installed iOS
PWA silently delivers nothing. On iOS this becomes `PhotosPicker` / `UIImagePickerController` and
the constraint evaporates. ⚠️ Keep the *product* consequence though: one plain "+" button that opens
the system picker covering photo library / camera / files, not a custom pre-menu.

**Where iOS can beat the web app.** App icon badge from the same unread count; `PHAsset`-backed
pickers with Live Photo and burst handling; `AVPlayer` with real background audio/PiP for videos
where the web falls back to a plain `<video>`; `CoreHaptics`/`UIFeedbackGenerator` where
`lib/haptics.ts` is explicitly **Android-only and a no-op on iOS** — the tab-tap haptic the web
wanted has never fired for a single iPhone user; widgets for "who's up north today" / the next
event / the fest countdown, all reading data the app already caches.

---

#### 8. Theming: light-mode only, and the Family Fest sub-theme

⚠️ **The web app is light-mode only by hard rule** (`globals.css` says so three times, plus
`color-scheme: light`). Two sub-rules:

- **Never use a dark translucent surface tint** (`bg-black/NN`, `bg-zinc-*/NN`) as a card or panel
  background — it goes muddy grey on a light page. This has been a recurring bug across the
  author's apps. A dark wash is acceptable **only** as a full-screen modal scrim.
- Colours are tokens, never hex in a component.

The palette, verbatim from the `@theme` block, is what iOS should build its `Color` set from:

```
--color-background  #f6f6f1   warm birch near-white
--color-foreground  #14241c   deep pine near-black
--color-card        #ffffff
--color-border      #e5e4da
--color-primary     #15503a   pine green (the logo; white text passes)
--color-logo        #0c4029   exact green baked into the raster logo
--color-accent      #c2410c   campfire orange
--color-lake        #0e7490   --color-campfire #c2410c   --color-sun #b45309   --color-dusk #6d28d9
--color-fest        #8b2e2e   Family Fest heraldic wine (used OUTSIDE the fest section)
--color-muted       #4b5b52   --color-faint  #64716a     readability floor (see §6)
--color-venmo       #3d95ce   --color-paypal #003087
```

There is also a **Display-P3 layer** (`@supports (color: color(display-p3 …))`) that enriches only
the *accents* — primary, accent, lake, campfire, sun, dusk, fest — while background, foreground,
cards, borders, the readability floors and the logo band stay sRGB so they keep matching the raster
logo. iOS gets this properly: define those accents in the **Display P3** colour space in the asset
catalogue with an sRGB fallback, and leave the neutrals in sRGB. That's a genuine "premier
experience" detail the web can only approximate.

**The Family Fest sub-theme** is a scoped palette swap, not a separate app: `.ff-section`
re-declares the same `--color-*` variables (parchment `#f4ecd8`, sepia ink `#3a2a18`, vellum
`#fdfaf1`, tan border `#d8c7a3`, heraldic wine primary `#8b2e2e`, azure accent `#1e3a8a`) plus a
Cinzel display serif, so every utility inside that subtree renders parchment while the rest of the
app stays forest green. `FestThemeSync` also toggles `html[data-ff]` so the viewport-level canvas
behind rubber-band bounce matches, and `ModalPortal`/`Sheet` **re-apply the class by route**
because portaling to `<body>` escapes the subtree.

On iOS this is an `@Environment(\.mlrTheme)` value (a `Theme` struct of semantic colours + fonts)
injected at the Family Fest tab's root — no class re-application problem, and sheets inherit it
naturally through the environment.

⚠️⚠️ **iOS supports dark mode and there is NO web reference to copy.** Budget for it explicitly:
every colour above needs a dark counterpart, including the parchment fest theme (a candle-lit
vellum, not an inverted one), and the "no dark translucent tint" rule inverts — in dark mode
`.ultraThinMaterial` over a dark ground is correct, which is the opposite of the web rule. Decide
per-surface and audit both appearances on every screen; the July parity doc's build check already
says "verify light AND dark on every new surface" and that is the single most commonly skipped step.

---

#### 9. The update nudge — web-only, with one native concern left over

`UpdateBanner` bakes `NEXT_PUBLIC_BUILD_ID` into the bundle and publishes the same value at
`/version.json`; it polls that file **on mount, on `visibilitychange`, on `focus`, on
`pageshow.persisted`, and every 5 minutes** with `cache: "no-store"` plus a `?ts=` cache-buster.
When they differ it offers a one-tap Refresh, which purges **all of Cache Storage**, calls
`registration.update()` on any service worker (deliberately **not** `unregister()` — that would
drop the push subscription), races that against a 1500 ms timeout, and reloads.

⛔ **None of this ports.** It exists because an iOS home-screen PWA keeps running the build it
launched with until it's fully closed and reopened, so people sit on a stale version without
knowing. The App Store solves that. Same for `ChunkErrorRecovery`, which catches
`ChunkLoadError` / "Loading chunk … failed" from a session that's still on an old build and does
one guarded hard reload (`mlr.chunkRecovery.lastReload`, one attempt per 30 s) — a bundler problem
with no native equivalent.

**What IS left over, honestly:** there is currently **no server-side minimum-version signal** in
the database, so a native "please update" gate would need one. Options, in order of preference:

1. **Skip it for v1.** Recommended. Nothing in the app breaks on an old client today, because every
   client seam degrades gracefully on a missing table/column (`42P01`, column-not-found retries).
2. If a gate is later wanted, **reuse `resort_config`** — it's already a singleton row, already
   **public-read by design** (it holds the help contact, which can't be gated behind the sign-in it
   exists to unblock), and already admin-writable. Adding `min_ios_build int` there is one column,
   not a new table. ⚠️ That IS a backend change; don't do it silently.
3. The **real** native equivalents that need no backend at all: `SKStoreReviewController`-style
   prompts aside, use **background refresh** so data is fresh at launch, and surface a passive
   "What's new" screen keyed on the local build number.

⚠️ **Do keep the *reason* the poll exists**: people sit on stale state without knowing. On iOS the
analogue isn't a stale bundle, it's stale **data** — which is §10.

---

#### 10. The native concerns that replace all of the above

| Web mechanism | Native equivalent | Notes |
|---|---|---|
| `localStorage` snapshots (`mlr.cache.v1.*`) | Codable envelopes in **Application Support** (not `Caches/`, which iOS purges) | Read synchronously before first frame — see Rule 1 |
| Browser HTTP cache, kept working by a stable 24 h media token | **`URLCache`** (+ a shared `URLSession` config) | ⚠️ Prefer `Authorization: Bearer <mediaToken>` over `?t=` so cache keys stay clean; `/f` accepts both |
| `cancelled` boolean in every effect | **`Task` cancellation** via `.task(id:)` | ⚠️ Still commit the fetched value to cache before the cancellation check |
| `inflight` Map dedup | `[String: Task]` in an `actor` | Same key, same semantics |
| `visibilitychange` / `focus` / `pageshow` re-checks | **`@Environment(\.scenePhase)`** → revalidate on `.active` | This is where the app catches up after a day in the background; also the right place to call `ensureMediaToken(force:)` |
| Supabase session in `localStorage` via supabase-js | **Keychain** (supabase-swift's keychain storage) | ⚠️ Sign-out must clear Keychain **and** the disk cache **and** the media token — the web's `signOut()` does all three |
| `sw.js` + `PushDeepLink` postMessage bridge | `UNUserNotificationCenterDelegate` + one `DeepLink` enum | ⚠️ Queue a cold-launch link and replay it after auth settles |
| `useUrlParam` + patched `pushState` | A single `@Observable` router with `pending: DeepLink?` | Parse once, in `DeepLink(path:)` |
| `useDeepLinkFlash` DOM polling | `ScrollViewReader.scrollTo(_:anchor:)` after the fetch | No polling; handle "id not in the data" by landing on the screen |
| `ModalPortal` / `#app-scroll` / `KeyboardInset` | `.sheet`, `.fullScreenCover`, `NavigationStack`, keyboard safe area | Delete, don't port |
| `TextSizeControl` | **Dynamic Type** (`@ScaledMetric`, `UIFontMetrics`) | Audit at AX5 |
| `UpdateBanner` / `version.json` / `ChunkErrorRecovery` | App Store + background refresh | See §9 |
| `InstallHint` / `InstallFirstNudge` / `InstallButton` | — | Nothing to port; the double-sign-in problem doesn't exist |

**Suggested v1 cut for this section**, since it's large and everything else depends on it:

1. `ViewerState` + the three privacy-wall primitives (§1) — small, and without it an unverified
   newcomer sees an app full of empty lists.
2. Keychain session + the identity snapshot so a returning member's first frame is the member
   layout (§1, §10).
3. The `DeepLink` enum + router covering `?post=`, `&comment=`, `?c=/&area=/&m=`, `?house=/&m=`,
   `?work=`, `?open=`, `?box=` — the shapes actual notifications use most (§5).
4. A minimal `CacheStore` honouring rules 2–4 (uid-scoped keys, no preview persistence, wipe on
   sign-out) with **memory + disk but no TTL tuning** (§3).
5. Defer: the launch readiness registry (a plain launch screen is fine at first), the fest sub-theme
   polish, widgets, Handoff/Shortcuts, offline reads.
