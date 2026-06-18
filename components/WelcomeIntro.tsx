"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "@/components/IdentityProvider";
import { BirthdayPicker } from "@/components/BirthdayPicker";
import { PushToggle } from "@/components/PushToggle";
import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/roles";
import { isPushSupported, isIos, isStandalone } from "@/lib/push";

/**
 * First-run Welcome intro — a guided, two-step sheet that pops the first time a
 * brand-new member verifies their sign-in code, when their profile is still
 * essentially empty (see IdentityProvider `needsIntro`). It saves the newcomer a
 * trip to Settings: step 1 collects the basics (phone, birthday, preferred
 * payment), step 2 hands them the real push-notification settings so they choose
 * what buzzes their phone up front (no "I didn't know I could turn those on").
 * Finishing marks `intro_seen` (never shows again) and lands them on Home.
 *
 * It deliberately supersedes the standalone first-run PushPrompt: that prompt is
 * suppressed while this is up (it checks `needsIntro`), and reaching the push
 * step here marks `push_prompted` so the member is never asked twice.
 */

const PAY_METHODS: { key: string; label: string; placeholder: string }[] = [
  { key: "venmo", label: "Venmo", placeholder: "username" },
  { key: "zelle", label: "Zelle", placeholder: "phone or email" },
  { key: "cashapp", label: "Cash App", placeholder: "$cashtag" },
  { key: "paypal", label: "PayPal", placeholder: "paypal.me/you or email" },
];

const FIELD =
  "mt-1 w-full rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary";

export function WelcomeIntro() {
  const { user, updateUser, completeIntro } = useIdentity();
  const router = useRouter();

  const [step, setStep] = useState<"welcome" | "push">("welcome");
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [payHandle, setPayHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const firstName = (user?.name ?? "").trim().split(/\s+/)[0] || "there";
  const payPlaceholder =
    PAY_METHODS.find((m) => m.key === payMethod)?.placeholder ?? "username";

  // Persist whatever the member entered in step 1. Every field is optional, so an
  // empty form is a fine "skip" — we just write what's there. Phone/birthday/pay
  // go straight to `profiles` (like ContactPaySettings); the name flows through
  // updateUser so the rest of the app picks it up.
  const saveBasics = async () => {
    const sb = supabase;
    if (!sb) return;
    const id = await getCurrentUserId();
    if (!id) return;
    const row: Record<string, unknown> = {};
    if (phone.trim()) row.phone = phone.trim();
    if (birthday) row.birthday = birthday;
    if (payMethod && payHandle.trim()) {
      row[payMethod] = payHandle.trim();
      row.pay_preferred = payMethod;
    }
    if (Object.keys(row).length) {
      await sb.from("profiles").update(row).eq("id", id);
    }
    const trimmed = name.trim();
    if (trimmed && trimmed !== user?.name) updateUser({ name: trimmed });
  };

  const goToPush = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await saveBasics();
    } finally {
      setBusy(false);
    }
    setStep("push");
  };

  // Close + finish. `reachedPush` means they saw the push step, so we also stamp
  // `push_prompted` (when push can actually work here) to keep the standalone
  // PushPrompt from re-asking. On iOS before install, push can't run yet, so we
  // leave that flag for PushPrompt to handle after they add the app to the Home
  // Screen. Always mark the intro itself seen so it never returns.
  const finish = async (reachedPush: boolean, goHome: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (reachedPush && isPushSupported() && !(isIos() && !isStandalone())) {
        await updateUser({ pushPrompted: true });
      }
      await completeIntro();
    } finally {
      setBusy(false);
    }
    if (goHome) router.push("/");
  };

  const reduceMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // X / backdrop dismissal: treat like finishing the step they're on (so it never
  // re-nags), then animate out. No navigation — leave them where they are.
  const dismiss = () => {
    if (busy) return;
    void finish(step === "push", false);
    if (reduceMotion()) return;
    setClosing(true);
    timer.current = setTimeout(() => {}, 440);
  };

  if (!user) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center ${closing ? "scrim-out" : "scrim-in"}`}
    >
      <div
        className={`relative flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-background ring-1 ring-border ${closing ? "pop-close" : "pop-panel"}`}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="press absolute right-4 top-4 z-10 rounded-full px-1 text-foreground/40 hover:text-foreground"
        >
          ✕
        </button>

        <div className="overflow-y-auto p-6">
          {/* Tiny step indicator */}
          <div className="mb-4 flex items-center justify-center gap-1.5" aria-hidden>
            <span className={`h-1.5 w-6 rounded-full ${step === "welcome" ? "bg-primary" : "bg-primary/25"}`} />
            <span className={`h-1.5 w-6 rounded-full ${step === "push" ? "bg-primary" : "bg-primary/25"}`} />
          </div>

          {step === "welcome" ? (
            <div className="space-y-4">
              <div className="space-y-2 text-center">
                <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
                  🌲
                </div>
                <h1 className="text-xl font-bold">Welcome to MLR, {firstName}!</h1>
                <p className="text-sm text-foreground/60">
                  Glad you&rsquo;re here. Take a few seconds to fill in the basics so
                  the family can reach you and celebrate your birthday. It&rsquo;s all
                  optional — you can change any of it later in Profile.
                </p>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-foreground/70">Your name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  className={FIELD}
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-foreground/70">
                  Phone (so members can call or text you)
                </span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 715 555 0123"
                  type="tel"
                  autoComplete="tel"
                  className={FIELD}
                />
              </label>

              <div>
                <span className="text-xs font-medium text-foreground/70">Birthday</span>
                <BirthdayPicker value={birthday} onChange={setBirthday} />
                <span className="mt-1 block text-[11px] text-foreground/45">
                  Shown on your member card so everyone can wish you a happy birthday.
                </span>
              </div>

              <div>
                <span className="text-xs font-medium text-foreground/70">
                  Preferred way to be paid
                </span>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className={FIELD}
                >
                  <option value="">No preference</option>
                  {PAY_METHODS.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
                {payMethod && (
                  <input
                    value={payHandle}
                    onChange={(e) => setPayHandle(e.target.value)}
                    placeholder={payPlaceholder}
                    className={FIELD}
                  />
                )}
                <span className="mt-1 block text-[11px] text-foreground/45">
                  How folks chip in for dinners and dues — shown on your member card.
                </span>
              </div>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={goToPush}
                  disabled={busy}
                  className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Continue"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("push")}
                  disabled={busy}
                  className="press w-full py-1 text-center text-xs font-medium text-foreground/55"
                >
                  Skip for now
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2 text-center">
                <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
                  🔔
                </div>
                <h1 className="text-xl font-bold">Stay in the loop</h1>
                <p className="text-sm text-foreground/60">
                  Turn on notifications to get a heads-up on your phone for what
                  matters at the lake. A lot are on by default — turn off any you
                  don&rsquo;t want below. You can change these anytime in Profile.
                </p>
              </div>

              <PushToggle />

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => finish(true, true)}
                  disabled={busy}
                  className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Finishing…" : "Done"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("welcome")}
                  disabled={busy}
                  className="press w-full py-1 text-center text-xs font-medium text-foreground/55"
                >
                  ← Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
