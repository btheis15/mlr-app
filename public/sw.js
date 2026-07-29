/* MLR service worker — web push only.
 *
 * Deliberately minimal: it handles `push` (show the notification) and
 * `notificationclick` (open/focus the app at the deep link). It has NO fetch /
 * caching handler, so it never interferes with how the app loads or updates.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data && event.data.text ? event.data.text() : "" };
  }
  const title = data.title || "Muskellunge Lake Resort";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/icon-192.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Tapping a notification must land on its DEEP LINK, not just "somewhere in
 * the app". This used to call client.navigate(url) inside a try/catch that
 * swallowed the failure and then returned client.focus() regardless — so on an
 * installed PWA (iOS especially), where navigate() is unsupported and rejects,
 * a tap silently focused the app on whatever page it was already showing and
 * the deep link was lost. Three routing paths now, in order of reliability:
 *   1. navigate() — the spec'd way; when it works it's guaranteed correct.
 *   2. postMessage → the app routes with its OWN router (components/
 *      PushDeepLink.tsx). This is the path that actually works in an
 *      installed iOS PWA, and it stays a client-side transition (no reload).
 *   3. openWindow() — nothing suitable open, so start fresh at the link.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Only OUR OWN windows can be navigated or messaged, and matchAll can
      // hand back others — so pick a same-origin one rather than the first.
      const sameOrigin = clientList.filter((c) => {
        try { return new URL(c.url).origin === self.location.origin; } catch (e) { return false; }
      });
      const target = sameOrigin[0] || clientList[0];

      if (target) {
        let routed = false;
        if ("navigate" in target) {
          try { routed = Boolean(await target.navigate(url)); } catch (e) { routed = false; }
        }
        // navigate() unavailable or rejected (installed PWA / uncontrolled
        // client) — hand the link to the app to route itself.
        if (!routed) {
          try { target.postMessage({ type: "mlr:navigate", url }); routed = true; } catch (e) { routed = false; }
        }
        if ("focus" in target) {
          try { await target.focus(); } catch (e) { /* focus can reject if not user-visible */ }
        }
        if (routed) return;
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});
