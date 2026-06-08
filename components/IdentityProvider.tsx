"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { type Session } from "@supabase/supabase-js";
import type { User } from "@/lib/types";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Admin "view as" preview. Device-local, UI-only: it changes what the app shows
 * (guest privacy wall / member view), never the real Supabase session — so RLS
 * and your actual identity are untouched. "member" keeps you signed in but hides
 * admin tools; "guest" renders the app as a signed-out visitor.
 */
export type PreviewMode = "off" | "member" | "guest";
/** A specific member to preview the app as (UI-only — name/avatar + member view). */
export interface PreviewMember {
  id: string;
  name: string;
  avatarUrl: string | null;
}
const PREVIEW_KEY = "mlr-preview-as";

interface IdentityValue {
  user: User | null;
  /** True when the signed-in user is an admin — strictly the database
   *  `profiles.is_admin` flag (the single source of truth). Forced false while
   *  previewing as a member/guest. */
  isAdmin: boolean;
  /** Current admin "view as" preview (off unless an admin turned it on). */
  previewMode: PreviewMode;
  /** When previewing as a specific member, who it is (UI-only); null otherwise. */
  previewMember: PreviewMember | null;
  /** The id whose experience to show: the previewed member's id while previewing
   *  as a member, else null (use your real session). UI scoping only — the
   *  database still governs what you can actually read. */
  previewAsId: string | null;
  /** Switch the preview. Entering a preview is admin-only; exiting is always allowed. */
  setPreviewMode: (mode: PreviewMode) => void;
  /** Preview as a specific member (admin-only); pass null to clear. */
  setPreviewMember: (m: PreviewMember | null) => void;
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
  previewMode: "off",
  previewMember: null,
  previewAsId: null,
  setPreviewMode: () => {},
  setPreviewMember: () => {},
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
  push_types: string[] | null;
  push_self_notify: boolean | null;
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
  const [previewMode, setPreviewState] = useState<PreviewMode>("off");
  const [previewMember, setPreviewMemberState] = useState<PreviewMember | null>(null);

  // Restore a saved preview on mount (device-local, SSR-safe — read after mount).
  useEffect(() => {
    try {
      // Only restore a "guest" preview across reloads. A "member"/specific-person
      // preview needs the in-memory previewMember (not persisted), so we drop it
      // on reload rather than show a half-restored phantom.
      const saved = localStorage.getItem(PREVIEW_KEY);
      if (saved === "guest") setPreviewState("guest");
      else if (saved) localStorage.removeItem(PREVIEW_KEY);
    } catch {
      /* ignore */
    }
  }, []);

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
        .select("display_name, avatar_url, email_alerts, push_types, push_self_notify, is_admin")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!active) return;
      const profile = data as ProfileRow | null;
      const name =
        profile?.display_name?.trim() || email.split("@")[0] || "Member";
      setUser({ name, email, emailAlerts: profile?.email_alerts ?? true, pushTypes: (profile?.push_types as import("@/lib/types").PushType[] | null) ?? [], pushSelfNotify: profile?.push_self_notify ?? false, avatarUrl: profile?.avatar_url ?? null });
      setAdminFlag(Boolean(profile?.is_admin));
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
    if (patch.pushTypes !== undefined) row.push_types = patch.pushTypes;
    if (patch.pushSelfNotify !== undefined) row.push_self_notify = patch.pushSelfNotify;
    if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
    if (Object.keys(row).length) {
      await sb.from("profiles").update(row).eq("id", id);
    }
  };

  const promptSignIn = () => {
    if (!user && isSupabaseConfigured) setPrompting(true);
  };

  const setPreviewMode = (mode: PreviewMode) => {
    // Entering a preview is admin-only; exiting ("off") is always allowed.
    if (mode !== "off" && !adminFlag) return;
    setPreviewState(mode);
    setPreviewMemberState(null);
    try {
      if (mode === "off") localStorage.removeItem(PREVIEW_KEY);
      else localStorage.setItem(PREVIEW_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  // Preview as a specific member (admin-only) — UI-only, like the other previews:
  // it changes the displayed identity + applies the member view; your real
  // session, data, and permissions are untouched.
  const setPreviewMember = (m: PreviewMember | null) => {
    if (m && !adminFlag) return;
    setPreviewMemberState(m);
    setPreviewState(m ? "member" : "off");
    try {
      if (m) localStorage.setItem(PREVIEW_KEY, "member");
      else localStorage.removeItem(PREVIEW_KEY);
    } catch {
      /* ignore */
    }
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setAdminFlag(false);
    setPreviewState("off");
    setPreviewMemberState(null);
    try {
      localStorage.removeItem(PREVIEW_KEY);
    } catch {
      /* ignore */
    }
  };

  // Effective identity the app actually sees — overridden while previewing.
  const effectiveUser =
    previewMode === "guest"
      ? null
      : previewMode === "member" && previewMember
        ? { name: previewMember.name, email: "", emailAlerts: user?.emailAlerts ?? true, pushTypes: [], pushSelfNotify: false, avatarUrl: previewMember.avatarUrl }
        : user;
  const effectiveAdmin = previewMode === "off" ? adminFlag : false;

  return (
    <IdentityContext.Provider
      value={{
        user: effectiveUser,
        isAdmin: effectiveAdmin,
        previewMode,
        previewMember,
        previewAsId: previewMode === "member" && previewMember ? previewMember.id : null,
        setPreviewMode,
        setPreviewMember,
        updateUser,
        promptSignIn,
        signOut,
      }}
    >
      {children}
      {prompting && !user && isSupabaseConfigured && (
        <SignInGate onClose={() => setPrompting(false)} />
      )}
    </IdentityContext.Provider>
  );
}

/**
 * Two-step passwordless sign-in: email → one-time code (6–8 digits, set by the
 * Supabase "Email OTP Length" setting). We verify the code in-app, so the email
 * must send the code itself ({{ .Token }}), not a magic link. Both the
 * "Confirm signup" and "Magic Link" email templates must use {{ .Token }} or a
 * new member still gets a link first — see supabase/README.md "Send a numeric
 * code, not a magic link (and only ONE email)". Keeps the member
 * in the app (no browser hop), which matters for an installed PWA. The signup
 * trigger seeds `profiles.display_name` from the name entered here.
 */
function SignInGate({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const reduceMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dismiss = () => {
    if (reduceMotion()) return onClose();
    setClosing(true);
    timer.current = setTimeout(onClose, 440);
  };

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
    <div className={`fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center ${closing ? "scrim-out" : "scrim-in"}`}>
      <form
        onSubmit={step === "email" ? sendCode : verify}
        className={`relative w-full max-w-sm space-y-4 rounded-3xl bg-background p-6 ring-1 ring-border ${closing ? "pop-close sm:pop-close" : "pop-panel sm:pop-panel"}`}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="press absolute right-4 top-4 rounded-full px-1 text-foreground/40 hover:text-foreground"
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
              className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-40"
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
              className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-40"
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
              className="press w-full text-center text-xs text-foreground/50"
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
