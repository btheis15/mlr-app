"use client";

import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { getCurrentUserId } from "@/lib/roles";
import { useSaveStatus } from "@/lib/hooks";

type Audience = "everyone" | "beta" | "admins";

const AUDIENCES: { value: Audience; label: string; desc: string }[] = [
  { value: "everyone", label: "Everyone", desc: "Every signed-in member" },
  { value: "beta", label: "Beta testers", desc: "Just the Beta Tester group — for trying things out" },
  { value: "admins", label: "Admins only", desc: "Just App Admins" },
];

// Notifications can carry an optional expiry: past it the item stays in the
// Activity list but stops counting toward the badge (handy for time-bound notices).
const EXPIRY_OPTIONS: { label: string; hours: number | null }[] = [
  { label: "Doesn't expire", hours: null },
  { label: "6 hours", hours: 6 },
  { label: "1 day", hours: 24 },
  { label: "3 days", hours: 24 * 3 },
  { label: "1 week", hours: 24 * 7 },
];

/**
 * Send an in-app notification to a chosen audience (App Admins only). It lands in
 * recipients' Activity tab + bumps their badge, bypassing personal prefs (the
 * audience is the gate). Targeting "Beta testers" is the way to dry-run a
 * notification without pinging the whole resort. For an "Everyone" send you can
 * also mirror it as the top-of-app banner. Backed by send_broadcast_notification
 * (migration 0030).
 */
export function AdminNotificationComposer() {
  const { isAdmin } = useIdentity();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [audience, setAudience] = useState<Audience>("beta");
  const [expiryHours, setExpiryHours] = useState<number | null>(null);
  const [alsoBanner, setAlsoBanner] = useState(false);
  const { pending: sending, status, show, run } = useSaveStatus();

  // App admins only (send_broadcast_notification re-checks this server-side too).
  if (isSupabaseConfigured && !isAdmin) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) {
      show("Sending notifications needs the backend configured.", 4000);
      return;
    }
    const expiresAt = expiryHours == null ? null : new Date(Date.now() + expiryHours * 3600 * 1000).toISOString();
    const link = url.trim() || null;

    run(async () => {
      const { data, error } = await sb.rpc("send_broadcast_notification", {
        p_title: title.trim(),
        p_body: body.trim() || null,
        p_url: link,
        p_audience: audience,
        p_expires_at: expiresAt,
      });
      if (error) {
        show(`Couldn't send: ${error.message}`, 0);
        return;
      }
      const count = typeof data === "number" ? data : 0;

      // Optional: also drop it in everyone's top-of-app banner (banner is
      // everyone-only, so this is offered only for an "Everyone" send).
      if (alsoBanner && audience === "everyone") {
        const uid = await getCurrentUserId();
        const bannerExpiry = expiresAt ?? new Date(Date.now() + 6 * 3600 * 1000).toISOString();
        await sb.from("announcements").insert({
          author_id: uid,
          title: title.trim(),
          body: body.trim() || null,
          severity: "alert",
          notify_email: false,
          expires_at: bannerExpiry,
        });
      }

      const who = audience === "everyone" ? "everyone" : audience === "beta" ? "beta testers" : "admins";
      setTitle(""); setBody(""); setUrl(""); setExpiryHours(null); setAlsoBanner(false);
      return `Sent to ${count} ${who === "everyone" ? "members" : who} ✓`;
    }, 6000);
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <h2 className="text-sm font-semibold">🔔 Send a notification</h2>
      <p className="text-xs text-foreground/60">
        Lands in recipients&rsquo; <strong>Activity</strong> tab (and bumps their badge). Send to{" "}
        <strong>Beta testers</strong> to try one out before sending it to everyone.
      </p>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder='e.g. "Photos from the fish fry are up!"'
        className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Details (optional)"
        rows={2}
        className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Link when tapped (optional) — e.g. /posts"
        className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium text-foreground/70">Send to</p>
        <div className="overflow-hidden rounded-xl ring-1 ring-border">
          {AUDIENCES.map((a, i) => (
            <button
              key={a.value}
              type="button"
              onClick={() => setAudience(a.value)}
              aria-pressed={audience === a.value}
              className={`press flex w-full items-start justify-between gap-3 p-3 text-left ${i ? "border-t border-border" : ""} ${audience === a.value ? "bg-primary/10" : "bg-background"}`}
            >
              <span className="min-w-0">
                <span className="text-sm font-medium">{a.label}</span>
                <span className="block text-xs text-foreground/50">{a.desc}</span>
              </span>
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ${audience === a.value ? "bg-primary ring-primary" : "ring-border"}`}
              >
                {audience === a.value && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center justify-between gap-2 rounded-xl bg-background px-3 py-2 text-xs text-foreground/70 ring-1 ring-border">
        <span>Stop counting toward the badge after</span>
        <select
          value={expiryHours == null ? "" : String(expiryHours)}
          onChange={(e) => setExpiryHours(e.target.value === "" ? null : Number(e.target.value))}
          className="rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.label} value={o.hours == null ? "" : String(o.hours)}>{o.label}</option>
          ))}
        </select>
      </label>

      {audience === "everyone" && (
        <label className="flex items-center gap-2 rounded-xl bg-background px-3 py-2 text-xs text-foreground/70 ring-1 ring-border">
          <input type="checkbox" checked={alsoBanner} onChange={(e) => setAlsoBanner(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
          Also show as a top-of-app banner
        </label>
      )}

      <div className="flex items-center justify-end">
        <button type="submit" disabled={!title.trim() || sending} className="press rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
      {status && <p className="text-xs font-medium text-accent">{status}</p>}
    </form>
  );
}
