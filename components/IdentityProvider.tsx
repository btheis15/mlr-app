"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { User } from "@/lib/types";
import { isAdmin as isAdminEmail } from "@/lib/data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { User as AuthUser } from "@supabase/supabase-js";

const STORAGE_KEY = "mlr-user";

interface IdentityValue {
  user: User | null;
  /** True when the signed-in user is an admin (DB `is_admin`, else the email
   *  allow-list as a pre-backend fallback). */
  isAdmin: boolean;
  /** Patch the current user (e.g. toggle email alerts). Persists to the
   *  `profiles` row when signed in via Supabase, else to localStorage. */
  updateUser: (patch: Partial<User>) => void;
  /** Open the sign-in sheet on demand — call this from any action that needs
   *  an identity (post a message, RSVP, etc.). No-op if already signed in. */
  promptSignIn: () => void;
  signOut: () => void;
}

const IdentityContext = createContext<IdentityValue>({
  user: null,
  isAdmin: false,
  updateUser: () => {},
  promptSignIn: () => {},
  signOut: () => {},
});

/** Read the signed-in member from anywhere in the tree. */
export function useIdentity() {
  return useContext(IdentityContext);
}

/**
 * Identity, on-demand. The whole app is public to browse — nobody is gated at
 * the door. Identity is only required to *do* things (post, RSVP, …); those
 * actions call `promptSignIn()`, which opens a dismissible sheet.
 *
 * Two modes, same public API:
 *  - **Supabase configured** (NEXT-STEPS.md §3): real **passwordless email-OTP**
 *    — enter email → 6-digit code → verified session, persisted on-device so
 *    you stay signed in. Identity is hydrated from the shared `profiles` row,
 *    so it's ONE account across both apps.
 *  - **Not configured** (today, pre-backend): name + email captured on-device
 *    (localStorage) with no verification — unchanged legacy behavior.
 */
