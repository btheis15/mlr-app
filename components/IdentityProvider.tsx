"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { type Session } from "@supabase/supabase-js";
import type { User, NotifPrefType, PushType } from "@/lib/types";
import { DEFAULT_NOTIF_TYPES } from "@/lib/types";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { clearAllCaches, readPersisted, writePersisted } from "@/lib/swrCache";
import { WelcomeIntro } from "@/components/WelcomeIntro";
import { isIos, isStandalone } from "@/lib/push";
import { InstallFirstNudge } from "@/components/InstallFirstNudge";

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
  /** True once the initial auth check has settled — i.e. we've read the stored
   *  session (and loaded its profile) or determined there is none. `user` is
   *  trustworthy only after this flips true; before it, we simply don't know yet.
   *  The app-open splash holds until this is true so the first paint is already
   *  the right (member vs guest) view — no post-splash shift. Always true when
   *  Supabase isn't configured (nothing to wait on). */
  authReady: boolean;
  /** The REAL signed-in auth uid (`session.user.id`) — resolved locally from
   *  the stored session on the first client tick, so it's available a full
   *  network round-trip before `user` used to be. Never the preview identity:
   *  pair with `previewAsId` where a preview should win (`previewAsId ?? userId`)
   *  — or just use `effectiveUserId` below, which already does that.
   *  Null while signed out or before the session is read. */
  userId: string | null;
  /** `previewAsId ?? userId` — the id whose data a "my stuff" read should show.
   *  THE canonical identity for any query/display logic that means "what does
   *  the CURRENT VIEWER see as their own" (my RSVP, my reaction, my vote, my
   *  notifications, "is this my post", …): use this, never a raw
   *  `supabase.auth.getUser()`/`getSession()` call or `userId` alone, or the
   *  admin's real account leaks through during a "view as" preview. Null when
   *  signed out (or before the session resolves) and not previewing. */
  effectiveUserId: string | null;
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
  /** Patch the current user (display name / email-alerts) → writes `profiles`.
   *  Resolves `{ error }` (null on success). On a failed write the optimistic
   *  change is rolled back so the UI never shows a value that didn't persist
   *  (which would silently revert to the DB value — e.g. the email-prefix
   *  default — on the next cold load). Callers that don't care can ignore it. */
  updateUser: (patch: Partial<User>) => Promise<{ error: string | null }>;
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
  /** True for a brand-new member whose profile is still essentially empty
   *  (only their name) and who hasn't seen the first-run Welcome intro yet
   *  (`profiles.intro_seen` false). Drives the one-time onboarding sheet; forced
   *  false while previewing. */
  needsIntro: boolean;
  /** True when the current session was created by an admin's /admin/invite-link
   *  email (`profiles.invited_via = 'invite_link'`) and the intro hasn't run yet.
   *  Since that link signs whoever clicks it straight in — no code, no password —
   *  a forwarded invite would otherwise land the forwardee in the original
   *  invitee's account with no warning. WelcomeIntro shows an extra "is this you?"
   *  confirmation step first when this is true. Always false once `needsIntro`
   *  clears (one-time, same as the intro itself). */
  invitedViaLink: boolean;
  /** Mark the Welcome intro as seen (`profiles.intro_seen = true`) so it never
   *  shows again, and clear `needsIntro` for this session. */
  completeIntro: () => void;
  signOut: () => void;
}

