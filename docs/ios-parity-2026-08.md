# iOS parity catch-up — 2026-08

Prose companion to **[`ios-parity-2026-08.json`](ios-parity-2026-08.json)**, which is
the machine-readable work-list. Same pair convention as the July round
(`ios-parity-2026-07.{md,json}`), which this **supersedes**.

| | |
|---|---|
| **Web source** | `btheis15/mlr-app` @ `origin/main`, through **PR #539** |
| **iOS target** | `btheis15/mlr-app-ios` |
| **Last iOS sync** | 2026-07-22 — the July doc covered web PRs #316–#362, migrations 0114–0128 |
| **This delta** | **175 merged PRs (#363–#539)** and **57 migrations (0129–0184)** |
| **Architecture** | see [`ios-swiftui-strategy.md`](ios-swiftui-strategy.md) — not repeated here |

**Product direction has changed since July, and it changes the goal.** Per Brian:

> "I need EVERY feature from the web app on iOS. I want iOS to be the premier and best
> experience for people who have iPhones, and the web app is for 'everyone else', but
> still has the same features too."

So this is no longer a catch-up on a companion app. **iOS is the flagship; parity is the
floor, not the target.** Two consequences run through both files:

1. A feature iOS already has is **not** done — it's due a depth audit, because the web
   version has usually grown since. Those are marked `has-it-audit-depth`.
2. Where a native app can genuinely beat a browser, that's called out as an
   opportunity rather than left implicit.

**Division of labour between the two files.** The JSON is the checklist: every feature,
its status, tables, RPCs, migrations, effort, and a testable acceptance line — so
nothing gets silently skipped and progress is trackable. This markdown holds what JSON
holds badly: the Swift, the reasoning, and every ⚠️ the web app earned by shipping the
bug first. Those warnings are the highest-value content here; a table inventory is
nearly worthless because you have the schema.

**Almost nothing needs backend work.** Every feature is already backed by shipped
tables, RLS policies and RPCs the iOS app can call with the anon key it already has.
The exceptions are called out explicitly.

⚠️ **`ios_targets` paths are partly PROPOSED, not verified.** The iOS repo isn't
checked out on the machine this was written on, so real paths are only those the July
doc already named (`Services/*Service.swift`, `Committees/`, `Houses/`,
`Tabs/FamilyFestTab/`, …). For net-new surfaces the paths follow that convention but
are suggestions — confirm against the actual project.

⚠️ **The web app is light-mode only by hard rule; iOS supports dark.** The July doc's
build check says "verify light AND dark on every new surface" — so every surface
specified here needs a dark treatment that has **no web reference to copy**. Budget for
it rather than discovering it at review time.

---

## Start here — server state as of 2026-08-10

**`MEDIA_AUTH=report` on the mini right now.** Nothing is broken for anyone: media
serves normally on web *and* iOS, while the server logs every read that *would* have
been rejected. It was briefly `on` (verified working on web — 220/220 signed requests,
video included) and then deliberately backed off, because the native app can't sign yet
and enforcement 403s every photo in it.

**Who has the native app:** 2 members, 3 devices — Brian (2) and Annette (1, registered
2026-07-27). From `apns_subscriptions`. Worth confirming whether Annette actually opens
the native app or the home-screen web app; if it's the web app, nobody is affected and
enforcement can go back on immediately.

**Reverting to `report` cost only link expiry.** These are unconditional and stayed live:
the `/f` traversal guard (400), the `/dropbox-zip` and `/upload` approval gates (401/403),
and migration 0184's email-directory fix.

### The verification loop for tomorrow

```bash
# 1. Where things stand (run on the mini)
grep -E '^MEDIA_AUTH' ~/mlr-app/media-server/.env
node ~/mlr-app/media-server/scripts/test-media-auth.js      # 58 assertions, exits non-zero on failure

# 2. After implementing §0, exercise iOS hard — scroll an album, open a photo,
#    PLAY AND SCRUB A VIDEO — then check what would have been blocked:
grep WOULD-BLOCK ~/mlr-app/media-server/logs/server.log | tail -20

# 3. Zero lines with an iOS user agent => safe to enforce:
#    edit ~/mlr-app/media-server/.env  ->  MEDIA_AUTH=on
launchctl kickstart -k gui/$(id -u)/com.mlr.media-server

# 4. Confirm from the server side that real traffic is signing:
grep -E 'GET /f/' ~/mlr-app/media-server/logs/server.log | tail -20   # want tok=yes … -> 200/206

# Revert instantly at any point: MEDIA_AUTH=report (or off) + the same kickstart.
```

⚠️ **Test video separately from photos.** Videos issue Range requests, and a player that
drops the query string on a range retry would break video while photos looked perfect.
`range=yes tok=missing` in the log is that signature. This is not hypothetical — one
ambiguous unsigned `.mp4` is why enforcement wasn't switched on sooner.

⚠️ **A `WOULD-BLOCK` line proves the client failed to sign; its absence proves nothing
unless you actually exercised the app.** Check that real `/f` requests appear in the log
for the session you just ran, or you're reading silence and calling it success.

---

## 0. 🚨 BLOCKING — the native app's photos are broken under enforcement

**Symptom (whenever `MEDIA_AUTH=on`):** every photo and video in the iOS app returns
**HTTP 403** with `{"error":"This photo is only viewable in the MLR app."}`.

**Cause:** the media server can require a signed token on every `/f/…` read. The web
client was updated to attach one; iOS was not. Enforcement is currently held at
`report` (see **Start here**) precisely because of this, so the app works today — but
link expiry, the entire point of the feature, stays off until iOS can sign.

**This is not platform gating.** The token is issued to the *account* — the check
is "signed in AND admin-verified", identical for every client. The problem is only
that the server cannot recognise an account that doesn't present proof, and for
media that proof has to travel in the URL because an `<img>` / `AsyncImage` load
cannot set request headers.

### What iOS must do

1. **Fetch the token** once per app open:

   ```
   GET https://mlr-media.duckdns.org/media-token
   Authorization: Bearer <the member's Supabase access_token>
   ```

   Response:

   ```json
   { "token": "20675.XvvLsMVl3p…", "expiresAt": "2026-08-11T00:00:00.000Z", "ttlHours": 24 }
   ```

   - `401` → the Supabase session is invalid/expired; refresh it.
   - `403` with `pendingApproval: true` → the member exists but an admin hasn't
     verified them. Show the "waiting to be approved" state (see §1), not an error.

2. **Append it to every media URL** as `?t=<token>`:

   ```
   https://mlr-media.duckdns.org/f/dropbox/<box>/2026-08/<uuid>.jpg?t=<token>
   ```

   Mirror the web helper `mediaSrc()` (`lib/mediaToken.ts`) — one function that
   every image/video URL passes through, which:
   - returns the URL **untouched** when the host isn't ours (Supabase avatars,
     `data:`, local file previews);
   - is **idempotent** (never double-appends if `?t=` is already present);
   - appends with `&` when the URL already has a query string (`?dl=1`).

