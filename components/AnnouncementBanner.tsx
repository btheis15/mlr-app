"use client";

import { useEffect, useState } from "react";
import type { Announcement } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { LOCAL_ANNOUNCEMENTS_KEY, loadLocalAnnouncements } from "@/lib/localAnnouncements";

const DISMISSED_KEY = "mlr-dismissed-announcements";

/**
 * Top-of-app notice banner. Announcements come in as props (a server component
 * fetches them — today from seed data, later from a Google-Drive-fed source;
 * see lib/announcements.ts). Dismissals are remembered per-device so a notice
 * doesn't nag after it's been read.
 */
export function AnnouncementBanner({ items }: { items: Announcement[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [local, setLocal] = useState<Announcement[]>([]);
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

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  };

  if (!ready) return null;

  const merged = [...local, ...items].sort((a, b) => b.ts.localeCompare(a.ts));
  const visible = merged.filter((a) => !dismissed.includes(a.id));
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
