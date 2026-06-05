"use client";

import { useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { enablePush, disablePush, ensureServiceWorker, isPushSupported, isStandalone, isIos } from "@/lib/push";
import type { PushType } from "@/lib/types";

const TYPES: { value: PushType; label: string; desc: string }[] = [
  { value: "chat", label: "New chat messages", desc: "Every new message in your committees" },
  { value: "mentions", label: "Mentions & replies", desc: "When you're @mentioned or replied to" },
  { value: "alerts", label: "Broadcast alerts", desc: "Admin & Family Fest alerts" },
  { value: "birthdays", label: "Birthdays", desc: "When it's a member's birthday — tap to text or call them" },
];

// TEMP / testing only: the self-notify switch is exposed in the UI ONLY to this
// account, and is only actually honored by the mini when the same account id is
// in PUSH_SELF_NOTIFY_USER_IDS. Remove both when testing is done.
const SELF_NOTIFY_EMAILS = new Set(["brian.theis15@gmail.com"]);

/**
 * Per-account push preferences (Profile → Notifications) as an independent
 * multi-select: tick any combination of New chat messages / Mentions & replies /
 * Broadcast alerts / Birthdays. Ticking the first one subscribes this device
 * (asking permission); unticking the last one unsubscribes it. The mini's
 * push-sender filters on `profiles.push_types`. On iPhone push only works once
 * the app is on the Home Screen, so we surface that hint.
 */
export function PushToggle() {
  const { user, updateUser } = useIdentity();
  const [supported, setSupported] = useState(true);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState<PushType | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const types = user?.pushTypes ?? [];
  const has = (t: PushType) => types.includes(t);
  const anyOn = types.length > 0;

  useEffect(() => {
    setSupported(isPushSupported());
    setNeedsInstall(isIos() && !isStandalone());
    // Pre-warm the service worker so subscribe() stays inside the user gesture.
    if (isPushSupported()) void ensureServiceWorker();
    // If this account wants notifications and permission's already granted, make
    // sure THIS device is registered (new device / after the SW updated). Silent.
    if (anyOn && isPushSupported() && typeof Notification !== "undefined" && Notification.permission === "granted") {
      enablePush().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyOn]);

  if (!user) return null;

  const selfNotifyEligible = SELF_NOTIFY_EMAILS.has((user.email || "").toLowerCase());

  const toggle = async (t: PushType) => {
    if (busy) return;
    setMsg(null);
    const next = has(t) ? types.filter((x) => x !== t) : [...types, t];

    if (next.length === 0) {
      // Turning the last one off → unsubscribe this device.
      await updateUser({ pushTypes: [] });
      try { await disablePush(); } catch { /* ignore */ }
      return;
    }
    if (types.length === 0) {
      // Turning the FIRST one on → need a device subscription (asks permission).
      setBusy(t);
      try {
        const ok = await enablePush();
        if (ok) {
          await updateUser({ pushTypes: next });
        } else {
          setMsg(
            isIos() && !isStandalone()
              ? "On iPhone/iPad, add the app to your Home Screen first, then turn this on."
              : "Couldn't turn on notifications — allow them when prompted (or in your browser settings).",
          );
        }
      } catch (e) {
        const name = e instanceof Error && e.name ? ` (${e.name})` : "";
        setMsg(`Couldn't turn on notifications on this device${name}.`);
      } finally {
        setBusy(null);
      }
      return;
    }
    // Already subscribed — just changing which categories are on.
    await updateUser({ pushTypes: next });
  };

  if (!supported) {
    return (
      <p className="rounded-2xl bg-card p-4 text-xs text-foreground/50 ring-1 ring-border">
        Push notifications aren&rsquo;t available in this browser
        {isIos() ? " — add the app to your Home Screen (Share → Add to Home Screen) to enable them" : ""}.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="px-1 text-sm font-medium">Push notifications</p>
      <p className="px-1 text-xs text-foreground/45">Pick any combination — each is independent.</p>
      <div className="overflow-hidden rounded-2xl ring-1 ring-border">
        {TYPES.map((l, i) => {
          const on = has(l.value);
          const loading = busy === l.value;
          return (
            <button
              key={l.value}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => toggle(l.value)}
              aria-pressed={on}
              className={`press flex w-full items-start justify-between gap-3 p-4 text-left disabled:opacity-60 ${i ? "border-t border-border" : ""} ${on ? "bg-primary/10" : "bg-card"}`}
            >
              <span className="min-w-0">
                <span className="text-sm font-medium">{l.label}</span>
                <span className="block text-xs text-foreground/50">{l.desc}</span>
              </span>
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs text-white ring-1 ${on ? "bg-primary ring-primary" : "ring-border"}`}
              >
                {loading ? "…" : on ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
      {!anyOn && <p className="px-1 text-xs text-foreground/45">All off — no push notifications on this device.</p>}
      {msg && <p className="px-1 text-xs text-accent">{msg}</p>}
      {needsInstall && !msg && (
        <p className="px-1 text-xs text-foreground/45">
          On iPhone/iPad, add the app to your Home Screen (Share → Add to Home Screen) so notifications can reach you.
        </p>
      )}

      {selfNotifyEligible && (
        <label className="mt-1 flex items-center justify-between gap-3 rounded-2xl bg-card p-4 ring-1 ring-amber-500/40">
          <span className="min-w-0">
            <span className="text-sm font-medium">🧪 Notify me of my own actions</span>
            <span className="block text-xs text-foreground/50">
              Testing only (your account). Get pushes for your own actions — keep &ldquo;New chat messages&rdquo; ticked above to test your own chats — so you can verify notifications without a second person.
            </span>
          </span>
          <input
            type="checkbox"
            checked={Boolean(user.pushSelfNotify)}
            onChange={(e) => updateUser({ pushSelfNotify: e.target.checked })}
            className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          />
        </label>
      )}
    </div>
  );
}