3. **Re-fetch on every app open**, even when a cached token looks valid.

   ⚠️ **Do not skip this as an optimisation.** A cached token is only a *guess*
   about what the server will accept. It carries its own 24h expiry, so if the
   signing key ever changes, the client keeps confidently signing with a dead key
   and every photo 403s until that expiry lapses — up to a full day, with no
   self-healing. That exact bug caused a fleet-wide outage on the web app. One
   small authenticated request per app open makes any future key change heal on
   the next launch.

4. **Alternative for native code:** `requireMediaToken` also accepts
   `Authorization: Bearer <media token>`. If iOS loads media through `URLSession`
   with a custom request (rather than plain `AsyncImage(url:)`), the header form is
   cleaner than the query string. Both are equally valid — the query string exists
   only because browsers can't do headers on `<img>`.

### ⚠️ Why not a cookie? (decided 2026-08-10 — don't re-open)

The obvious simplification is a cookie: set it once at sign-in and every client —
browsers *and* iOS `URLSession` — attaches it automatically to every media request,
with no per-URL work and nothing for a client to forget. It was considered and
**declined**, twice, for two different reasons:

1. **It cannot work today.** The app is served from `mlr-app-omega.vercel.app` and
   media from `mlr-media.duckdns.org`. Those are different *sites*, so the cookie
   would be third-party — and Safari/iOS blocks third-party cookies outright, i.e.
   it would fail on exactly the devices most of this family uses. (It also can't be
   scoped to `.duckdns.org`, which is a public suffix.)
