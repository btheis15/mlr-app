"use client";

import { useState } from "react";
import { pushLocalAnnouncement } from "@/lib/localAnnouncements";

/**
 * Admin-only composer for pushing an alert to the banner. Render this only when
 * `isAdmin` is true (it's also enforced server-side once there's a backend).
 * v1 writes the alert locally; the backend version will broadcast to every
 * device and email opted-in guests.
 */
export function AdminAlertComposer() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<"info" | "alert">("alert");
  const [justSent, setJustSent] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    pushLocalAnnouncement({
      id: `local-${Date.now()}`,
      severity,
      title: title.trim(),
      body: body.trim() || undefined,
      ts: new Date().toISOString(),
    });
    setTitle("");
    setBody("");
    setSeverity("alert");
    setJustSent(true);
    setTimeout(() => setJustSent(false), 2500);
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30"
    >
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
          Admin
        </span>
        <h2 className="text-sm font-semibold">Push an alert</h2>
      </div>
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
      <div className="flex items-center gap-3">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as "info" | "alert")}
          className="flex-1 rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="alert">Alert (loud)</option>
          <option value="info">Info (quiet)</option>
        </select>
        <button
          type="submit"
          disabled={!title.trim()}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Push
        </button>
      </div>
      {justSent && (
        <p className="text-xs text-accent">
          Posted to the banner. (Email + push broadcast arrives with the backend.)
        </p>
      )}
    </form>
  );
}
