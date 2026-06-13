"use client";

import { useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { enablePush, disablePush, ensureServiceWorker, isPushSupported, isStandalone, isIos } from "@/lib/push";
import { DEFAULT_PUSH_TYPES } from "@/lib/types";
import type { PushType } from "@/lib/types";

// The unified push list (migration 0034) — one row per category, in the order
// shown to members. Each is independent; they only buzz the phone while the
// master "Push notifications" switch is on (which is what subscribes the device).
const TYPES: { value: PushType; label: string; desc: string; adminOnly?: boolean }[] = [
  { value: "alerts", label: "Broadcast alerts", desc: "Admin & Family Fest alerts" },
  { value: "birthdays", label: "Birthdays", desc: "When it's a member's birthday — tap to text or call them" },
  { value: "committee_join", label: "Committee decisions", desc: "When your request to join a committee is approved or declined" },
  { value: "committee_join_request", label: "New committee join requests", desc: "Admins: when a member asks to join a committee", adminOnly: true },
  { value: "cabin_decision", label: "My cabin stay decisions", desc: "When your cabin stay request is approved or declined" },
  { value: "post_tag", label: "Tagged in a post", desc: "When someone tags you in a post" },
  { value: "post_mention", label: "Mentions in comments", desc: "When you're @mentioned in a post comment" },
  { value: "post_reply", label: "Replies on posts", desc: "When someone replies on a post you're on" },
  { value: "event_rsvp", label: "Event RSVPs", desc: "When a member marks themselves going to an event" },
  { value: "chat", label: "New committee messages", desc: "Every new message in your committees" },
];

// TEMP / testing only: the self-notify switch is exposed in the UI ONLY to this
// account, and is only actually honored by the mini when the same account id is
// in PUSH_SELF_NOTIFY_USER_IDS. Remove both when testing is done.
const SELF_NOTIFY_EMAILS = new Set(["brian.theis15@gmail.com"]);

/** Small iOS-style on/off switch. */
function Switch({ on, busy, onClick, label }: { on: boolean; busy?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={busy}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-primary" : "bg-foreground/20"}`}
    >
      <span
        aria-hidden
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}

/**
 * Push notifications (Profile → Notifications) — the iOS/Android *phone* pushes,
 * as opposed to the in-app Activity feed (NotifPrefs). A master switch up top
 * turns push on or off for this device (subscribing / unsubscribing it); below
 * it, members pick which categories buzz the phone. The mini's push-sender
 * filters on `profiles.push_types`. On iPhone push only works once the app is on
 * the Home Screen, so we surface that hint.
 */
export function PushToggle() {
  const { user, isAdmin, updateUser } = useIdentity();
  const [supported, setSupported] = useState(true);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [masterBusy, setMasterBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixMsg, setFixMsg] = useState<string | null>(null);

  const types = user?.pushTypes ?? [];
  const has = (t: PushType) => types.includes(t);
  const anyOn = types.length > 0;
  // Admin-only categories (e.g. new committee join requests) only ever fire for
  // admins, so only they see the toggle.
  const shownTypes = TYPES.filter((t) => !t.adminOnly || isAdmin);

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

  // Master switch: turn ALL phone push on (subscribe this device + default to the
  // full set) or off (clear the categories + unsubscribe this device).
  const toggleMaster = async () => {
    if (masterBusy) return;
    setMsg(null);
    setFixMsg(null);
    if (anyOn) {
      setMasterBusy(true);
      await updateUser({ pushTypes: [] });
      try { await disablePush(); } catch { /* ignore */ }
      setMasterBusy(false);
      return;
    }
    // Turning push ON → subscribe this device (asks permission). forceFresh so we
    // never re-save a dead-but-present iOS token (see lib/push reconcile notes).
    setMasterBusy(true);
    try {
      const ok = await enablePush({ forceFresh: true });
      if (ok) {
        await updateUser({ pushTypes: DEFAULT_PUSH_TYPES });
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
      setMasterBusy(false);
    }
  };

  // Per-category pick (only while master is on). Toggling the last one off turns
  // push off entirely (unsubscribe); otherwise it's just editing which fire.
  const toggleCategory = async (t: PushType) => {
    if (masterBusy) return;
    const next = has(t) ? types.filter((x) => x !== t) : [...types, t];
    if (next.length === 0) {
      await updateUser({ pushTypes: [] });
      try { await disablePush(); } catch { /* ignore */ }
      return;
    }
    await updateUser({ pushTypes: next });
  };

  // Recovery: re-register THIS device from scratch. Use when push is on but
  // notifications still aren't arriving — usually a dead device subscription
  // (iOS rotated/dropped the token after an app re-install or OS update; Apple
  // keeps 201-ing the dead token so pushes vanish silently).
  const reRegister = async () => {
    if (fixing || masterBusy) return;
    setFixing(true);
    setFixMsg(null);
    try {
      const ok = await enablePush({ forceFresh: true });
      setFixMsg(
        ok
          ? "✓ This device is re-registered — you should get notifications again."
          : isIos() && !isStandalone()
            ? "Add the app to your Home Screen first, then try again."
            : "Couldn't re-register — allow notifications when prompted (or in your browser/iOS settings).",
      );
    } catch (e) {
      const name = e instanceof Error && e.name ? ` (${e.name})` : "";
      setFixMsg(`Couldn't re-register this device${name}.`);
    } finally {
      setFixing(false);
    }
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
    <div className="space-y-3">
      {/* Master switch — turns phone push on/off for this device. */}
      <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="text-sm font-medium">📲 Push notifications</span>
            <span className="block text-xs text-foreground/50">
              Buzz this phone (iPhone or Android). Pick which ones below.
            </span>
          </span>
          <Switch on={anyOn} busy={masterBusy} onClick={toggleMaster} label="Push notifications" />
        </div>
        {msg && <p className="mt-2 text-xs text-accent">{msg}</p>}
        {needsInstall && !msg && (
          <p className="mt-2 text-xs text-foreground/45">
            On iPhone/iPad, add the app to your Home Screen (Share → Add to Home Screen) so notifications can reach you.
          </p>
        )}
      </div>

      {/* Category picker — meaningful only while push is on. */}
      <div className={anyOn ? "" : "pointer-events-none select-none opacity-50"} aria-disabled={!anyOn}>
        <p className="px-1 pb-2 text-xs text-foreground/45">
          Choose what buzzes your phone — each is independent.
        </p>
        <div className="overflow-hidden rounded-2xl ring-1 ring-border">
          {shownTypes.map((l, i) => {
            const on = has(l.value);
            return (
              <button
                key={l.value}
                type="button"
                disabled={!anyOn || masterBusy}
                onClick={() => toggleCategory(l.value)}
                aria-pressed={on}
                className={`press flex w-full items-start justify-between gap-3 p-4 text-left ${i ? "border-t border-border" : ""} ${on ? "bg-primary/10" : "bg-card"}`}
              >
                <span className="min-w-0">
                  <span className="text-sm font-medium">{l.label}</span>
                  <span className="block text-xs text-foreground/50">{l.desc}</span>
                </span>
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs text-white ring-1 ${on ? "bg-primary ring-primary" : "ring-border"}`}
                >
                  {on ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>

        {anyOn && (
          <div className="px-1 pt-2">
            <button
              type="button"
              onClick={reRegister}
              disabled={fixing}
              className="press text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-60"
            >
              {fixing ? "Re-registering…" : "Not getting notifications? Re-register this device"}
            </button>
            {fixMsg && <p className="mt-1 text-xs text-foreground/60">{fixMsg}</p>}
          </div>
        )}
      </div>

      {isAdmin && (
        <label className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
          <span className="min-w-0">
            <span className="text-sm font-medium">🆕 New member joins</span>
            <span className="block text-xs text-foreground/50">
              Admins only: get a push when someone new joins, so you know who and when. Keep push turned on above so it can reach this device.
            </span>
          </span>
          <input
            type="checkbox"
            checked={user.notifyNewMembers}
            onChange={(e) => updateUser({ notifyNewMembers: e.target.checked })}
            className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          />
        </label>
      )}

      {selfNotifyEligible && (
        <label className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 ring-1 ring-amber-500/40">
          <span className="min-w-0">
            <span className="text-sm font-medium">🧪 Notify me of my own actions</span>
            <span className="block text-xs text-foreground/50">
              Testing only (your account). Get pushes for your own actions — keep &ldquo;New committee messages&rdquo; ticked above to test your own chats — so you can verify notifications without a second person.
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