2. **Making it work needs a domain name.** With `app.<domain>` and `media.<domain>`
   the two become same-site, the cookie is first-party, Safari allows it, and the
   token-per-URL layer could be deleted entirely. That costs ~$12/yr plus
   re-pointing ~1,700 stored media URLs.

Brian chose to **keep the token and just teach iOS to send it** — the work is about
30 lines and costs nothing. Revisit only if a third client appears or the app moves
to a custom domain for unrelated reasons; at that point the cookie design becomes
strictly simpler and this whole section goes away.

### Swift implementation

Two files. Nothing else in the app changes except swapping raw URLs for
`MediaToken.signed(_:)` at every image/video site.

```swift
// MediaToken.swift — the whole client half of media auth.
import Foundation

actor MediaToken {
    static let shared = MediaToken()

    /// Must be the DuckDNS host. See the warning in §2 — a stale Tailscale host here
    /// is what silently un-signed every photo on the web app for hours.
    static let mediaBase = URL(string: "https://mlr-media.duckdns.org")!
    /// Hosts whose URLs we sign. Match by HOST, never by string prefix.
    static let mediaHosts: Set<String> = [
        "mlr-media.duckdns.org",
        "brians-mac-mini.tail49943c.ts.net", // retired; still accepted so old rows sign
    ]

    private struct Response: Decodable {
        let token: String
        let expiresAt: Date       // ISO8601 — use .iso8601 date decoding
        let ttlHours: Double?
    }

    private var token: String?
    private var expiresAt: Date = .distantPast
    private var inFlight: Task<String?, Never>?

    /// True when we hold something usable for at least another minute, so a URL can't
    /// expire mid-flight.
    private var isFresh: Bool { token != nil && expiresAt.timeIntervalSinceNow > 60 }

    /// Call with force:true on every app open (see the warning below). Returns nil when
    /// the member isn't signed in, isn't approved yet, or the mini is unreachable.
    func ensure(force: Bool = false, accessToken: @Sendable () async -> String?) async -> String? {
        if !force, isFresh { return token }
        if let inFlight { return await inFlight.value }

        let task = Task<String?, Never> { [weak self] in
            guard let self else { return nil }
            guard let jwt = await accessToken() else { return nil }

            var req = URLRequest(url: Self.mediaBase.appending(path: "media-token"))
            req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
            // Never serve this from the URL cache: the body is identical all day, so a
            // cached/revalidated response is how the web client ended up with no token.
            req.cachePolicy = .reloadIgnoringLocalCacheData

            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                guard let http = resp as? HTTPURLResponse else { return nil }

                if http.statusCode == 403 {
                    // Signed in, but an admin hasn't verified them. Surface the
                    // waiting-for-approval state (§1) — this is NOT an error.
                    await self.clear()
                    return nil
                }
                guard (200...299).contains(http.statusCode) else { return nil }

                let dec = JSONDecoder()
                dec.dateDecodingStrategy = .iso8601
                let out = try dec.decode(Response.self, from: data)
                await self.store(out.token, expires: out.expiresAt)
                return out.token
            } catch {
                return nil
            }
        }
        inFlight = task
        let result = await task.value
        inFlight = nil
        return result
    }

    private func store(_ t: String, expires: Date) { token = t; expiresAt = expires }
    private func clear() { token = nil; expiresAt = .distantPast }

    /// Synchronous read for use while building a URL. Never triggers a fetch.
    func peek() -> String? { isFresh ? token : nil }

    /// THE function every image/video URL must pass through.
    nonisolated static func signed(_ url: URL?, token: String?) -> URL? {
        guard let url else { return nil }
        guard let host = url.host, mediaHosts.contains(host) else { return url } // not ours
        if url.path.hasPrefix("/assets/") { return url }                          // stays public
        guard let token else { return url }                                       // no token yet
        guard var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var items = c.queryItems ?? []
        guard !items.contains(where: { $0.name == "t" }) else { return url }       // idempotent
        items.append(URLQueryItem(name: "t", value: token))
        c.queryItems = items
        return c.url ?? url
    }
}
```

