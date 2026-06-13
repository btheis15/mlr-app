"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { type Session } from "@supabase/supabase-js";
import type { User, NotifPrefType, PushType } from "@/lib/types";
import { DEFAULT_NOTIF_TYPES } from "@/lib/types";
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
  /** True when the signed-in user has the Beta Tester role (`profiles.beta_tester`,
   *  migration 0029) — used to gate things being trialed. Forced false while
   *  previewing, like isAdmin. */
  isBetaTester: boolean;
  /** True once the initial auth check has settled — i.e. we've read the stored
   *  session (and loaded its profile) or determined there is none. `user` is
   *  trustworthy only after this flips true; before it, we simply don't know yet.
   *  The app-open splash holds until this is true so the first paint is already
   *  the right (member vs guest) view — no post-splash shift. Always true when
   *  Supabase isn't configured (nothing to wait on). */
  authReady: boolean;
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
  /** Start a self-serve email change: Supabase emails a confirmation code to the
   *  new address (and a heads-up to the old one — "Secure email change" stays on).
   *  Resolves `{ error }` (null on success); finish with `confirmEmailChange`. */
  startEmailChange: (newEmail: string) => Promise<{ error: string | null }>;
  /** Finish the change by verifying the code sent to the new address. On success
   *  the session's email updates and `user.email` refreshes via onAuthStateChange. */
  confirmEmailChange: (newEmail: string, code: string) => Promise<{ error: string | null }>;
  /** Open the sign-in sheet on demand — call from any action that needs an
   *  identity (post, RSVP, …). No-op if already signed in or backend absent. */
  promptSignIn: () => void;
  signOut: () => void;
}

