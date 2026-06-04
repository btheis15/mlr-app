"use client";

import { useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { enablePush, disablePush, isPushSupported, isStandalone, isIos } from "@/lib/push";
import type { PushLevel } from "@/lib/types";

const LEVELS: { value: PushLevel; label: string; desc: string }[] = [
  { value: "all", label: "Everything", desc: "Every new chat message in your committees + alerts" },
  { value: "mentions", label: "Mentions & replies", desc: "Only when you're @mentioned or replied to, + alerts" },
  { value: "alerts", label: "Alerts only", desc: "Just admin & Family Fest broadcast alerts" },
  { value: "off", label: "Off", desc: "No push notifications on this device" },
];

/**
 * Per-user push-notification level (Profile → Notifications). Picking a level
 * other than Off subscribes this device (asking permission); Off unsubscribes
 * it. On iPhone, push only works when the app is added to the Home Screen, so we
 * surface that hint. Mirrors the email-alerts opt-in, persisted to `profiles`.
 */
export function PushToggle() {
  const { user, updateUser } = useIdentity();
  const [supported, setSupported] = useState(true);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const level = user?.pushLevel ?? "off";

  useEffect(() => {
    setSupported(isPushSupported());
    // Only nag about installing on iOS-in-browser (where push can't work yet).
    setNeedsInstall(isIos() && !isStandalone());
    // If the account wants notifications and the browser already granted
    // permission, make sure THIS device is registered (e.g. a new device or
    // after the SW updated). Silent — no prompt, since permission exists.
    if (level !== "off" && isPushSupported() && typeof Notification !== "undefined" && Notification.permission === "granted") {
      enablePush().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  if (!user) return null;

  const choose = async (next: PushLevel) => {
    if (next === level || busy) return;
    setMsg(null);
    if (next === "off") {
      await updateUser({ pushLevel: "off" });
      try { await disablePush(); } catch { /* ignore */ }
      return;
    }
    setBusy(true);
    try {
      const ok = await enablePush();
      if (ok) {
        await updateUser({ pushLevel: next });
      } else {
        setMsg(
          isIos() && !isStandalone()
            ? "On iPhone, add the app to your Home Screen first, then turn this on."
            : "Couldn't turn on notifications — allow them when prompted (or in your browser settings).",
        );
      }
    } catch {
      setMsg("Couldn't turn on notifications on this device.");
    } finally {
      setBusy(false);
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
    <div className="space-y-2">
      <p className="px-1 text-sm font-medium">Push notifications</p>
      <div className="overflow-hidden rounded-2xl ring-1 ring-border">
        {LEVELS.map((l, i) => (
          <button
            key={l.value}
            type="button"
            disabled={busy}
            onClick={() => choose(l.value)}
            aria-pressed={level === l.value}
            className={`press flex w-full items-start justify-between gap-3 p-4 text-left disabled:opacity-60 ${i ? "border-t border-border" : ""} ${level === l.value ? "bg-primary/10" : "bg-card"}`}
          >
            <span className="min-w-0">
              <span className="text-sm font-medium">{l.label}</span>
              <span className="block text-xs text-foreground/50">{l.desc}</span>
            </span>
            <span
              aria-hidden
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs text-white ring-1 ${level === l.value ? "bg-primary ring-primary" : "ring-border"}`}
            >
              {level === l.value ? "✓" : ""}
            </span>
          </button>
        ))}
      </div>
      {busy && <p className="px-1 text-xs text-foreground/50">Setting up notifications…</p>}
      {msg && <p className="px-1 text-xs text-accent">{msg}</p>}
      {needsInstall && !msg && (
        <p className="px-1 text-xs text-foreground/45">
          On iPhone, add the app to your Home Screen (Share → Add to Home Screen) so notifications can reach you.
        </p>
      )}
    </div>
  );
}