Then an observable holder so SwiftUI re-renders when the token lands:

```swift
// MediaTokenStore.swift
import SwiftUI

@MainActor @Observable final class MediaTokenStore {
    private(set) var token: String?

    /// Call from .task on the root view AND on scenePhase -> .active.
    func refresh(accessToken: @Sendable () async -> String?) async {
        // force:true ALWAYS. See the warning below — this is the whole self-healing story.
        token = await MediaToken.shared.ensure(force: true, accessToken: accessToken)
    }

    func url(_ raw: String?) -> URL? {
        guard let raw, let u = URL(string: raw) else { return nil }
        return MediaToken.signed(u, token: token)
    }
}
```

Usage — note that `store.token` being read inside the view body is what makes SwiftUI
re-render every image the moment the token arrives:

```swift
@Environment(MediaTokenStore.self) private var store

AsyncImage(url: store.url(item.thumbnailUrl ?? item.storagePath)) { ... }
```

⚠️ **`force: true` on every app open is not redundant — do not "optimise" it away.**
A cached token is only a *guess* about what the server will accept. It carries its own
24h expiry, so if the signing key ever changes, the client keeps confidently signing
with a dead key and every photo 403s until that expiry lapses — up to a full day, with
no path to recovery. That exact bug took the web app's photos down. One small request
per launch makes any future key change heal on the next launch.

⚠️ **Match by host, not by string prefix.** The web app used
`url.hasPrefix(MEDIA_URL)`, which broke the instant the configured base URL and the
stored URLs disagreed — and they did, silently, for hours.

### Token properties worth knowing

- **Identical for every member** within a 24h window, and derived from a rounded
  clock, so it's stable and cacheable. Deliberate: a per-request token would change
  every URL on every render and destroy HTTP caching.
- Both the **current and previous** window verify, so a member holding a token
  across a rollover isn't cut off mid-scroll.
- It is a bearer capability for "an approved member is asking", not a per-file
  grant. It confers nothing beyond reading `/f` bytes.
- `/privacy` and `/assets/*` stay public and unsigned (App Store requirement and
  sign-in-screen logos respectively).

### Verifying the port

The server has a **report-only mode** built for exactly this. Ask Brian to set
`MEDIA_AUTH=report` on the mini and restart. Media then serves normally regardless,
but every unsigned read logs a line to `media-server/logs/server.log`:

```
[media-auth] WOULD-BLOCK 2026-08-10T21:02:16.172Z /dropbox/<box>/2026-08/x.jpg tok=missing range=no ua=MLR-iOS/…
```

Exercise the iOS app hard — scroll an album, open a photo, **play and scrub a
video** — then confirm zero `WOULD-BLOCK` lines with an iOS user agent. Only then
go back to `MEDIA_AUTH=on`. Videos matter separately from photos: they issue Range
requests, and a player that drops the query string on a range retry would break
video while photos looked fine. `range=yes tok=missing` is that signature.

**Until this ships,** enforcement has to stay at `report` or `off`, or the two
members with the native app installed (Brian, Annette) lose all in-app photos.

---

## 1. Verified members — the app-wide access gate (migrations 0181–0184)

Anyone could previously sign up with any email address and immediately read posts,
chat, albums and every member's phone number. Now a new signup sees only what a
signed-out visitor sees **until an admin verifies them**.

