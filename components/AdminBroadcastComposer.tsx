"use client";

import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { useSaveStatus } from "@/lib/hooks";
import { pushLocalAnnouncement } from "@/lib/localAnnouncements";
import { postAnnouncement, sendActivityNotification } from "@/lib/broadcast";
import { EventTargetPicker, type EventTarget } from "@/components/EventTargetPicker";
import { ScheduleSendPicker } from "@/components/ScheduleSendPicker";
import { scheduleBroadcast } from "@/lib/scheduledBroadcasts";
import { fetchFestContent } from "@/lib/festContent";
import { fetchDropBoxes, type DropBox } from "@/lib/dropBoxes";
import { activityReminderDefaults, familyFestTargetEventId } from "@/lib/activityNotify";
import type { ScheduleEvent } from "@/lib/types";

/** How long the banner stays up before it auto-hides (people can still
 *  dismiss it sooner with ✕). Irrelevant when "Show as a banner" is off. */
const BANNER_EXPIRY_OPTIONS: { label: string; hours: number }[] = [
  { label: "1 hour", hours: 1 },
  { label: "6 hours", hours: 6 },
  { label: "12 hours", hours: 12 },
  { label: "1 day", hours: 24 },
  { label: "3 days", hours: 24 * 3 },
  { label: "1 week", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];
const DEFAULT_BANNER_EXPIRY_HOURS = 6;

// The Activity tab entry can carry an optional expiry too — past it the item
// stays in the list but stops counting toward the bell badge.
const FEED_EXPIRY_OPTIONS: { label: string; hours: number | null }[] = [
  { label: "Doesn't expire", hours: null },
  { label: "6 hours", hours: 6 },
  { label: "1 day", hours: 24 },
  { label: "3 days", hours: 24 * 3 },
  { label: "1 week", hours: 24 * 7 },
];

type FeedAudience = "everyone" | "admins";

/**
 * The merged "reach everyone" composer — replaces the old separate "Post an
 * alert" (AdminAlertComposer) and "Send a notification" (AdminNotificationComposer)
 * forms with one, offering three independent channels instead of two forms
 * that mostly collected the same title/body/event-target/schedule fields:
 *
 *   • Banner — a dismissible, auto-expiring notice at the top of the app for
 *     everyone. Already pushes to phones for anyone with alert pushes on
 *     (unchanged, automatic — not a separate toggle here).
 *   • Activity feed — a durable entry in recipients' Activity tab (bumps the
 *     bell badge), targeted at Everyone or Admins only, with an optional
 *     tap-through link.
 *   • Email — opted-in members, or just admins.
 *
 * Banner and Email both write the same `announcements` row (migration 0126's
 * `show_banner` lets Email fire without the banner showing, and vice versa);
 * Activity feed is the unchanged send_broadcast_notification RPC. At least
 * one channel must be checked. "Schedule for later" queues one
 * scheduled_broadcasts row per channel-group needed (announcement for
 * Banner/Email, notification for Activity feed) at the same send time.
 */
export function AdminBroadcastComposer() {
  const { isAdmin } = useIdentity();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [eventTarget, setEventTarget] = useState<EventTarget>({ eventId: null, excludeNotAttending: true });
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);

  const [showBanner, setShowBanner] = useState(true);
  const [bannerExpiryHours, setBannerExpiryHours] = useState(DEFAULT_BANNER_EXPIRY_HOURS);

  const [sendEmail, setSendEmail] = useState(true);
  const [emailAudience, setEmailAudience] = useState<"all" | "admins">("all");

  const [sendToFeed, setSendToFeed] = useState(false);
  const [feedAudience, setFeedAudience] = useState<FeedAudience>("everyone");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedExpiryHours, setFeedExpiryHours] = useState<number | null>(null);

  // Link to a Family Fest activity → autofill the message from it (title +
  // when/where), tap-through to it, and target Family Fest attendees.
  const [activityOptions, setActivityOptions] = useState<ScheduleEvent[]>([]);
  const [activityLinkId, setActivityLinkId] = useState<string>("");
  // Albums, so "send them straight to this album" is a pick rather than a path
  // the admin has to know (/drop?box=<uuid>).
  const [dropBoxOptions, setDropBoxOptions] = useState<DropBox[]>([]);
  useEffect(() => {
    let alive = true;
    fetchFestContent().then((c) => {
      if (alive) setActivityOptions(c.schedule);
    });
    fetchDropBoxes(null, true).then((boxes) => {
      if (alive) setDropBoxOptions(boxes.filter((b) => !b.archivedAt));
    });
    return () => {
      alive = false;
    };
  }, []);
  const onPickActivity = (id: string) => {
    setActivityLinkId(id);
    if (!id) return; // clearing the link leaves whatever's already typed
    const picked = activityOptions.find((e) => e.id === id);
    if (!picked) return;
    const d = activityReminderDefaults(picked);
    setTitle(d.title);
    setBody(d.body);
    setFeedUrl(d.url);
    setSendToFeed(true); // so tapping the Activity entry opens the activity
    // The fest event is per-year now (`family-fest-<year>`), so the target is
    // resolved rather than constant — otherwise picking a 2027 activity would
    // filter the send against 2026's RSVPs.
    void familyFestTargetEventId().then((eventId) =>
      setEventTarget({ eventId, excludeNotAttending: true }),
    );
  };

  const { pending: sending, status, show, run } = useSaveStatus();

  const anyChannel = showBanner || sendEmail || sendToFeed;

  const reset = () => {
    setTitle(""); setBody(""); setFeedUrl(""); setActivityLinkId("");
    setEmailAudience("all"); setBannerExpiryHours(DEFAULT_BANNER_EXPIRY_HOURS); setFeedExpiryHours(null);
    setEventTarget({ eventId: null, excludeNotAttending: true });
    setScheduleAt(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !anyChannel) return;

    if (!isSupabaseConfigured) {
      // No backend: fall back to a device-local banner, same as the old
      // AdminAlertComposer's offline path. Email/Activity feed need the
      // backend, so they're skipped entirely here.
      const expiresAt = new Date(Date.now() + bannerExpiryHours * 60 * 60 * 1000).toISOString();
      pushLocalAnnouncement({ id: `local-${Date.now()}`, severity: "alert", title: title.trim(), body: body.trim() || undefined, ts: new Date().toISOString(), expiresAt });
      reset();
      show("Posted to the banner (this device).", 4000);
      return;
    }

    if (scheduleAt) {
      run(async () => {
        const parts: string[] = [];
        if (showBanner || sendEmail) {
          const { error } = await scheduleBroadcast(
            "announcement",
            {
              title: title.trim(), body: body.trim() || null, expiryHours: bannerExpiryHours,
              notifyEmail: sendEmail, emailAudience, showBanner,
              eventId: eventTarget.eventId, excludeNotAttending: eventTarget.excludeNotAttending,
            },
            scheduleAt,
          );
          if (error) return `Couldn't schedule the banner/email: ${error}`;
          if (showBanner) parts.push("banner");
          if (sendEmail) parts.push("email");
        }
        if (sendToFeed) {
          const { error } = await scheduleBroadcast(
            "notification",
            {
              title: title.trim(), body: body.trim() || null, url: feedUrl.trim() || null,
              audience: feedAudience, expiryHours: feedExpiryHours,
              eventId: eventTarget.eventId, excludeNotAttending: eventTarget.excludeNotAttending,
            },
            scheduleAt,
          );
          if (error) return `Couldn't schedule the Activity tab notification: ${error}`;
          parts.push("Activity tab");
        }
        const when = new Date(scheduleAt).toLocaleString();
        reset();
        return `Scheduled (${parts.join(" + ")}) for ${when} ✓`;
      }, 6000);
      return;
    }

    run(async () => {
      const notes: string[] = [];
      if (showBanner || sendEmail) {
        const { error } = await postAnnouncement({
          title: title.trim(), body: body.trim() || null, showBanner, notifyEmail: sendEmail, emailAudience,
          expiryHours: bannerExpiryHours, eventId: eventTarget.eventId, excludeNotAttending: eventTarget.excludeNotAttending,
        });
        if (error) return `Couldn't post: ${error}`;
        if (showBanner) notes.push("Posted to the banner");
        if (sendEmail) notes.push(`emailed ${emailAudience === "admins" ? "App Admins" : "opted-in members"}`);
      }
      if (sendToFeed) {
        const expiresAt = feedExpiryHours == null ? null : new Date(Date.now() + feedExpiryHours * 3600 * 1000).toISOString();
        const { count, error } = await sendActivityNotification({
          title: title.trim(), body: body.trim() || null, url: feedUrl.trim() || null, audience: feedAudience,
          expiresAt, eventId: eventTarget.eventId, excludeNotAttending: eventTarget.excludeNotAttending,
        });
        if (error) return `Couldn't send to the Activity tab: ${error}`;
        notes.push(`sent to ${count ?? 0} ${feedAudience === "admins" ? "admins'" : "members'"} Activity tab`);
      }
      reset();
      return `${notes.join(" · ")} ✓`;
    }, 6000);
  };

  // App admins only — the underlying inserts/RPC re-check this server-side too.
  if (isSupabaseConfigured && !isAdmin) return null;

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <h2 className="text-sm font-semibold">📣 Reach everyone</h2>
      <p className="text-xs text-foreground/60">
        Pick one or more places this shows up — a top-of-app banner, recipients&rsquo; Activity tab, and/or an email.
      </p>

      {activityOptions.length > 0 && (
        <div className="rounded-xl bg-background px-3 py-2 ring-1 ring-border">
          <label className="block text-xs font-medium text-foreground/60">Remind about an activity (autofills)</label>
          <select
            value={activityLinkId}
            onChange={(e) => onPickActivity(e.target.value)}
            className="mt-1 w-full rounded-lg bg-card px-2 py-2 text-sm ring-1 ring-border"
          >
            <option value="">None — write my own</option>
            {activityOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {`${a.emoji ?? ""} ${a.title}`.trim()}
              </option>
            ))}
          </select>
          {activityLinkId && (
            <p className="mt-1 text-[11px] text-foreground/50">
              Filled from the activity + links to it. Goes to everyone at Family Fest (skips those not coming). Edit anything below.
            </p>
          )}
        </div>
      )}

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

      {/* ── Channel 1: Banner ─────────────────────────────────────────── */}
      <div className="space-y-2 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showBanner} onChange={(e) => setShowBanner(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
          <span className="font-medium">📣 Show as a banner</span>
        </label>
        <p className="pl-6 text-xs text-foreground/55">
          Top of the app, for everyone. Also pushes to phones for anyone with alert pushes on.
        </p>
        {showBanner && (
          <label className="flex items-center justify-between gap-2 pl-6 text-xs text-foreground/70">
            <span>Hide after</span>
            <select
              value={bannerExpiryHours}
              onChange={(e) => setBannerExpiryHours(Number(e.target.value))}
              className="rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            >
              {BANNER_EXPIRY_OPTIONS.map((o) => (
                <option key={o.hours} value={o.hours}>{o.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* ── Channel 2: Activity feed ──────────────────────────────────── */}
      {isSupabaseConfigured && (
        <div className="space-y-2 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sendToFeed} onChange={(e) => setSendToFeed(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
            <span className="font-medium">🔔 Send to Activity tab</span>
          </label>
          <p className="pl-6 text-xs text-foreground/55">
            A durable entry that bumps their bell badge.
          </p>
          {sendToFeed && (
            <div className="space-y-2 pl-6">
              <div className="overflow-hidden rounded-lg ring-1 ring-border">
                {([
                  { value: "everyone" as FeedAudience, label: "Everyone" },
                  { value: "admins" as FeedAudience, label: "Admins only" },
                ]).map((a, i) => (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => setFeedAudience(a.value)}
                    aria-pressed={feedAudience === a.value}
                    className={`press w-full px-3 py-2 text-left text-xs font-medium ${i ? "border-t border-border" : ""} ${feedAudience === a.value ? "bg-primary/10 text-primary" : "bg-card text-foreground/70"}`}
                  >
                    {feedAudience === a.value ? "✓ " : ""}{a.label}
                  </button>
                ))}
              </div>
              {/* Where a tap lands — on the phone (push) and in the Activity
                  tab. This was a bare text box, which meant knowing a path like
                  /drop?box=<uuid> by heart; the picker fills it in for the
                  common destinations so the link is actually usable. */}
              <div className="space-y-1">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setFeedUrl(e.target.value);
                  }}
                  className="w-full rounded-lg bg-card px-2.5 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Send them to… (pick to fill in below)</option>
                  <option value="/">Home</option>
                  <option value="/posts?feed=main">The Family Feed</option>
                  <option value="/drop">Albums (the list)</option>
                  <option value="/events">Events</option>
                  <option value="/polls">Polls</option>
                  {dropBoxOptions.length > 0 && (
                    <optgroup label="A specific album">
                      {dropBoxOptions.map((b) => (
                        <option key={b.id} value={`/drop?box=${b.id}`}>
                          {b.emoji ? `${b.emoji} ` : ""}{b.title}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <input
                  value={feedUrl}
                  onChange={(e) => setFeedUrl(e.target.value)}
                  placeholder="Link when tapped (optional) — e.g. /posts"
                  className="w-full rounded-lg bg-card px-2.5 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <label className="flex items-center justify-between gap-2 text-xs text-foreground/70">
                <span>Stop counting toward the badge after</span>
                <select
                  value={feedExpiryHours == null ? "" : String(feedExpiryHours)}
                  onChange={(e) => setFeedExpiryHours(e.target.value === "" ? null : Number(e.target.value))}
                  className="rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
                >
                  {FEED_EXPIRY_OPTIONS.map((o) => (
                    <option key={o.label} value={o.hours == null ? "" : String(o.hours)}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      {/* ── Channel 3: Email ──────────────────────────────────────────── */}
      {isSupabaseConfigured && (
        <div className="space-y-2 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
            <span className="font-medium">✉️ Also email</span>
          </label>
          {sendEmail && (
            <select
              value={emailAudience}
              onChange={(e) => setEmailAudience(e.target.value as "all" | "admins")}
              className="w-full rounded-lg bg-card px-2 py-1.5 pl-6 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">Everyone who opted in</option>
              <option value="admins">App Admins only</option>
            </select>
          )}
        </div>
      )}

      {isSupabaseConfigured && <EventTargetPicker value={eventTarget} onChange={setEventTarget} />}
      {isSupabaseConfigured && <ScheduleSendPicker value={scheduleAt} onChange={setScheduleAt} />}

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={!title.trim() || !anyChannel || sending}
          className="press rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {sending ? (scheduleAt ? "Scheduling…" : "Sending…") : scheduleAt ? "Schedule" : "Send"}
        </button>
      </div>
      {!anyChannel && <p className="text-xs text-accent">Pick at least one place to send this.</p>}
      {status && <p className="text-xs font-medium text-accent">{status}</p>}
    </form>
  );
}