const IdentityContext = createContext<IdentityValue>({
  user: null,
  isAdmin: false,
  isBetaTester: false,
  authReady: true,
  previewMode: "off",
  previewMember: null,
  previewAsId: null,
  setPreviewMode: () => {},
  setPreviewMember: () => {},
  updateUser: () => {},
  startEmailChange: async () => ({ error: "Sign-in isn't available." }),
  confirmEmailChange: async () => ({ error: "Sign-in isn't available." }),
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
  notify_new_members: boolean | null;
  notif_types: string[] | null;
  push_prompted: boolean | null;
  willing_to_help: boolean | null;
  is_admin: boolean;
  beta_tester: boolean | null;
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
  const [betaFlag, setBetaFlag] = useState(false);
  // Has the initial auth check finished? Starts false; flips true once the
  // stored session (+ profile) is loaded, or immediately if there's no backend.
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
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
    if (!sb) {
      setAuthReady(true);
      return;
    }
    let active = true;

    const loadFromSession = async (session: Session | null) => {
      if (!session?.user) {
        if (active) {
          setUser(null);
          setAdminFlag(false);
          setBetaFlag(false);
        }
        return;
      }
      const email = session.user.email ?? "";
      const { data } = await sb
        .from("profiles")
        .select("display_name, avatar_url, email_alerts, push_types, push_self_notify, notify_new_members, notif_types, push_prompted, willing_to_help, is_admin, beta_tester")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!active) return;
      const profile = data as ProfileRow | null;
      const name =
        profile?.display_name?.trim() || email.split("@")[0] || "Member";
      setUser({ name, email, emailAlerts: profile?.email_alerts ?? true, pushTypes: (profile?.push_types as PushType[] | null) ?? [], pushSelfNotify: profile?.push_self_notify ?? false, notifyNewMembers: profile?.notify_new_members ?? true, notifTypes: (profile?.notif_types as NotifPrefType[] | null) ?? DEFAULT_NOTIF_TYPES, pushPrompted: profile?.push_prompted ?? true, willingToHelp: profile?.willing_to_help ?? false, avatarUrl: profile?.avatar_url ?? null });
      setAdminFlag(Boolean(profile?.is_admin));
      setBetaFlag(Boolean(profile?.beta_tester));
    };

    // Resolve the stored session and its profile, then mark auth settled. The
    // splash waits on this flag so the app's first visible paint is already the
    // correct member/guest view (no flash of the wrong one once it resolves).
    sb.auth
      .getSession()
      .then(({ data }) => loadFromSession(data.session))
      .finally(() => {
        if (active) setAuthReady(true);
      });
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
    if (patch.notifyNewMembers !== undefined) row.notify_new_members = patch.notifyNewMembers;
    if (patch.notifTypes !== undefined) row.notif_types = patch.notifTypes;
    if (patch.pushPrompted !== undefined) row.push_prompted = patch.pushPrompted;
    if (patch.willingToHelp !== undefined) row.willing_to_help = patch.willingToHelp;
    if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
    if (Object.keys(row).length) {
      await sb.from("profiles").update(row).eq("id", id);
    }
  };

  // Self-serve email change. Supabase's secure flow emails a code to the new
  // address (and notifies the old one); we verify it in-app, mirroring sign-in,
  // so no browser hop is needed inside the installed PWA. `profiles` stores no
  // email (it lives in auth.users), so there's nothing else to sync — the
  // session's email updates on verify and flows through loadFromSession.
  const startEmailChange = async (newEmail: string) => {
    const sb = supabase;
    if (!sb) return { error: "Sign-in isn't available." };
    const { error } = await sb.auth.updateUser({ email: newEmail.trim().toLowerCase() });
    return { error: error?.message ?? null };
  };

  const confirmEmailChange = async (newEmail: string, code: string) => {
    const sb = supabase;
    if (!sb) return { error: "Sign-in isn't available." };
    const { error } = await sb.auth.verifyOtp({
      email: newEmail.trim().toLowerCase(),
      token: code.trim(),
      type: "email_change",
    });
    return { error: error?.message ?? null };
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
    setBetaFlag(false);
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
        ? { name: previewMember.name, email: "", emailAlerts: user?.emailAlerts ?? true, pushTypes: [], pushSelfNotify: false, notifyNewMembers: false, notifTypes: DEFAULT_NOTIF_TYPES, pushPrompted: true, willingToHelp: false, avatarUrl: previewMember.avatarUrl }
        : user;
  const effectiveAdmin = previewMode === "off" ? adminFlag : false;
  const effectiveBeta = previewMode === "off" ? betaFlag : false;

  return (
    <IdentityContext.Provider
      value={{
        user: effectiveUser,
        isAdmin: effectiveAdmin,
        isBetaTester: effectiveBeta,
        authReady,
        previewMode,
        previewMember,
        previewAsId: previewMode === "member" && previewMember ? previewMember.id : null,
        setPreviewMode,
        setPreviewMember,
        updateUser,
        startEmailChange,
        confirmEmailChange,
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
 * Turn a raw Supabase auth error into something a non-technical member can act
 * on. We match on the substrings Supabase actually returns and fall back to the
 * original text (trimmed) so we never hide a genuinely novel error.
 */
function friendlyAuthError(raw: string | undefined | null): string {
  const m = (raw ?? "").toLowerCase();
  if (!m) return "Something went wrong. Please try again.";
  if (m.includes("token has expired") || m.includes("expired"))
    return "That code has expired. Tap “Resend code” to get a fresh one.";
  if (m.includes("invalid") && (m.includes("token") || m.includes("otp") || m.includes("code")))
    return "That code didn’t match. Double-check it, or tap “Resend code.”";
  if (m.includes("rate") || m.includes("too many") || m.includes("limit"))
    return "Too many tries just now. Wait a minute, then try again.";
  if (m.includes("network") || m.includes("fetch") || m.includes("failed to"))
    return "Can’t reach the network. Check your connection and try again.";
  if (m.includes("email") && m.includes("invalid"))
    return "That doesn’t look like a valid email. Please check it.";
  // Unknown — show the real message but capitalized, so nothing is swallowed.
  return raw!.charAt(0).toUpperCase() + raw!.slice(1);
}

// How long (seconds) to make someone wait before they can request another code,
// so a frustrated tap-tap-tap doesn't trip Supabase's own rate limit.
const RESEND_COOLDOWN = 30;

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
  const [closing, setClosing] = useState(false);
  // Resend throttle: seconds left before "Resend code" re-enables, and a flash
  // confirmation after a successful resend.
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Tick the resend cooldown down to zero once a code has been sent.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);
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
      setError(friendlyAuthError(error.message));
      return;
    }
    setCooldown(RESEND_COOLDOWN);
    setStep("code");
  };

  // Re-send a fresh code without making the user retype their email. Same call
  // as sendCode; throttled by the cooldown so rapid taps can't hit Supabase's
  // rate limit and lock them out.
  const resend = async () => {
    if (!supabase || busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    setResent(false);
    const { error } = await supabase.auth.signInWithOtp({
      email: normEmail,
      options: { shouldCreateUser: true, data: { display_name: name.trim() } },
    });
    setBusy(false);
    if (error) {
      setError(friendlyAuthError(error.message));
      return;
    }
    setCode("");
    setResent(true);
    setCooldown(RESEND_COOLDOWN);
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
      setError(friendlyAuthError(error.message));
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
              ? "Browsing is open to everyone. Add your name and email to post, RSVP, and get updates — we'll email you a code to confirm it's you. No password to create or remember."
              : `We emailed an 8-digit code to ${normEmail} — enter it below.`}
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
              // Supabase emails an 8-digit OTP for this project (the email-OTP
              // length is a project setting). Accept up to 8; verify enables at
              // 6 so it still works if that setting is ever lowered.
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="12345678"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Code from your email"
              className="w-full rounded-xl bg-card px-3 py-3 text-center text-xl font-semibold tracking-[0.25em] ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={code.trim().length < 6 || busy}
              className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Verifying…" : "Verify & sign in"}
            </button>

            {/* The #1 reason a code seems "not to arrive." Say it plainly. */}
            <p className="text-center text-xs text-foreground/60">
              The email lands in a few seconds.{" "}
              <b className="font-semibold text-foreground/75">
                Don&rsquo;t see it? Check your spam or junk folder.
              </b>
            </p>

            <div className="flex items-center justify-center gap-1 text-xs">
              <span className="text-foreground/55">Still nothing?</span>
              <button
                type="button"
                onClick={resend}
                disabled={busy || cooldown > 0}
                className="press font-semibold text-primary disabled:text-foreground/40"
              >
                {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
              </button>
            </div>

            {resent && (
              <p className="text-center text-xs font-medium text-primary">
                ✓ New code sent — check your inbox (and spam).
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
                setResent(false);
                setCooldown(0);
              }}
              className="press w-full text-center text-xs text-foreground/60"
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

        {/* Human escape hatch — always one tap from the sign-in sheet. */}
        <Link
          href="/help"
          onClick={dismiss}
          className="press block text-center text-xs text-foreground/55 underline-offset-2 hover:underline"
        >
          Need help signing in?
        </Link>
      </form>
    </div>
  );
}
