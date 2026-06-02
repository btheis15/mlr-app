"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { type Session } from "@supabase/supabase-js";
import type { User } from "@/lib/types";
import { isAdmin as isAdminEmail } from "@/lib/data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

interface IdentityValue {
  user: User | null;
  /** True when the signed-in user is an admin (DB `is_admin`, or the seed
   *  allow-list as a fallback during the transition). */
  isAdmin: boolean;
  /** Patch the current user (display name / email-alerts) → writes `profiles`. */
  updateUser: (patch: Partial<User>) => void;
  /** Open the sign-in sheet on demand — call from any action that needs an
   *  identity (post, RSVP, …). No-op if already signed in or backend absent. */
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

interface ProfileRow {
  display_name: string | null;
  avatar_url: string | null;
  email_alerts: boolean;
  is_admin: boolean;
}

/**
 * Identity, on-demand and verified. The whole app stays public to browse —
 * nobody is gated at the door. Identity is required only to *do* things, and
 * now it's a real, verified account: passwordless **email OTP** via Supabase
 * (NEXT-STEPS §3b) with a persisted session (stay logged in on-device). The
 * `user` shape ({ name, email, emailAlerts }) is unchanged, so consumers
 * (Posts, Crew, Profile) don't care that it's backed by Supabase now; `name`
 * comes from the member's `profiles.display_name`.
 *
 * Build-safe: if Supabase isn't configured, this degrades to "no sign-in
 * available" (user stays null) rather than throwing.
 */
export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [adminFlag, setAdminFlag] = useState(false);
  const [prompting, setPrompting] = useState(false);

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let active = true;

    const loadFromSession = async (session: Session | null) => {
      if (!session?.user) {
        if (active) {
          setUser(null);
          setAdminFlag(false);
        }
        return;
      }
      const email = session.user.email ?? "";
      const { data } = await sb
        .from("profiles")
        .select("display_name, avatar_url, email_alerts, is_admin")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!active) return;
      const profile = data as ProfileRow | null;
      const name =
        profile?.display_name?.trim() || email.split("@")[0] || "Member";
      setUser({ name, email, emailAlerts: profile?.email_alerts ?? true, avatarUrl: profile?.avatar_url ?? null });
      setAdminFlag(Boolean(profile?.is_admin) || isAdminEmail(email));
    };

    sb.auth.getSession().then(({ data }) => loadFromSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      loadFromSession(session);
      if (session) setPrompting(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const updateUser = async (patch: Partial<User>) => {
    const sb = supabase;
    if (!sb || !user) return;
    setUser({ ...user, ...patch }); // optimistic
    const { data: sess } = await sb.auth.getSession();
    const id = sess.session?.user.id;
    if (!id) return;
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.display_name = patch.name;
    if (patch.emailAlerts !== undefined) row.email_alerts = patch.emailAlerts;
    if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
    if (Object.keys(row).length) {
      await sb.from("profiles").update(row).eq("id", id);
    }
  };

  const promptSignIn = () => {
    if (!user && isSupabaseConfigured) setPrompting(true);
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setAdminFlag(false);
  };

  return (
    <IdentityContext.Provider
      value={{ user, isAdmin: adminFlag, updateUser, promptSignIn, signOut }}
    >
      {children}
      {prompting && !user && isSupabaseConfigured && (
        <SignInGate onClose={() => setPrompting(false)} />
      )}
    </IdentityContext.Provider>
  );
}

/**
 * Two-step passwordless sign-in: email → 6-digit code. Keeps the member in the
 * app (no browser hop), which matters for an installed PWA. The signup trigger
 * seeds `profiles.display_name` from the name entered here.
 */
function SignInGate({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /\S+@\S+\.\S+/.test(email);
  const nameValid = name.trim().length > 1;
  const normEmail = email.trim().toLowerCase();

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !emailValid || !nameValid) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: normEmail,
      options: { shouldCreateUser: true, data: { display_name: name.trim() } },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("code");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.trim();
    if (!supabase || token.length < 6) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.verifyOtp({
      email: normEmail,
      token,
      type: "email",
    });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    // Save the email-alerts choice (display_name is set by the signup trigger).
    const id = data.session?.user.id;
    if (id) {
      await supabase.from("profiles").update({ email_alerts: emailAlerts }).eq("id", id);
    }
    setBusy(false);
    onClose(); // onAuthStateChange picks up the new session
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center">
      <form
        onSubmit={step === "email" ? sendCode : verify}
        className="relative w-full max-w-sm space-y-4 rounded-3xl bg-background p-6 ring-1 ring-border"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full px-1 text-foreground/40 hover:text-foreground"
        >
          ✕
        </button>
        <div className="space-y-2 text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
            🌲
          </div>
          <h1 className="text-xl font-bold">
            {step === "email" ? "Join in" : "Check your email"}
          </h1>
          <p className="text-sm text-foreground/60">
            {step === "email"
              ? "Browsing is open to everyone. Add your name and email to post, RSVP, and get updates — we'll email you a code to confirm it's you."
              : `We emailed a code to ${normEmail} — enter it below.`}
          </p>
        </div>

        {step === "email" ? (
          <>
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
                  In case you miss them in the app. Change this anytime.
                </span>
              </span>
            </label>
            <button
              type="submit"
              disabled={!nameValid || !emailValid || busy}
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </>
        ) : (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="12345678"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="w-full rounded-xl bg-card px-3 py-3 text-center text-lg font-semibold tracking-[0.3em] ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={code.trim().length < 6 || busy}
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Verifying…" : "Verify & sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              className="w-full text-center text-xs text-foreground/50"
            >
              ← Use a different email
            </button>
          </>
        )}

        {error && (
          <p className="rounded-xl bg-accent/10 px-3 py-2 text-center text-xs font-medium text-accent">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
