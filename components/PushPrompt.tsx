"use client";

import { useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { enablePush, ensureServiceWorker, isPushSupported, isStandalone, isIos } from "@/lib/push";
import { DEFAULT_PUSH_TYPES } from "@/lib/types";

/**
 * First-run push prompt. The FIRST time a signed-in member opens the app on a
 * push-capable device — not just when they wander into Settings — we ask once
 * whether to turn on notifications. Saying yes subscribes this device (asking
 * the OS/browser permission inside the tap) and turns on the full set of
 * categories (DEFAULT_PUSH_TYPES); saying "Not now" simply records that we
 * asked. Either way we set `push_prompted` so this never shows again (migration
 * 0034). Members can fine-tune everything afterward in Profile → Notifications.
 *
 * On iPhone/iPad push only works once the app is on the Home Screen, so there we
 * stay quiet and let InstallHint nudge the install first; the prompt appears the
 * next time the app is opened standalone.
 */
export function PushPrompt() {
  const { user, updateUser } = useIdentity();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const pending = Boolean(user) && user?.pushPrompted === false;

  useEffect(() => {
    if (!pending) {
      setShow(false);
      return;
    }
    // Push must be supported, and on iOS the app must be installed (standalone)
    // for push to work at all — otherwise hold off (InstallHint handles install).
    if (!isPushSupported()) return;
    if (isIos() && !isStandalone()) return;
    // Pre-warm the service worker so subscribe() stays inside the user's tap on iOS.
    void ensureServiceWorker();
    setShow(true);
  }, [pending]);

  if (!show || !user) return null;

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const ok = await enablePush();
      if (ok) {
        await updateUser({ pushTypes: DEFAULT_PUSH_TYPES, pushPrompted: true });
        setShow(false);
      } else {
        // Permission denied / unavailable. Record that we asked (don't nag again)
        // and let them re-enable later from Profile → Push.
        await updateUser({ pushPrompted: true });
        setMsg("No problem — you can turn these on anytime in Profile → Notifications.");
        setTimeout(() => setShow(false), 2200);
      }
    } catch {
      await updateUser({ pushPrompted: true });
      setShow(false);
    } finally {
      setBusy(false);
    }
  };

  const notNow = async () => {
    if (busy) return;
    setShow(false);
    await updateUser({ pushPrompted: true });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] sheet-panel">
      <div className="w-full max-w-md rounded-3xl bg-card p-5 shadow-xl ring-1 ring-border">
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none">🔔</span>
          <div className="flex-1">
            <p className="text-base font-semibold">Turn on notifications?</p>
            <p className="mt-1 text-sm text-foreground/70">
              Get a heads-up on your phone for the things that matter at the lake.
            </p>
          </div>
        </div>

        <ul className="mt-4 space-y-1.5 text-sm text-foreground/80">
          <li className="flex items-center gap-2"><Dot /> Broadcast alerts &amp; birthdays</li>
          <li className="flex items-center gap-2"><Dot /> Committee &amp; cabin stay decisions</li>
          <li className="flex items-center gap-2"><Dot /> Tags, mentions &amp; replies on posts</li>
          <li className="flex items-center gap-2"><Dot /> New messages in your committees</li>
        </ul>

        {msg && <p className="mt-3 text-xs text-accent">{msg}</p>}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="press rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Turning on…" : "Turn on notifications"}
          </button>
          <button
            type="button"
            onClick={notNow}
            disabled={busy}
            className="press rounded-2xl px-4 py-2.5 text-sm font-medium text-foreground/60 disabled:opacity-60"
          >
            Not now
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-foreground/40">
          You can change these anytime in Profile → Notifications.
        </p>
      </div>
    </div>
  );
}

function Dot() {
  return <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />;
}
