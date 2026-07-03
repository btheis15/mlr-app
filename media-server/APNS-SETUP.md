# Native iOS Push (APNs) — setup

The iOS app already requests push permission, registers for remote notifications,
and saves its APNs device token to the `apns_subscriptions` table. Two pieces make
delivery actually work; both live here (not in the iOS app):

1. **Migration** `supabase/migrations/0052_apns_subscriptions.sql` — creates the
   `apns_subscriptions` table + RLS. Apply it to the shared Supabase project.
2. **Sender** `media-server/apns-sender.js` — listens to the same Postgres changes
   as `push-sender.js` and delivers to APNs, gated on the same `push_types`. It is
   wired into `server.js` and is **dormant until the env vars below are set**.

## What you provide (Apple)

From the Apple Developer portal → Certificates, Identifiers & Profiles → Keys:

- Create an **APNs Auth Key** (.p8). Download it once (you can't re-download).
- Note its **Key ID** (10 chars) and your **Team ID** (10 chars).
- Note the app's **bundle id** (e.g. `com.theis.MLRApp`).

## Env vars (Mac-mini, alongside the existing push-sender vars)

```
SUPABASE_URL=...                       # already set
SUPABASE_SERVICE_ROLE_KEY=...          # already set (mini-only)
APNS_KEY_PATH=/path/to/AuthKey_XXXX.p8
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=YYYYYYYYYY
APNS_BUNDLE_ID=com.theis.MLRApp
```

With those set, restart the media server. You should see
`[apns] listening (chat + alerts + feed notifications)`. Without them it logs
`[apns] dormant …` and does nothing.

## How it works

- No new npm deps: the ES256 provider JWT is signed with Node's `crypto`, and
  delivery uses the built-in `http2` to `api.push.apple.com` (or
  `api.sandbox.push.apple.com` for tokens whose `environment = 'sandbox'`).
- Each device-token row carries its own `environment`; debug builds register as
  `sandbox`, TestFlight/App Store as `production`.
- Dead tokens (HTTP 410 / `BadDeviceToken` / `Unregistered`) are pruned automatically.
- Gating matches web push exactly (chat → `push_types` 'chat', alerts → 'alerts',
  feed types gated per `push_types`, `help_urgent` overrides). Notification
  categories map to the iOS action buttons (EVENT_REMINDER / HELP_REQUEST /
  CHAT_MENTION) and `target_type`/`target_id` ride along for deep-linking.

## Notes / follow-ups

- `apns-sender.js` is a self-contained fork of `push-sender.js` (it duplicates the
  chat/alerts/feed handlers). A later cleanup could merge APNs delivery into
  `push-sender.js`'s `sendToUser` so both transports share one set of handlers.
- The daily birthday job (`birthday-notifier.js`) now delivers over both
  transports — it calls `apns-sender.js`'s `createApnsDelivery()` directly
  (rather than forking a second listener) so iOS members get birthday pushes
  too, once the same APNS_* env vars above are set.