export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [prompting, setPrompting] = useState(false);

  // Hydrate our `User` from the Supabase auth user + its `profiles` row,
  // creating the profile on first sign-in from the OTP metadata.
  const loadProfile = useCallback(async (authUser: AuthUser) => {
    if (!supabase) return;
    const meta = authUser.user_metadata ?? {};
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, avatar_url, email_alerts, is_admin")
      .eq("id", authUser.id)
      .maybeSingle();

    let row = profile;
    if (!row) {
      // First sign-in: seed the profile from what they typed at the OTP step.
      const seed = {
        id: authUser.id,
        email: authUser.email,
        display_name: (meta.name as string) ?? authUser.email?.split("@")[0] ?? "",
        email_alerts: (meta.email_alerts as boolean) ?? true,
      };
      const { data: created } = await supabase
        .from("profiles")
        .upsert(seed, { onConflict: "id" })
        .select("display_name, avatar_url, email_alerts, is_admin")
        .maybeSingle();
      row = created ?? null;
    }

    setUser({
      id: authUser.id,
      name: row?.display_name || (meta.name as string) || authUser.email || "",
      email: authUser.email ?? "",
      emailAlerts: row?.email_alerts ?? true,
      avatarUrl: row?.avatar_url ?? undefined,
      isAdmin: row?.is_admin ?? undefined,
    });
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured && supabase) {
      // Restore an existing session (returning users skip the code entirely).
      supabase.auth.getSession().then(({ data }) => {
        if (data.session?.user) void loadProfile(data.session.user);
        setReady(true);
      });
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) void loadProfile(session.user);
        else setUser(null);
      });
      return () => sub.subscription.unsubscribe();
    }
    // Device-only fallback (pre-backend) — unchanged behavior.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, [loadProfile]);

  const updateUser = (patch: Partial<User>) => {
    if (!user) return;
    const next = { ...user, ...patch };
    setUser(next);
    if (isSupabaseConfigured && supabase && user.id) {
      void supabase
        .from("profiles")
        .update({ display_name: next.name, email_alerts: next.emailAlerts })
        .eq("id", user.id);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  };

  // Used only by the device-only fallback sheet.
  const persistLocal = (u: User) => {
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setPrompting(false);
  };

  const promptSignIn = () => {
    if (!user) setPrompting(true);
  };

  const signOut = async () => {
    if (isSupabaseConfigured && supabase) await supabase.auth.signOut();
    else localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  // Avoid a flash before we've restored session / read storage.
  if (!ready) return null;

  return (
    <IdentityContext.Provider
      value={{
        user,
        isAdmin: user?.isAdmin ?? isAdminEmail(user?.email),
        updateUser,
        promptSignIn,
        signOut,
      }}
    >
      {children}
      {prompting &&
        !user &&
        (isSupabaseConfigured ? (
          <OtpSignIn onClose={() => setPrompting(false)} />
        ) : (
          <SignInGate onSignIn={persistLocal} onClose={() => setPrompting(false)} />
        ))}
    </IdentityContext.Provider>
  );
}

/* ───────────────────────── Passwordless email-OTP sheet ─────────────────────
   Step 1: name + email → Supabase emails a 6-digit code.
   Step 2: enter the code → verified session. onAuthStateChange (above) then
   hydrates the profile and closes the sheet. */
function OtpSignIn({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = name.trim().length > 1 && /\S+@\S+\.\S+/.test(email);
  const codeValid = /^\d{6}$/.test(code.trim());
  const cleanEmail = email.trim().toLowerCase();

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValid || !supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        shouldCreateUser: true,
        data: { name: name.trim(), email_alerts: emailAlerts },
      },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setStep("code");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeValid || !supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) setError(error.message);
    else onClose(); // session set → onAuthStateChange hydrates + this unmounts
  };

  return (
    <Sheet onClose={onClose}>
      <div className="space-y-2 text-center">
        <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
          🌲
        </div>
        <h1 className="text-xl font-bold">
          {step === "email" ? "Join in" : "Check your email"}
        </h1>
        <p className="text-sm text-foreground/60">
          {step === "email"
            ? "Browsing is open to everyone. Add your name and email to post, RSVP, and get updates — we'll email you a code, no password."
            : `Enter the 6-digit code we sent to ${cleanEmail}.`}
        </p>
      </div>

      {step === "email" ? (
        <form onSubmit={sendCode} className="space-y-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            className="w-full rounded-xl bg-card px-3 py-3 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            type="email"
            autoComplete="email"
            className="w-full rounded-xl bg-card px-3 py-3 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <label className="flex items-center gap-3 rounded-xl bg-card px-3 py-3 text-sm ring-1 ring-border">
            <input
              type="checkbox"
              checked={emailAlerts}
              onChange={(e) => setEmailAlerts(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            <span className="text-foreground/80">
              Email me important alerts
              <span className="block text-xs text-foreground/40">
                In case you miss them in the app. You can change this anytime.
              </span>
            </span>
          </label>
          {error && <p className="text-center text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={!emailValid || busy}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full rounded-xl bg-card px-3 py-3 text-center text-lg tracking-[0.4em] ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          {error && <p className="text-center text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={!codeValid || busy}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Verifying…" : "Verify & enter"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
            className="w-full text-center text-xs text-foreground/40"
          >
            ← Use a different email
          </button>
        </form>
      )}
    </Sheet>
  );
}

/* ───────────── Device-only fallback (pre-backend, unchanged) ──────────────── */
function SignInGate({
  onSignIn,
  onClose,
}: {
  onSignIn: (u: User) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailAlerts, setEmailAlerts] = useState(true);

  const valid = name.trim().length > 1 && /\S+@\S+\.\S+/.test(email);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSignIn({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      emailAlerts,
    });
  };

  return (
    <Sheet onClose={onClose}>
      <div className="space-y-2 text-center">
        <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
          🌲
        </div>
        <h1 className="text-xl font-bold">Join in</h1>
        <p className="text-sm text-foreground/60">
          Browsing is open to everyone. Add your name and email to post, RSVP,
          and get updates — so activity is tied to real people.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
          className="w-full rounded-xl bg-card px-3 py-3 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          type="email"
          autoComplete="email"
          className="w-full rounded-xl bg-card px-3 py-3 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        <label className="flex items-center gap-3 rounded-xl bg-card px-3 py-3 text-sm ring-1 ring-border">
          <input
            type="checkbox"
            checked={emailAlerts}
            onChange={(e) => setEmailAlerts(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-primary)]"
          />
          <span className="text-foreground/80">
            Email me important alerts
            <span className="block text-xs text-foreground/40">
              In case you miss them in the app. You can change this anytime.
            </span>
          </span>
        </label>
        <button
          type="submit"
          disabled={!valid}
          className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Enter
        </button>
        <p className="text-center text-xs text-foreground/40">
          Email verification (one-time code) turns on once Supabase is
          configured — for now this just identifies you on this device.
        </p>
      </form>
    </Sheet>
  );
}

/** Shared bottom-sheet chrome for the sign-in flows. */
function Sheet({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center">
      <div className="relative w-full max-w-sm space-y-4 rounded-3xl bg-background p-6 ring-1 ring-border">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full px-1 text-foreground/40 hover:text-foreground"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
