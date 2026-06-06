"use client";

import { useEffect, useState } from "react";
import type { Announcement } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { LOCAL_ANNOUNCEMENTS_KEY, loadLocalAnnouncements } from "@/lib/localAnnouncements";

const DISMISSED_KEY = "mlr-dismissed-announcements";

interface AnnouncementRow {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  created_at: string;
  expires_at: string | null;
}

/**
 * Top-of-app notice banner. Announcements come in as props (a server component
 * fetches them — today from seed data, later from a Google-Drive-fed source;
 * see lib/announcements.ts). Dismissals are remembered per-device so a notice
 * doesn't nag after it's been read.
 */
export function AnnouncementBanner({ items }: { items: Announcement[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [local, setLocal] = useState<Announcement[]>([]);
  const [db, setDb] = useState<Announcement[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      if (raw) setDismissed(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setLocal(loadLocalAnnouncements());
    setReady(true);

    // Admin-posted alerts (this device) and other tabs both refresh the banner.
    const refresh = () => setLocal(loadLocalAnnouncements());
    window.addEventListener(LOCAL_ANNOUNCEMENTS_KEY, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LOCAL_ANNOUNCEMENTS_KEY, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Live broadcast alerts from the backend (migration 0015). Everyone sees these
  // — an app admin or a Family Fest lead posts one and it lands here in realtime.
  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) return;
    let cancelled = false;
    const loadDb = async () => {
      const { data } = await sb
        .from("announcements")
        .select("id, title, body, severity, created_at, expires_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      setDb(
        ((data ?? []) as AnnouncementRow[])
          .map((r) => ({ id: r.id, severity: r.severity === "info" ? "info" : "alert", title: r.title, body: r.body || undefined, ts: r.created_at, expiresAt: r.expires_at || undefined })),
      );
    };
    loadDb();
    const ch = sb
      .channel("announcements-banner")
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () => loadDb())
      .subscribe();
    return () => {
      cancelled = true;
      sb.removeChannel(ch);
    };
  }, []);

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  };

  if (!ready) return null;

  const now = Date.now();
  const seen = new Set<string>();
  const merged = [...local, ...db, ...items]
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => b.ts.localeCompare(a.ts));
  // Drop anything past its expiry (admin alerts auto-hide after their window)
  // or already dismissed on this device.
  const visible = merged.filter(
    (a) => !dismissed.includes(a.id) && (!a.expiresAt || new Date(a.expiresAt).getTime() > now),
  );
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map((a) => {
        const alert = a.severity === "alert";
        return (
          <div
            key={a.id}
            className={`flex items-start gap-3 rounded-2xl p-3 ring-1 ${
              alert
                ? "bg-primary/10 ring-primary/30"
                : "bg-card ring-border"
            }`}
          >
            <span className="text-base">{alert ? "📣" : "ℹ️"}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className={`text-sm font-semibold ${alert ? "text-primary" : ""}`}>
                  {a.title}
                </p>
                <span className="shrink-0 text-[10px] text-foreground/40">
                  {timeAgo(a.ts)}
                </span>
              </div>
              {a.body && (
                <p className="mt-0.5 text-xs text-foreground/70">{a.body}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(a.id)}
              className="press shrink-0 rounded-full px-1 text-foreground/40 hover:text-foreground"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
