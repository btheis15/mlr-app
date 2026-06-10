// Web Push — client helpers (browser side).
//
// Registers the service worker (public/sw.js), asks permission, subscribes this
// device with the VAPID public key, and stores/removes the subscription in
// Supabase (`push_subscriptions`). The mini's push-sender delivers the actual
// notifications. iOS only allows push when the app is added to the Home Screen
// (standalone PWA); Android works in the browser too.
//
// Build-safe: everything no-ops when push isn't supported or VAPID isn't set.

import { supabase } from "@/lib/supabase";

// .trim(): env values (especially pasted into a dashboard) often carry a trailing
// newline. An untrimmed key throws off the base64 padding in urlBase64ToUint8Array
// below, making atob() throw InvalidCharacterError — so the toggle could never
// subscribe. Trimming makes subscription robust regardless of how the key was set.
export const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    Boolean(VAPID_PUBLIC_KEY)
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPhone/iPod and pre-iPadOS-13 iPads carry a clear token. Since iPadOS 13,
  // Safari on iPad sends a desktop "Macintosh" UA with NO "iPad" token, so also
  // treat a Mac-looking UA that reports a touchscreen as iPadOS. (Real Macs
  // report maxTouchPoints 0, so desktop Safari/Chrome on macOS isn't misdetected.)
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

// Installed to the Home Screen? On iOS this is required for push to work at all.
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// On an Apple device (iPhone/iPad/Mac)? Used to gate Apple Cash, which is P2P
// via Messages and only works on Apple devices. (isIos already covers iPadOS.)
export function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIos() || /Macintosh|Mac OS X/i.test(navigator.userAgent);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? (await navigator.serviceWorker.register("/sw.js"));
}

/**
 * Register the service worker AHEAD of the user's tap (call this on mount). On
 * iOS this is what keeps subscribe() inside the live user gesture: by the time
 * the user taps a level, `navigator.serviceWorker.ready` resolves instantly
 * instead of waiting for a first-time install+activate — so the transient user
 * activation is still valid when we call pushManager.subscribe(). Best-effort.
 */
export async function ensureServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await getRegistration();
  } catch {
    /* best-effort pre-warm; enablePush() will register again if needed */
  }
}

/**
 * Ask permission and subscribe THIS device, saving the subscription to Supabase.
 * Returns true if the device is now subscribed; false if permission was denied
 * or push isn't available. Throws only on unexpected failures.
 */
export async function enablePush(opts?: { forceFresh?: boolean }): Promise<boolean> {
  if (!isPushSupported() || !supabase) return false;
  if (Notification.permission === "denied") return false;

  // iOS Safari only honors Notification.requestPermission() while the user
  // gesture is still "live" — i.e. BEFORE any await. So ask FIRST, then do the
  // awaited service-worker registration + subscribe. Asking after awaiting the
  // SW registration (as we used to) made the toggle throw on iPhone: by then the
  // gesture had expired, so the call was rejected. Android is unaffected.
  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
  }

  await getRegistration();
  const reg = await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  // forceFresh: drop any existing subscription and mint a new one. iOS can hand
  // back a PushSubscription object whose token is already dead on Apple's side
  // (Apple still returns 201 for it, so it silently swallows every push). Reusing
  // it re-saves the same dead endpoint. When the member is explicitly (re-)turning
  // notifications on, we can't trust the old object — unsubscribe it so subscribe()
  // below produces a brand-new, deliverable endpoint.
  if (sub && opts?.forceFresh) {
    try { await sub.unsubscribe(); } catch { /* ignore */ }
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // cast: TS's lib.dom types Uint8Array as generic over ArrayBufferLike,
      // which doesn't structurally match BufferSource on newer TS.
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }

  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return false;

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: uid,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 300),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  return !error;
}

/**
 * Silently keep THIS device's subscription fresh — call on every app open and
 * when the app returns from the background.
 *
 * Why this exists: iOS rotates or drops a PWA's push token on its own (after an
 * OS update, a Home-Screen icon re-add, or simply weeks idle) while Apple keeps
 * returning HTTP 201 for the now-dead token — so a subscription saved once goes
 * SILENTLY dead and every notification is accepted-but-never-delivered. Re-running
 * subscribe() on open replaces a rotated token with the live one and re-upserts it
 * (refreshing last_seen_at), so the row in `push_subscriptions` always points at a
 * deliverable endpoint. If iOS dropped the subscription entirely, getSubscription()
 * returns null inside enablePush() and we create a fresh one.
 *
 * No-ops unless push is supported, permission is ALREADY granted, and (on iOS) the
 * app is installed — so it never shows a permission prompt. Best-effort: failures
 * are swallowed. Caller should only invoke this when the member actually wants push
 * (push_types is non-empty), so we don't resurrect a subscription they turned off.
 */
export async function reconcilePush(): Promise<void> {
  if (!isPushSupported() || !supabase) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (isIos() && !isStandalone()) return;
  try {
    await enablePush();
  } catch {
    /* best-effort; the next app open tries again */
  }
}

/** Remove this device's subscription (browser + Supabase). Safe to call anytime. */
export async function disablePush(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* ignore */ }
  if (supabase) {
    try { await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint); } catch { /* ignore */ }
  }
}
