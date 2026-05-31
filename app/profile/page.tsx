"use client";

import { AdminAlertComposer } from "@/components/AdminAlertComposer";
import { useIdentity } from "@/components/IdentityProvider";
import { READ_ONLY } from "@/lib/features";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";

export default function ProfilePage() {
  const { user, isAdmin, updateUser, promptSignIn, signOut } = useIdentity();

  // Read-only launch: accounts aren't live yet. Browsing stays fully open;
  // profiles + sign-in arrive with the backend (NEXT-STEPS.md §3).
  if (READ_ONLY) {
    return (
      <div className="space-y-4 pt-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <p className="text-sm text-foreground/60">
            Everything here is open to browse — no account needed.
          </p>
        </header>
        <ComingSoonCTA
          icon="👋"
          title="Member profiles are coming soon"
          note="Sign-in, RSVP, chat, and shared photos land in the next update. For now, explore away."
        />
        <ul className="space-y-2 text-sm text-foreground/70">
          <li className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
            <span className="text-lg">💬</span> Resort chat — read along today
          </li>
          <li className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
            <span className="text-lg">🎉</span> Family Fest — schedule, crew &amp; photos
          </li>
          <li className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
            <span className="text-lg">🔔</span> Alerts &amp; RSVP — once sign-in is live
          </li>
        </ul>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-4 pt-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <p className="text-sm text-foreground/60">
            You&rsquo;re browsing as a guest.
          </p>
        </header>
        <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
          <p className="text-sm text-foreground/70">
            Add your name and email to post in chat, RSVP, and get alerts. Looking
            around stays open to everyone.
          </p>
          <button
            onClick={promptSignIn}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white"
          >
            Add your name &amp; email
          </button>
        </div>
      </div>
    );
  }

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-6 pt-6">
      <header className="flex items-center gap-3">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-xl font-bold text-primary">
          {initials}
        </div>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <span className="truncate">{user.name}</span>
            {isAdmin && (
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                Admin
              </span>
            )}
          </h1>
          <p className="truncate text-sm text-foreground/50">{user.email}</p>
        </div>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-accent">Notifications</h2>
        <label className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
          <span className="min-w-0">
            <span className="text-sm font-medium">Email me alerts</span>
            <span className="block text-xs text-foreground/50">
              Get an email when an admin pushes an alert, in case you miss it in
              the app.
            </span>
          </span>
          <input
            type="checkbox"
            checked={user.emailAlerts}
            onChange={(e) => updateUser({ emailAlerts: e.target.checked })}
            className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          />
        </label>
        <p className="px-1 text-xs text-foreground/40">
          Android push notifications can be enabled here once the backend is in
          place; on iOS, alerts come by email.
        </p>
      </section>

      {isAdmin && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-accent">Admin</h2>
          <AdminAlertComposer />
        </section>
      )}

      <button
        onClick={signOut}
        className="w-full rounded-2xl bg-card py-3 text-sm font-semibold text-foreground/70 ring-1 ring-border"
      >
        Sign out
      </button>
    </div>
  );
}
