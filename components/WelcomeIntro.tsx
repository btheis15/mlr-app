"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "@/components/IdentityProvider";
import { BirthdayPicker } from "@/components/BirthdayPicker";
import { PhoneInput } from "@/components/PhoneInput";
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
  const { user, updateUser, completeIntro, invitedViaLink, signOut } = useIdentity();
  const router = useRouter();

  // Push comes FIRST so turning on notifications is the very first thing a
  // newcomer sees right after verifying — then the optional profile basics.
  // A member who arrived via an admin's invite-link email sees an extra
  // "is this you?" confirmation step first — that link signs in whoever clicks
  // it with no code/password, so a forwarded email would otherwise land the
  // forwardee straight in the original invitee's account with no warning.
  const [step, setStep] = useState<"confirm" | "push" | "basics">(invitedViaLink ? "confirm" : "push");
  const [signingOut, setSigningOut] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmAttempts, setConfirmAttempts] = useState(0);
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [payHandle, setPayHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  // Set once the close animation finishes, to hide the sheet locally no
  // matter what happens with the fire-and-forget `finish()` write below —
  // otherwise a failed/slow network call would strand the dimmed overlay.
  const [dismissed, setDismissed] = useState(false);
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
    // Await so the name write finishes before onboarding navigates Home — an
    // unawaited write could be cut off mid-flight (and roll back), landing the
    // new member back on the email-prefix default.
    if (trimmed && trimmed !== user?.name) await updateUser({ name: trimmed });
  };

  // Last step (basics): save whatever they entered, then finish + go Home.
  const finishBasics = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await saveBasics();
    } finally {
      setBusy(false);
    }
    await finish(true, true);
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
    void finish(true, false);
    if (reduceMotion()) return setDismissed(true);
    setClosing(true);
    timer.current = setTimeout(() => setDismissed(true), 440);
  };

  // The invite-link confirm step never shows the target email — typing it
  // blind is what actually verifies it's theirs, not just glancing at a
  // displayed address and tapping through. A genuine mismatch (wrong
  // person, or a typo) gets a plain retry; after a few misses we quietly
  // sign out rather than ever revealing whose account this almost was.
  const tryConfirm = () => {
    const typed = confirmEmail.trim().toLowerCase();
    const real = (user?.email ?? "").trim().toLowerCase();
    if (typed && typed === real) {
      setConfirmError(null);
      setStep("push");
      return;
    }
    const next = confirmAttempts + 1;
    setConfirmAttempts(next);
    if (next >= 3) {
      void (async () => {
        setSigningOut(true);
        await signOut();
      })();
      return;
    }
    setConfirmError("That doesn't match — double check and try again.");
  };

  if (!user || dismissed) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center ${closing ? "scrim-out pointer-events-none" : "scrim-in"}`}
    >
      <div
        className={`relative flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-background ring-1 ring-border ${closing ? "pop-close" : "pop-panel"}`}
      >
        {/* No close button on the confirm step — dismissing it must not be a
            silent way to end up "in" this account without ever confirming or
            signing out. Yes/Sign-out are the only two ways past it. */}
        {step !== "confirm" && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="press absolute right-4 top-4 z-10 rounded-full px-1 text-faint hover:text-foreground"
          >
            ✕
          </button>
        )}

        <div className="overflow-y-auto p-6">
          {/* Tiny step indicator — the confirm step (invite-link only) isn't
              part of the normal push/basics flow, so it gets no dot. */}
          {step !== "confirm" && (
            <div className="mb-4 flex items-center justify-center gap-1.5" aria-hidden>
              <span className={`h-1.5 w-6 rounded-full ${step === "push" ? "bg-primary" : "bg-primary/25"}`} />
              <span className={`h-1.5 w-6 rounded-full ${step === "basics" ? "bg-primary" : "bg-primary/25"}`} />
            </div>
          )}

          {step === "confirm" ? (
            <div className="space-y-4">
              <div className="space-y-2 text-center">
                <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
                  🌲
                </div>
                <h1 className="text-xl font-bold">Confirm your email</h1>
                <p className="text-sm text-foreground/60">
                  Enter the email address this invite was sent to, to finish
                  getting started.
                </p>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-foreground/70">Email</span>
                <input
                  value={confirmEmail}
                  onChange={(e) => {
                    setConfirmEmail(e.target.value);
                    setConfirmError(null);
                  }}
                  type="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  placeholder="you@example.com"
                  className={FIELD}
                />
              </label>
              {confirmError && <p className="text-xs text-accent">{confirmError}</p>}

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={tryConfirm}
                  disabled={signingOut || !confirmEmail.trim()}
                  className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : step === "basics" ? (
            <div className="space-y-4">
              <div className="space-y-2 text-center">
                <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
                  🌲
                </div>
                <h1 className="text-xl font-bold">A few details about you</h1>
                <p className="text-sm text-foreground/60">
                  Take a few seconds to fill in the basics so the family can reach
                  you and celebrate your birthday. It&rsquo;s all optional — you can
                  change any of it later in Profile.
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
                <PhoneInput value={phone} onChange={setPhone} className="mt-1" />
              </label>

              <div>
                <span className="text-xs font-medium text-foreground/70">Birthday</span>
                <BirthdayPicker value={birthday} onChange={setBirthday} />
                <span className="mt-1 block text-xs text-faint">
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
                <span className="mt-1 block text-xs text-faint">
                  How folks chip in for dinners and dues — shown on your member card.
                </span>
              </div>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={finishBasics}
                  disabled={busy}
                  className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Finishing…" : "Done"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("push")}
                  disabled={busy}
                  className="press w-full py-1 text-center text-xs font-medium text-muted"
                >
                  ← Back
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2 text-center">
                <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
                  🔔
                </div>
                <h1 className="text-xl font-bold">Welcome to MLR, {firstName}!</h1>
                <p className="text-sm text-foreground/60">
                  First, turn on notifications so you get a heads-up on your phone
                  for what matters Up North — event RSVPs, dinners, help
                  requests, and emergencies. A lot are on by default; turn off any
                  you don&rsquo;t want. You can change these anytime in Profile.
                </p>
              </div>

              <PushToggle />

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => setStep("basics")}
                  disabled={busy}
                  className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={() => setStep("basics")}
                  disabled={busy}
                  className="press w-full py-1 text-center text-xs font-medium text-foreground/55"
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