- **The DB column is `profiles.approved`; the UI says "Verified."** Deliberate and
  documented — Supabase's email OTP already owns the word "verified". Don't unify
  them.
- Functions: `is_approved_member()`, `set_member_approved(p_user, p_value)` (admin
  only), `is_preregistered_email()`.
- **0183 swapped 29 SELECT policies** to `is_approved_member()`. iOS needs no query
  changes — RLS simply returns fewer rows — but it **does** need the UI states
  below, or an unverified member sees a member layout full of empty lists.

### What iOS must add

| State | Behaviour |
|---|---|
| Signed out | unchanged guest view |
| Signed in, `approved = false` | treat as **guest**, plus an explicit "You're signed in — almost there" screen explaining an admin must approve them, and that there's nothing more to do on their end |
| Signed in, `approved = true` | full member view |
| `approved` missing/unreadable | **treat as verified** |

⚠️ **That last row is not laziness — it's the required failure mode.** Defaulting
to "unverified" on a read error locks real members out of their own app. The web
client defaults `verified` to `true` in three places: initial state, read error,
and column-absent. Do the same.

⚠️ **`profiles` keeps an own-row escape hatch** (`is_approved_member() or id =
auth.uid()`). Without it an unverified member can't read their own row, which
breaks identity loading and leaves no way to *show* them the waiting state.

**Admin surface** (optional for v1): Admin → Members shows "N verified · N not
verified", a filter for the unverified, ✓ Verify / Un-verify buttons, and a
"N people need verifying" banner. Members see a **discrete tappable ✓** next to
verified names in the directory — and deliberately **nothing** next to an
unverified name, since that would be a quiet accusation and isn't actionable for a
member.

**0184** closed two `SECURITY DEFINER` functions 0183 missed
(`directory_recipients()`, `admin_recipients()`). No client change; noted so nobody
"re-fixes" it.

⚠️ **General lesson for any future gate change: policies and DEFINER functions are
separate surfaces.** A DEFINER function bypasses RLS by design, so a policy sweep
leaves it untouched. Sweep both.

---

## 2. Media-server behaviour iOS should match

These are server-side already; the notes are about what iOS should *send* and
*render*.

- **Thumbnails (0173).** Every `*_media` table has `thumbnail_url`. Grids and
  albums must render **that**, not the full-res file, and load the original only on
  tap-through. This is the single biggest scroll-performance win in the app. A
  video's poster frame is seeked ~10% in (not frame 0 — real phone video often
  opens on a black frame), and a video tile still needs a ▶ badge or it's
  indistinguishable from a photo.
  `uploadToMini()` returns `{ url, thumbnailUrl, capturedAt, capturedAtSource, type, path }`
  — thread `thumbnailUrl` into every `*_media` insert.
- **Capture dates (0174–0176).** Albums sort by when a photo was **taken**, not
  uploaded. `captured_at` + `captured_at_source` (`exif` > `video` > `file` >
  `post`, best first; a sweep may only ever move a row *up* that list).
  - iOS should read the real capture date from `PHAsset.creationDate` — far more
    reliable than the web's EXIF scraping, which loses HEIC metadata the moment
    the browser re-encodes through a canvas. Send it as `capturedAt` with source
    `exif`.
  - ⚠️ Read it from the **original** asset, before any compression.
- **Uploads** go to `POST /upload?category=posts|chat|work|dropbox&room=<slug|box>`
  with `Authorization: Bearer <supabase token>`.
  ⚠️ As of today `/upload` also requires the caller to be an **approved** member —
  a `403 pendingApproval` is a real response iOS must handle.
- **Moderation is asynchronous.** `/upload` returns immediately and grades in the
  background, so a flagged verdict *retroactively* holds already-posted content a
  few seconds later via a DB trigger. iOS needs no moderation code, but should
  expect a row's `status` to change to `pending` after the fact, and honour
  `status` when rendering.
- **Videos are transcoded in the background** and a cross-extension transcode
  (`.mov` → `.mp4`) repoints `storage_path` afterwards. So a URL can change shortly
  after upload — re-read the row rather than caching the URL forever.
