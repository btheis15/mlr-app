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

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

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
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

// Installed to the Home Screen? On iOS this is required for push to work at all.
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
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
 * Ask permission and subscribe THIS device, saving the subscription to Supabase.
 * Returns true if the device is now subscribed; false if permission was denied
 * or push isn't available. Throws only on unexpected failures.
 */
export async function enablePush(): Promise<boolean> {
  if (!isPushSupported() || !supabase) return false;
  await getRegistration();
  const reg = await navigator.serviceWorker.ready;

  if (Notification.permission === "denied") return false;
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return false;

  let sub = await reg.pushManager.getSubscription();
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
