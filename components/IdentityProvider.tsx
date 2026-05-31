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
  signOut: () => void;
}

const IdentityContext = createContext<IdentityValue>({
  user: null,
  isAdmin: false,
  updateUser: () => {},
  signOut: () => {},
});

/** Read the signed-in guest from anywhere in the tree. */
export function useIdentity() {
  return useContext(IdentityContext);
}

/**
 * Lightweight identity gate. Requires a name + email before the app is usable,
 * stored on-device (localStorage). There's no verification yet — a one-time
 * code / magic link is the planned next layer, and this is where it slots in
 * (verify the email before calling setUser). Until then this just ties activity
 * (like chat) to a name + email so it's not anonymous.
 */
export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const persist = (u: User) => {
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  };

  const updateUser = (patch: Partial<User>) => {
    if (!user) return;
    persist({ ...user, ...patch });
  };

  const signOut = () => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  // Avoid flashing the gate before we've read storage.
  if (!ready) return null;

  if (!user) return <SignInGate onSignIn={persist} />;

  return (
    <IdentityContext.Provider
      value={{ user, isAdmin: isAdmin(user.email), updateUser, signOut }}
    >
      {children}
    </IdentityContext.Provider>
  );
}

function SignInGate({ onSignIn }: { onSignIn: (u: User) => void }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="space-y-2 text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
            🌲
          </div>
          <h1 className="text-xl font-bold">Muskellunge Lake Resort</h1>
          <p className="text-sm text-foreground/60">
            Add your name and email to join — it keeps the chat and updates tied
            to real people, not strangers.
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