- ⚠️ **`MEDIA_URL` must be `https://mlr-media.duckdns.org`.** Do not hardcode the
  old Tailscale Funnel host (`brians-mac-mini.tail49943c.ts.net`). It still
  resolves, but it relays through Tailscale DERP at 12–21 Mbps against a 119 Mbps
  uplink — and a stale reference to it is precisely what silently un-signed every
  photo on the web app for hours. Match by **host** against a known set, never by
  exact-prefix against one configured string.

---

## 3. Features that are web-only

Ordered by likely value to the family. All schema/RPCs already exist.

### 3a. Drop Boxes — shared downloadable albums (0171–0180)

The app's account-free alternative to a shared Google Drive folder, and where the
Family Fest photos now live. **Highest-value gap** — it's the most-used surface on
the web app.

- Tables `drop_boxes` + `drop_box_media`; all writes through RPCs
  (`create_drop_box`, `update_drop_box`, `set_drop_box_archived`,
  `delete_drop_box`, `add_drop_box_media`, `remove_drop_box_media`,
  `set_drop_box_media_status`).
- Uploads use `category: "dropbox"` with the box id as `room`.
- **Moderation is deliberately more lenient here:** if the model can't run, a
  drop-box upload is allowed and final (not re-queued), so a family album never
  strands photos behind an unreachable checker.
- **Downloads are the point** — this is the one surface that offers originals.
  Single file: `/f/…?dl=1` (serves the preserved `_orig` where one exists). Whole
  folder or a selection: `GET/POST /dropbox-zip`. ⚠️ `/dropbox-zip` now also
  requires an **approved** member.
- The official album has a fixed id: `0000fe57-2026-4000-8000-000000000001`.
- Sorted by `captured_at` (see §2), credited via `uploaded_by` / `created_by`.
  ⚠️ When a Feed post's photo is referenced into an album, credit goes to the
  **post's author**, not whoever clicked the checkbox (`p_credit_user_id`, honoured
  only for admin callers).

### 3b. Event sign-up slots (0135–0143, 0158–0168)

Limited sign-ups for schedule events: three modes (`interval` / `slots` /
`headcount`), optional fixed-size **teams**, custom required fields, per-slot
reminder pushes, an option to **hide who's signed up**, and a manual "notify this
slot" send.

⚠️ **Never hand a bare `YYYY-MM-DD` to a date parser.** On the web, `new Date("2026-07-31")`
parses as **UTC midnight** and renders as the *previous day* in Central — which
mislabelled every slot in the app by one day, and because the label also fed the
organiser's own picker, it **corrupted the stored data** too (10 rows needed a
manual correction). Swift's `DateFormatter` with an explicit `timeZone` avoids the
web's specific trap, but the lesson generalises: a display bug in a *picker*
silently corrupts whatever it writes.

### 3c. Tournaments (0144–0154)

