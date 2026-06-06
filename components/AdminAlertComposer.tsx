"use client";

import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { getCurrentUserId } from "@/lib/roles";
import { useSaveStatus } from "@/lib/hooks";
import { pushLocalAnnouncement } from "@/lib/localAnnouncements";

/**
 * How long an alert sits in everyone's banner before it auto-hides (people can
 * still dismiss it sooner with the ✕). Default 6h so notices don't linger; an
 * admin can stretch it up to 30 days for something that needs to stay put.
 */
const EXPIRY_OPTIONS: { label: string; hours: number }[] = [
  { label: "1 hour", hours: 1 },
  { label: "6 hours", hours: 6 },
  { label: "12 hours", hours: 12 },
  { label: "1 day", hours: 24 },
  { label: "3 days", hours: 24 * 3 },
  { label: "1 week", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];
const DEFAULT_EXPIRY_HOURS = 6;

/**
 * Compose an app-wide alert (banner notice). **App Admins only** (migration
 * 0016). When the backend is live it inserts an `announcements` row, which
 * broadcasts to every device via Realtime (and the mini's mailer emails opted-in
 * members if email is configured). With no backend it falls back to a
 * device-local notice.
 */
export function AdminAlertComposer() {
  const { isAdmin } = useIdentity();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [emailAudience, setEmailAudience] = useState<"all" | "admins">("all");
  const [expiryHours, setExpiryHours] = useState(DEFAULT_EXPIRY_HOURS);
  const { pending: sending, status, show, run } = useSaveStatus();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

    const sb = supabase;
    if (isSupabaseConfigured && sb) {
      run(async () => {
        const uid = await getCurrentUserId();
        const base = { author_id: uid, title: title.trim(), body: body.trim() || null, severity: "alert", notify_email: notifyEmail, expires_at: expiresAt };
        let { error } = await sb.from("announcements").insert({ ...base, email_audience: emailAudience });
        if (error && /email_audience/i.test(error.message || "")) {
          // Pre-0017 the column doesn't exist yet — post without it (emails everyone).
          ({ error } = await sb.from("announcements").insert(base));
        }
        if (error) {
          show(`Couldn't post: ${error.message}`, 0); // a real failure sticks
          return;
        }
        setTitle(""); setBody(""); setEmailAudience("all"); setExpiryHours(DEFAULT_EXPIRY_HOURS);
        return notifyEmail
          ? `Posted to everyone's banner ✓ (emailed ${emailAudience === "admins" ? "App Admins" : "opted-in members"})`
          : "Posted to everyone's banner ✓";
      }, 6000);
      return;
    }

    // Local fallback (no backend).
    pushLocalAnnouncement({ id: `local-${Date.now()}`, severity: "alert", title: title.trim(), body: body.trim() || undefined, ts: new Date().toISOString(), expiresAt });
    setTitle(""); setBody(""); setExpiryHours(DEFAULT_EXPIRY_HOURS);
    show("Posted to the banner (this device).", 4000);
  };

  // App admins only (the announcements INSERT policy enforces this server-side too).
  if (isSupabaseConfigured && !isAdmin) return null;

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">📣 Post a notification</h2>
      </div>
      <p className="text-xs text-foreground/60">
        Shows a 📣 banner at the top of the app for <strong>everyone</strong>. It auto-hides after the window below (people can dismiss it sooner with ✕). Opted-in members can also be emailed (below).
      </p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder='e.g. "Dinner moved to 6:00 PM"'
        className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Details (optional)"
        rows={2}
        className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <label className="flex items-center justify-between gap-2 rounded-xl bg-background px-3 py-2 text-xs text-foreground/70 ring-1 ring-border">
        <span>Hide from the banner after</span>
        <select
          value={expiryHours}
          onChange={(e) => setExpiryHours(Number(e.target.value))}
          className="rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.hours} value={o.hours}>{o.label}</option>
          ))}
        </select>
      </label>
      {isSupabaseConfigured && (
        <div className="space-y-2 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
          <label className="flex items-center gap-2 text-xs text-foreground/70">
            <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
            Also send this as an email
          </label>
          {notifyEmail && (
            <select
              value={emailAudience}
              onChange={(e) => setEmailAudience(e.target.value as "all" | "admins")}
              className="w-full rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">Email everyone who opted in</option>
              <option value="admins">Email App Admins only</option>
            </select>
          )}
        </div>
      )}
      <div className="flex items-center justify-end gap-3">
        <button type="submit" disabled={!title.trim() || sending} className="press rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {sending ? "Posting…" : "Post"}
        </button>
      </div>
      {status && <p className="text-xs font-medium text-accent">{status}</p>}
    </form>
  );
}
