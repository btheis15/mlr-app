"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@/lib/types";
import { isAdmin } from "@/lib/data";

const STORAGE_KEY = "mlr-user";

interface IdentityValue {
  user: User | null;
  /** True when the signed-in user's email is on the admin allow-list. */
  isAdmin: boolean;
  /** Patch the current user (e.g. toggle email alerts). */
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

/** Read the signed-in guest from anywhere in the tree. */
export function useIdentity() {
  return useContext(IdentityContext);
}

/**
 * Identity, on-demand. The whole app is public to browse — nobody is gated at
 * the door. Identity (name + email, stored on-device) is only required to *do*
 * things: post a message, RSVP, etc. Those actions call `promptSignIn()`, which
 * opens a dismissible sign-in sheet. There's no verification yet — a one-time
 * code / magic link is the planned next layer, and this is where it slots in
 * (verify the email before calling persist).
 */
export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [prompting, setPrompting] = useState(false);

  useEffect(() => {
    // Hydrate any on-device identity after mount. We intentionally render the
    // app immediately (no blank gate) — `user` starts null on both server and
    // first client render, so there's no hydration mismatch; it just fills in.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (u: User) => {
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setPrompting(false);
  };

  const updateUser = (patch: Partial<User>) => {
    if (!user) return;
    persist({ ...user, ...patch });
  };

  const promptSignIn = () => {
    if (!user) setPrompting(true);
  };

  const signOut = () => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <IdentityContext.Provider
      value={{ user, isAdmin: isAdmin(user?.email), updateUser, promptSignIn, signOut }}
    >
      {children}
      {prompting && !user && (
        <SignInGate onSignIn={persist} onClose={() => setPrompting(false)} />
      )}
    </IdentityContext.Provider>
  );
}

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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center">
      <form
        onSubmit={submit}
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
          <h1 className="text-xl font-bold">Join in</h1>
          <p className="text-sm text-foreground/60">
            Browsing is open to everyone. Add your name and email to post,
            RSVP, and get updates — so activity is tied to real people.
          </p>
        </div>

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
          Email verification (one-time code) is coming — for now this just
          identifies you on this device.
        </p>
      </form>
    </div>
  );
}