Brackets on top of an activity's sign-ups: single-elim, round-robin, and
pools→bracket. Scoring is one tap (winner; scores optional) and propagates, with a
recursive cascade that clears stale downstream results when a decided match is
changed. Entrants import from sign-ups or the roster; account-less typed names are
first-class (they just can't receive notifications).

### 3d. Private activities (0150–0154)

Member-created, invite-only get-togethers in the Events tab. Visible **only** to
invitees — `is_private_activity_member()` is the RLS predicate. Roster supports
typed-in names for people without accounts. Notifications fire only if the
organiser opts in, and only to the people involved.

### 3e. Meetings / when2meet (0116–0122)

Propose candidate times in a committee/house room (or family-wide), everyone marks
Yes / If-need-be / No, organiser finalises into either a **Google Meet** link or a
real **Event** on the calendar. Two optional emails (proposal opt-in, confirmation
automatic) are sent by the mini, not the client.

### 3f. Quick polls in chat (0149)

iMessage-style polls inline in the message timeline. Anonymity is enforced in SQL:
`chat_poll_votes` has **no select grant at all**, and counts come from
denormalised columns kept current by a trigger. `chat_poll_voters()` is the only
way identity is ever revealed, and it returns nothing when the poll is anonymous.

⚠️⚠️ **iOS-relevant trap, learned painfully on web:** never trigger a file picker
from inside a popup/menu/overlay. In the installed iOS PWA the native picker opened,
you could choose a photo, and **nothing arrived, with no error** — attaching photos
in chat appeared simply broken. Three fixes that kept the popup all failed on
device. The resolution was to make the picker a plain, always-mounted button and
move the *other* actions into the menu. A native app has different plumbing, but if
photo attachment misbehaves, look at what the picker is nested inside first.

### 3g. House lists (0169)

Shared lists per house — groceries, close-up checklists, packing. One flexible
shape (title + checkable items). Writes gate on **membership, not authorship** —
the person who buys the milk is rarely the one who wrote it down. "Checked" is a
stamp (`checked_at`/`checked_by`), not a boolean, so the list also answers *who*.
No notifications, by design.

### 3h. Leads chat + lead-run rosters (0172)

A private `area = 'Leads'` channel per committee, gated on holding any `· Lead`
role — with **no admin override** (an admin who isn't a lead of that committee is
deliberately not in its Leads room). Leads also get roster write access scoped to
committees they lead.

⚠️ **The `" · Lead"` suffix has one home:** `baseArea` / `isOnArea` / `isAreaLead`
/ `withArea` / `withoutArea` in `lib/committeeAdmin.ts`. Comparing raw role strings
already caused silent data loss on web — an admin editing someone's areas saved a
list with their lead standing stripped. Port the helpers, not the string compares.

### 3i. Conversation search (0129–0131)

Search across everything the member can see, via `POST /search` on the mini →
`search_conversations()`, which re-applies the same visibility rules the feed uses.
Ranking is **keyword-first** (`websearch_to_tsquery`), with embeddings only breaking
ties. ⚠️ Filter with `@@`, never `ts_rank(...) > 0` — ts_rank returns a tiny
non-zero for non-matching multi-word queries, which leaked the whole corpus.

### 3j. Smaller items

- **Post comment media (0162)** — comments carry photos/videos.
- **Comment deep links (0164)** — notifications land on the *specific comment*.
- **Notification test tools (0156–0157)** — send a test to one member; a
  "notifications confirmed" checklist.
- **Chat mute durations (0155)**.
- **Committee taxonomy admin (0112, 0170, 0177–0179)** — admins create/rename/
  archive committees and roles.
- **Family roster (0123–0125)** — account-less family members with emails.
- **Anytime events (0139, 0141)** — `fest_activities` is **retired on web**;
  converted into anytime `fest_schedule_items`. ⚠️ **iOS still reads
  `fest_activities`**, which is why the table still exists. Migrating iOS to
  anytime schedule items is what finally lets it be dropped — until then the two
  can drift.

---

## 4. Recommended order

1. **§0 media token** — blocking; the app's photos are broken without it.
2. **§1 verified-member states** — small, and prevents an unverified newcomer
   seeing a broken-looking member UI.
3. **§2 thumbnails** — biggest perceived performance win.
4. **§3a Drop Boxes** — biggest missing feature.
5. Then §3b/§3c (fest-season-sensitive), then the rest as appetite allows.

---

## 5. Conventions to carry over

- **`profiles.is_admin` is the only source of admin truth.** No client allow-list.
- **"Is this mine?" resolves through the effective user id**, never a raw session
  lookup — web has an admin "view as" preview where the two differ, and every
  write must no-op while previewing.
- **Degrade gracefully pre-migration.** Every web client seam returns empty on a
  missing table (Postgres `42P01`) rather than throwing. It's why a half-migrated
  database doesn't crash the app.
  ⚠️ The flip side, learned the hard way: that idiom **disguises a broken read as
  "empty but working."** A table with RLS enabled and zero policies returns zero
  rows *with no error*, which silently deleted an entire feature from every client
  for weeks. When a list reads empty but writes seem to succeed, check
  `pg_policies` before anything else.
- **Light mode only.** Never a dark translucent surface tint as a card background.
- **Never report a feature done off a script's success message.** Verify by reading
  the file back and compiling. On this project an entire admin UI was reported as
  shipped when the edit had silently no-op'd.

---

## The work — 17 areas

Each area has its own file so you can open just the one you're building. The
machine-readable checklist is [`ios-parity-2026-08.json`](ios-parity-2026-08.json)
(166 enumerated features, 963 recorded gotchas).

| # | Area | Features | Fact-checked | Doc |
|---|---|---|---|---|
| WS01 | Drop Boxes (shared downloadable albums) | prose | ✅ | [`01-drop-boxes.md`](ios-parity-2026-08/01-drop-boxes.md) |
| WS02 | Event sign-up slots | prose | ✅ | [`02-event-signups.md`](ios-parity-2026-08/02-event-signups.md) |
| WS03 | Tournament brackets (migrations 0144–0154) | prose | ✅ | [`03-tournaments.md`](ios-parity-2026-08/03-tournaments.md) |
| WS04 | Private activities | prose | ✅ | [`04-private-activities.md`](ios-parity-2026-08/04-private-activities.md) |
| WS05 | Meetings (when2meet) and quick polls in chat | prose | ✅ | [`05-meetings-and-chat-polls.md`](ios-parity-2026-08/05-meetings-and-chat-polls.md) |
| WS06 | House lists, Leads chat, and lead-run rosters | prose | ✅ | [`06-house-lists-and-leads.md`](ios-parity-2026-08/06-house-lists-and-leads.md) |
| WS07 | Posts feed and comments — depth audit | 20 | ✅ | [`07-posts-feed-depth-audit.md`](ios-parity-2026-08/07-posts-feed-depth-audit.md) |
| WS08 | Committee & house chat — depth audit | 21 | ✅ | [`08-chat-depth-audit.md`](ios-parity-2026-08/08-chat-depth-audit.md) |
| WS09 | Events + RSVP, and cabin stays | 24 | ✅ | [`09-events-and-cabins.md`](ios-parity-2026-08/09-events-and-cabins.md) |
| WS10 | Ask for Help, presence, and the Home cards | 15 | ✅ | [`10-ask-for-help-and-home.md`](ios-parity-2026-08/10-ask-for-help-and-home.md) |
| WS11 | Activity feed, notification preferences, and push | 20 | ✅ | [`11-notifications-and-push.md`](ios-parity-2026-08/11-notifications-and-push.md) |
| WS12 | Committees, roles, roster & the family roster | 14 | ✅ | [`12-committees-and-roster.md`](ios-parity-2026-08/12-committees-and-roster.md) |
| WS13 | The Family Fest section | 23 | ✅ | [`13-family-fest.md`](ios-parity-2026-08/13-family-fest.md) |
| WS14 | Verified members (0181–0184), and the smaller catch-up items | prose | ✅ | [`14-verified-members-and-misc.md`](ios-parity-2026-08/14-verified-members-and-misc.md) |
| WS15 | Conversation search, and media-server behaviours iOS must match | prose | ✅ | [`15-search-and-media-server.md`](ios-parity-2026-08/15-search-and-media-server.md) |
| WS16 | Cross-cutting UX, caching and routing | 19 | ⚠️ no | [`17-cross-cutting.md`](ios-parity-2026-08/17-cross-cutting.md) |
| WS17 | Where iOS should be better than the web app | 10 | ✅ | [`18-native-advantages.md`](ios-parity-2026-08/18-native-advantages.md) |

**Generated by two verification passes over the repo.** Each area was drafted by an agent
reading the actual migrations and client code, then fact-checked by a second agent that
re-checked every table, column and RPC name against the SQL — **186 corrections were
applied** across the set. Anything still marked ⚠️ did not get that second pass.

⚠️ **Effort and priority values are agent estimates, not measurements.** Use them to
sequence, not to promise dates.