const IdentityContext = createContext<IdentityValue>({
  user: null,
  isAdmin: false,
  authReady: true,
  userId: null,
  effectiveUserId: null,
  previewMode: "off",
  previewMember: null,
  previewAsId: null,
  setPreviewMode: () => {},
  setPreviewMember: () => {},
  updateUser: async () => ({ error: null }),
  startEmailChange: async () => ({ error: "Sign-in isn't available." }),
  confirmEmailChange: async () => ({ error: "Sign-in isn't available." }),
  promptSignIn: () => {},
  needsIntro: false,
  invitedViaLink: false,
  completeIntro: () => {},
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
/** What we snapshot on-device so a returning member paints signed-in on the
 *  first client tick instead of after the profile round-trip. Deliberately
 *  excludes needsIntro/invitedViaLink — those gate a one-time sheet, and
 *  restoring them could re-show it; the network resolves them as before. */
interface IdentitySnapshot {
  user: User;
  isAdmin: boolean;
}

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [adminFlag, setAdminFlag] = useState(false);
  // One-shot guard: the persisted snapshot may only seed BEFORE the first
  // network profile load — a later onAuthStateChange re-entry must never
  // clobber fresher state with the stale snapshot.
  const snapshotSeededRef = useRef(false);
  // Has the initial auth check finished? Starts false; flips true once the
  // stored session (+ profile) is loaded, or immediately if there's no backend.
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [prompting, setPrompting] = useState(false);
  // True for a brand-new member who should see the first-run Welcome intro.
  const [needsIntro, setNeedsIntro] = useState(false);
  // True when this session came from an admin's invite-link email — see
  // IdentityValue.invitedViaLink for why this needs its own confirmation step.
  const [invitedViaLink, setInvitedViaLink] = useState(false);
  // The iOS "add it first, sign in once" reminder (see promptSignIn): an
  // interstitial shown instead of the sign-in sheet when a guest taps Sign in
  // while browsing in Safari (not the installed Home-Screen app).
  const [installNudge, setInstallNudge] = useState(false);
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
          setUserId(null);
          setAdminFlag(false);
          setNeedsIntro(false);
          setInvitedViaLink(false);
        }
        return;
      }
      if (active) setUserId(session.user.id);
      // Restore the on-device snapshot BEFORE the network profile fetch, so a
      // returning member's first client tick already renders signed-in (no
      // guest-view flash, and every user-gated fetch starts a round-trip
      // earlier). getSession() resolves from local storage, so this whole path
      // is network-free. No TTL — a live session implies the snapshot's owner.
      // The fetch below overwrites with fresh values and re-persists. Note a
      // since-demoted admin can paint admin UI for ~1s until that lands —
      // acceptable: is_admin is UI-only, RLS is the real gate.
      if (active && !snapshotSeededRef.current) {
        snapshotSeededRef.current = true;
        const snap = readPersisted<IdentitySnapshot>(
          `identity.${session.user.id}`,
          Number.POSITIVE_INFINITY,
        );
        if (snap?.user) {
          setUser(snap.user);
          setAdminFlag(Boolean(snap.isAdmin));
        }
      }
      const email = session.user.email ?? "";
      const { data } = await sb
        .from("profiles")
        .select("display_name, avatar_url, email_alerts, push_types, push_self_notify, notify_new_members, notif_types, push_prompted, willing_to_help, is_admin")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!active) return;
      const profile = data as ProfileRow | null;
      const name =
        profile?.display_name?.trim() || email.split("@")[0] || "Member";
      const nextUser: User = { name, email, emailAlerts: profile?.email_alerts ?? true, pushTypes: (profile?.push_types as PushType[] | null) ?? [], pushSelfNotify: profile?.push_self_notify ?? false, notifyNewMembers: profile?.notify_new_members ?? true, notifTypes: (profile?.notif_types as NotifPrefType[] | null) ?? DEFAULT_NOTIF_TYPES, pushPrompted: profile?.push_prompted ?? true, willingToHelp: profile?.willing_to_help ?? false, avatarUrl: profile?.avatar_url ?? null };
      setUser(nextUser);
      setAdminFlag(Boolean(profile?.is_admin));
      // Refresh the on-device snapshot with the server truth (see restore above).
      writePersisted<IdentitySnapshot>(`identity.${session.user.id}`, {
        user: nextUser,
        isAdmin: Boolean(profile?.is_admin),
      });

      // Assess whether to show the first-run Welcome intro: a separate, GUARDED
      // read so a missing `intro_seen` column (migration 0045 not run yet) can
      // never break sign-in — it just leaves the intro dormant. Show it only for
      // a member who hasn't seen it AND whose profile is still essentially empty
      // (no phone / birthday / preferred-pay — i.e. nothing but the name they
      // typed at signup).
      try {
        const { data: extra, error } = await sb
          .from("profiles")
          .select("intro_seen, phone, birthday, pay_preferred, invited_via")
          .eq("id", session.user.id)
          .maybeSingle();
        if (!active) return;
        if (error || !extra) {
          setNeedsIntro(false);
          setInvitedViaLink(false);
        } else {
          const e = extra as {
            intro_seen: boolean | null;
            phone: string | null;
            birthday: string | null;
            pay_preferred: string | null;
            invited_via: string | null;
          };
          const sparse = !e.phone?.trim() && !e.birthday && !e.pay_preferred;
          const needsIt = !e.intro_seen && sparse;
          setNeedsIntro(needsIt);
          setInvitedViaLink(needsIt && e.invited_via === "invite_link");
        }
      } catch {
        if (active) {
          setNeedsIntro(false);
          setInvitedViaLink(false);
        }
      }
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

  const updateUser = async (
    patch: Partial<User>,
  ): Promise<{ error: string | null }> => {
    const sb = supabase;
    if (!sb || !user) return { error: "You're not signed in." };
    const prev = user;
    const patched = { ...user, ...patch };
    setUser(patched); // optimistic
    const { data: sess } = await sb.auth.getSession();
    const id = sess.session?.user.id;
    if (!id) {
      setUser(prev); // roll back — no session to write to
      return { error: "You're not signed in." };
    }
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
      const { error } = await sb.from("profiles").update(row).eq("id", id);
      if (error) {
        // The write didn't land. Roll the optimistic change back (and re-pin the
        // snapshot to the last-good value) so the UI doesn't show a name/setting
        // that only lives on this device — which would otherwise vanish on the
        // next cold load when the profile refetch overwrites it with the DB value
        // (for a brand-new member, the email-prefix default). Surface it so the
        // caller can tell the user instead of silently reverting.
        setUser(prev);
        writePersisted<IdentitySnapshot>(`identity.${id}`, {
          user: prev,
          isAdmin: adminFlag,
        });
        return { error: "Couldn't save that. Check your connection and try again." };
      }
    }
    // Keep the on-device snapshot current so a rename/avatar change doesn't flash
    // the old value on the next cold open — but only after the write is confirmed.
    writePersisted<IdentitySnapshot>(`identity.${id}`, {
      user: patched,
      isAdmin: adminFlag,
    });
    return { error: null };
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
    if (user || !isSupabaseConfigured) return;
    // iOS only: Safari and the installed Home-Screen app keep SEPARATE logins,
    // so signing in here and adding MLR to the Home Screen later means signing
    // in a second time inside the icon app. Remind them to add it first (sign in
    // once) before opening the sign-in sheet. On Android/desktop an installed PWA
    // reuses the browser's session — no double sign-in — so skip straight to it.
    if (isIos() && !isStandalone()) {
      setInstallNudge(true);
      return;
    }
    setPrompting(true);
  };

  // Mark the first-run Welcome intro as seen so it never shows again. Clears the
  // flag locally right away, then persists `intro_seen` (guarded — a no-op if the
  // 0045 column isn't there yet).
  const completeIntro = async () => {
    setNeedsIntro(false);
    setInvitedViaLink(false);
    const sb = supabase;
    if (!sb) return;
    const { data: sess } = await sb.auth.getSession();
    const id = sess.session?.user.id;
    if (!id) return;
    try {
      await sb.from("profiles").update({ intro_seen: true }).eq("id", id);
    } catch {
      /* pre-migration: nothing to persist */
    }
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
    // Wipe every cached snapshot (identity + all mlr.cache.* data) so nothing
    // from this account can paint for the next person on a shared device.
    clearAllCaches();
    snapshotSeededRef.current = false;
    setUser(null);
    setUserId(null);
    setAdminFlag(false);
    setNeedsIntro(false);
    setInvitedViaLink(false);
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

  return (
    <IdentityContext.Provider
      value={{
        user: effectiveUser,
        isAdmin: effectiveAdmin,
        authReady,
        userId,
        effectiveUserId: previewMode === "member" && previewMember ? previewMember.id : userId,
        previewMode,
        previewMember,
        previewAsId: previewMode === "member" && previewMember ? previewMember.id : null,
        setPreviewMode,
        setPreviewMember,
        updateUser,
        startEmailChange,
        confirmEmailChange,
        promptSignIn,
        needsIntro: previewMode === "off" ? needsIntro : false,
        invitedViaLink: previewMode === "off" ? invitedViaLink : false,
        completeIntro,
        signOut,
      }}
    >
      {children}
      {installNudge && !user && isSupabaseConfigured && (
        <InstallFirstNudge
          onClose={() => setInstallNudge(false)}
          onSignInAnyway={() => {
            setInstallNudge(false);
            setPrompting(true);
          }}
        />
      )}
      {prompting && !user && isSupabaseConfigured && (
        <SignInGate onClose={() => setPrompting(false)} />
      )}
      {needsIntro && user && previewMode === "off" && isSupabaseConfigured && (
        <WelcomeIntro />
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
 * Two-step passwordless sign-in: email → OTP code. Works for both new and
 * returning members — new members get the WelcomeIntro after first verify to
 * fill in their name and other basics.
 */
function SignInGate({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
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
  const normEmail = email.trim().toLowerCase();

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !emailValid) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: normEmail,
      options: { shouldCreateUser: true },
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
      options: { shouldCreateUser: true },
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
    const { error } = await supabase.auth.verifyOtp({
      email: normEmail,
      token,
      type: "email",
    });
    if (error) {
      setBusy(false);
      setError(friendlyAuthError(error.message));
      return;
    }
    setBusy(false);
    onClose(); // onAuthStateChange picks up the new session
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center ${closing ? "scrim-out pointer-events-none" : "scrim-in"}`}>
      <form
        onSubmit={step === "email" ? sendCode : verify}
        className={`relative w-full max-w-sm space-y-4 rounded-3xl bg-background p-6 ring-1 ring-border ${closing ? "pop-close sm:pop-close" : "pop-panel sm:pop-panel"}`}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="press absolute right-4 top-4 rounded-full px-1 text-faint hover:text-foreground"
        >
          ✕
        </button>
        <div className="space-y-2 text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
            🌲
          </div>
          <h1 className="text-xl font-bold">
            {step === "email" ? "Sign in" : "Check your email"}
          </h1>
          <p className="text-sm text-foreground/60">
            {step === "email"
              ? "Browsing is open to everyone. Enter your email to post, RSVP, and get updates — we'll send you a code to confirm it's you. No password needed."
              : `We emailed you a sign-in code to ${normEmail} — enter it below.`}
          </p>
        </div>

        {step === "email" ? (
          <>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              type="email"
              autoComplete="email"
              className="w-full rounded-xl bg-card px-3 py-3 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={!emailValid || busy}
              className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </>
        ) : (
          <>
            <input
              value={code}
              // Digit-count-agnostic on purpose: don't hard-code a length in
              // the copy or validation here — accept 6-8 digits (Supabase's
              // email OTP is 6 by default) so this can't drift out of sync
              // with whatever the project is actually configured to send.
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="123456"
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
              <span className="text-muted">Still nothing?</span>
              <button
                type="button"
                onClick={resend}
                disabled={busy || cooldown > 0}
                className="press font-semibold text-primary disabled:text-faint"
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
          className="press block text-center text-xs text-muted underline-offset-2 hover:underline"
        >
          Need help signing in?
        </Link>
      </form>
    </div>
  );
}
