"use client";

import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { pushLocalAnnouncement } from "@/lib/localAnnouncements";

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
  const [severity, setSeverity] = useState<"info" | "alert">("alert");
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [emailAudience, setEmailAudience] = useState<"all" | "admins">("all");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (isSupabaseConfigured && supabase) {
      setSending(true);
      setStatus(null);
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const base = { author_id: uid, title: title.trim(), body: body.trim() || null, severity, notify_email: notifyEmail };
      let { error } = await supabase.from("announcements").insert({ ...base, email_audience: emailAudience });
      if (error && /email_audience/i.test(error.message || "")) {
        // Pre-0017 the column doesn't exist yet — post without it (emails everyone).
        ({ error } = await supabase.from("announcements").insert(base));
      }
      setSending(false);
      if (error) {
        setStatus(`Couldn't post: ${error.message}`);
        return;
      }
      setTitle(""); setBody(""); setSeverity("alert"); setEmailAudience("all");
      setStatus(
        notifyEmail
          ? `Posted to everyone's banner ✓ (emailed ${emailAudience === "admins" ? "App Admins" : "opted-in members"})`
          : "Posted to everyone's banner ✓",
      );
      window.setTimeout(() => setStatus(null), 6000);
      return;
    }

    // Local fallback (no backend).
    pushLocalAnnouncement({ id: `local-${Date.now()}`, severity, title: title.trim(), body: body.trim() || undefined, ts: new Date().toISOString() });
    setTitle(""); setBody(""); setSeverity("alert");
    setStatus("Posted to the banner (this device).");
    window.setTimeout(() => setStatus(null), 4000);
  };

  // App admins only (the announcements INSERT policy enforces this server-side too).
  if (isSupabaseConfigured && !isAdmin) return null;

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Alerts</span>
        <h2 className="text-sm font-semibold">Push a notice to everyone</h2>
      </div>
      <p className="text-xs text-foreground/60">
        Shows a banner at the top of the app for <strong>everyone</strong>. <strong>📣 Alert</strong> = a bold,
        hard-to-miss banner; <strong>ℹ️ Info</strong> = a quiet notice. Opted-in members can also be emailed.
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
      <div className="flex items-center gap-3">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as "info" | "alert")}
          className="flex-1 rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="alert">📣 Alert — loud banner</option>
          <option value="info">ℹ️ Info — quiet notice</option>
        </select>
        <button type="submit" disabled={!title.trim() || sending} className="press rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {sending ? "Posting…" : "Push"}
        </button>
      </div>
      {status && <p className="text-xs font-medium text-accent">{status}</p>}
    </form>
  );
}
